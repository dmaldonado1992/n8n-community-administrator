const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[INSTAGRAM_RECIPIENT_ORDER] missing ${key}`);
    process.exit(1);
  }
}

const bool = (v, fallback=false) => v == null || v === '' ? fallback : /^(1|true|yes|on)$/i.test(String(v));
const config = {
  host: env.DB_POSTGRESDB_HOST,
  port: Number(env.DB_POSTGRESDB_PORT || 5432),
  database: env.DB_POSTGRESDB_DATABASE,
  user: env.DB_POSTGRESDB_USER,
  password: env.DB_POSTGRESDB_PASSWORD,
  connectionTimeoutMillis: 10000,
  ssl: bool(env.DB_POSTGRESDB_SSL_ENABLED, false)
    ? { rejectUnauthorized: bool(env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED, false) }
    : false,
};

const workflowId = '6l5IbTxGdwcL24wT';
const engineNodeName = 'Dynamic Notion Sales Engine';
const marker = '/* INSTAGRAM_RECIPIENT_NAME_ORDER_V1 */';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function ensureReplace(code, oldValue, newValue) {
  if (code.includes(oldValue)) return code.split(oldValue).join(newValue);
  if (code.includes(newValue)) return code;
  return code;
}

async function main() {
  const client = new Client(config);
  await client.connect();
  try {
    const result = await client.query(`
      SELECT nodes, "versionId", "activeVersionId"
      FROM public.workflow_entity
      WHERE id = $1
    `, [workflowId]);
    if (result.rowCount !== 1) throw new Error(`workflow not found: ${workflowId}`);

    const row = result.rows[0];
    const nodes = parseJson(row.nodes, []);
    const engine = nodes.find(n => n?.name === engineNodeName);
    if (!engine?.parameters?.jsCode) throw new Error(`engine node not found: ${engineNodeName}`);

    let code = String(engine.parameters.jsCode);
    if (code.includes(marker)) {
      console.log('[INSTAGRAM_RECIPIENT_ORDER] already applied');
      return;
    }

    // Orden is ascending in Notion. Keep navigation on the first greater order.
    // These replacements are tolerant when a previous patch already fixed navigation.
    code = ensureReplace(code,
      "steps.find(s=>s.order<current.order&&s.field==='foto_boleta')",
      "steps.find(s=>s.order>current.order&&s.field==='foto_boleta')"
    );
    code = ensureReplace(code,
      "steps.find(s=>s.order<next.order&&s.field==='foto_boleta')",
      "steps.find(s=>s.order>next.order&&s.field==='foto_boleta')"
    );
    code = ensureReplace(code,
      'steps.find(s=>s.order<current.order)',
      'steps.find(s=>s.order>current.order)'
    );

    if (!code.includes('steps.find(s=>s.order>current.order)') &&
        !code.includes("steps.find(s=>s.order>current.order&&s.field==='foto_boleta')")) {
      throw new Error('ascending order navigation could not be verified');
    }

    // Persist recipient name in active session.
    const phonePersist = "      if(current.field==='telefono') props['Teléfono (temporal)']={phone_number:text};";
    const recipientPersistLine = "      if(current.field==='persona_recibe') props['Persona que recibe (temporal)']={rich_text:[{text:{content:text}}]};";
    if (!code.includes(recipientPersistLine)) {
      if (!code.includes(phonePersist)) throw new Error('generic field persistence anchor not found');
      code = code.replace(phonePersist, `${phonePersist}\n${recipientPersistLine}`);
    }

    // Cash/no-receipt final order.
    const cashPhone = "          const phone=session.properties['Teléfono (temporal)']?.phone_number||'';";
    const cashRecipientLine = "          const recipientName=rich(session.properties['Persona que recibe (temporal)']);";
    if (!code.includes(cashRecipientLine)) {
      if (!code.includes(cashPhone)) throw new Error('cash recipient anchor not found');
      code = code.replace(cashPhone, `${cashPhone}\n${cashRecipientLine}`);
    }

    const cashClient = "            'Nombre cliente':{rich_text:clientName?[{text:{content:clientName}}]:[]},\n            'Pedido #':{number:orderNumber},";
    const cashClientWithRecipient = "            'Nombre cliente':{rich_text:clientName?[{text:{content:clientName}}]:[]},\n            'Persona que recibe':{rich_text:recipientName?[{text:{content:recipientName}}]:[]},\n            'Pedido #':{number:orderNumber},";
    if (!code.includes("'Persona que recibe':{rich_text:recipientName?[{text:{content:recipientName}}]:[]}")) {
      if (!code.includes(cashClient)) throw new Error('cash order property anchor not found');
      code = code.replace(cashClient, cashClientWithRecipient);
    }

    // Receipt/transfer final order.
    const transferPhone = "        const phone=current.field==='telefono'?text:session.properties['Teléfono (temporal)']?.phone_number||'';";
    const transferRecipientLine = "        const recipientName=current.field==='persona_recibe'?text:rich(session.properties['Persona que recibe (temporal)']);";
    if (!code.includes(transferRecipientLine)) {
      if (!code.includes(transferPhone)) throw new Error('transfer recipient anchor not found');
      code = code.replace(transferPhone, `${transferPhone}\n${transferRecipientLine}`);
    }

    const transferClient = "'Nombre cliente':{rich_text:clientName?[{text:{content:clientName}}]:[]},'Pedido #':{number:orderNumber}";
    const transferClientWithRecipient = "'Nombre cliente':{rich_text:clientName?[{text:{content:clientName}}]:[]},'Persona que recibe':{rich_text:recipientName?[{text:{content:recipientName}}]:[]},'Pedido #':{number:orderNumber}";
    if (!code.includes("'Nombre cliente':{rich_text:clientName?[{text:{content:clientName}}]:[]},'Persona que recibe':{rich_text:recipientName?[{text:{content:recipientName}}]:[]},'Pedido #':{number:orderNumber}")) {
      if (!code.includes(transferClient)) throw new Error('transfer order property anchor not found');
      code = code.replace(transferClient, transferClientWithRecipient);
    }

    const header = '/* INSTAGRAM_SALES_ENGINE_V3_TIMEOUT_SAFE */';
    if (!code.includes(header)) throw new Error('engine header anchor not found');
    code = code.replace(header, `${header}\n${marker}`);

    engine.parameters.jsCode = code;
    const nodesJson = JSON.stringify(nodes);
    const versionIds = [...new Set([row.versionId, row.activeVersionId].filter(Boolean).map(String))];

    await client.query('BEGIN');
    try {
      await client.query(`
        UPDATE public.workflow_entity
        SET nodes = $2::json, "updatedAt" = NOW()
        WHERE id = $1
      `, [workflowId, nodesJson]);

      if (versionIds.length) {
        await client.query(`
          UPDATE public.workflow_history
          SET nodes = $2::json, "updatedAt" = NOW()
          WHERE "workflowId" = $1
            AND "versionId" = ANY($3::text[])
        `, [workflowId, nodesJson, versionIds]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log('[INSTAGRAM_RECIPIENT_ORDER] applied ' + JSON.stringify({
      workflowId,
      recipientField: 'persona_recibe',
      sessionProperty: 'Persona que recibe (temporal)',
      orderProperty: 'Persona que recibe',
      orderDrivenNavigation: true,
      versionsUpdated: versionIds,
    }));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[INSTAGRAM_RECIPIENT_ORDER] failed: ' + String(error?.message || error));
  process.exit(1);
});

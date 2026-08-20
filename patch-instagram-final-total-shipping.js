const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[INSTAGRAM_FINAL_TOTAL_SHIPPING] missing ${key}`);
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
const marker = '/* INSTAGRAM_FINAL_TOTAL_SHIPPING_V1 */';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
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
      console.log('[INSTAGRAM_FINAL_TOTAL_SHIPPING] already applied');
      return;
    }

    let templateContextsPatched = 0;
    code = code.replace(/getSalesMessageTemplate\((['"])Pedido registrado(?: · Efectivo)?\1,\{([^{}]*?)\}\)/g, (full, quote, body) => {
      if (!/(?:^|,)\s*total(?:\s*[:,}]|\s*$)/.test(body) || /(?:^|,)\s*envio\s*:/.test(body)) return full;

      // Final-order branches already calculate shippingCost before Total and save it in "Costo envío".
      // Only patch when that variable is available near this call, avoiding accidental edits elsewhere.
      const idx = code.indexOf(full);
      const nearby = idx >= 0 ? code.slice(Math.max(0, idx - 5000), idx) : '';
      if (!/\bshippingCost\b/.test(nearby)) return full;

      templateContextsPatched++;
      const patchedBody = body.replace(/(^|,)\s*total\b/, '$1envio:shippingCost,total');
      return `getSalesMessageTemplate(${quote}${full.includes('Pedido registrado · Efectivo') ? 'Pedido registrado · Efectivo' : 'Pedido registrado'}${quote},{${patchedBody}})`;
    });

    // Known cash checkout call uses a compact object and is the principal production path.
    const cashOld = "pedido:orderNumber,total,metodo_pago:paymentMethod.name";
    const cashNew = "pedido:orderNumber,envio:shippingCost,total,metodo_pago:paymentMethod.name";
    if (code.includes(cashOld)) {
      code = code.split(cashOld).join(cashNew);
      templateContextsPatched++;
    }

    // Improve hard-coded fallbacks as well, so users still see the same breakdown if a Notion template is unavailable.
    let fallbacksPatched = 0;
    code = code.replace(/\. Total: Q'\+total\+'\. Método de pago:/g, ". Envío: Q'+shippingCost+'. Total: Q'+total+'. Método de pago:");
    if (code.includes("Envío: Q'+shippingCost+'. Total: Q'+total")) fallbacksPatched++;

    // Require at least the known cash template context to be supported.
    if (!code.includes('envio:shippingCost,total')) {
      throw new Error('final checkout template context anchor not found');
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

    console.log('[INSTAGRAM_FINAL_TOTAL_SHIPPING] applied ' + JSON.stringify({
      workflowId,
      templateContextsPatched,
      fallbacksPatched,
      versionsUpdated: versionIds,
    }));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[INSTAGRAM_FINAL_TOTAL_SHIPPING] failed: ' + String(error?.message || error));
  process.exit(1);
});

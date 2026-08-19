const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[INSTAGRAM_THANKS] missing ${key}`);
    process.exit(1);
  }
}

const bool = (v, fallback=false) => {
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

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
const marker = '/* INSTAGRAM_NOTION_THANKS_RESPONSE_V1 */';
const state = 'agradecimiento';

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

    if (result.rowCount !== 1) throw new Error(`Instagram workflow not found: ${workflowId}`);

    const row = result.rows[0];
    const nodes = parseJson(row.nodes, []);
    const engine = nodes.find(node => node?.name === engineNodeName);
    if (!engine?.parameters?.jsCode) throw new Error(`Instagram engine node not found: ${engineNodeName}`);

    let code = String(engine.parameters.jsCode);
    if (code.includes(marker)) {
      console.log('[INSTAGRAM_THANKS] already applied ' + JSON.stringify({ workflowId, state }));
      return;
    }

    const needle = `  }else if(!session){\n    const product=__matchProduct(text,products,{allowIndex:true});`;
    if (!code.includes(needle)) throw new Error('No-session branch anchor not found');

    const replacement = `  }else if(!session&&/\\bgracias\\b/.test(__normProduct(text))){\n    ${marker}\n    reply=(await __notionMessageTemplate('${state}'))||'¡Gracias a ti! 💛 Nos alegra mucho atenderte. Esperamos que disfrutes tu pedido de Banana Twins 🍌. ¡Será un gusto atenderte nuevamente! 😊';\n    log('INSTAGRAM_THANKS_RESPONSE',{sender,state:'${state}'});\n  }else if(!session){\n    const product=__matchProduct(text,products,{allowIndex:true});`;

    code = code.replace(needle, replacement);
    engine.parameters.jsCode = code;

    const nodesJson = JSON.stringify(nodes);
    const versionIds = [...new Set([row.versionId, row.activeVersionId].filter(Boolean).map(String))];

    await client.query('BEGIN');
    try {
      await client.query(`
        UPDATE public.workflow_entity
        SET nodes = $2::json,
            "updatedAt" = NOW()
        WHERE id = $1
      `, [workflowId, nodesJson]);

      if (versionIds.length) {
        await client.query(`
          UPDATE public.workflow_history
          SET nodes = $2::json,
              "updatedAt" = NOW()
          WHERE "workflowId" = $1
            AND "versionId" = ANY($3::text[])
        `, [workflowId, nodesJson, versionIds]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log('[INSTAGRAM_THANKS] applied ' + JSON.stringify({
      workflowId,
      state,
      trigger: 'contains_gracias_without_active_session',
      versionsUpdated: versionIds,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[INSTAGRAM_THANKS] failed: ' + String(error?.message || error));
  process.exit(1);
});

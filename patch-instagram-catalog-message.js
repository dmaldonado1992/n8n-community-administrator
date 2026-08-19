const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[INSTAGRAM_CATALOG_MESSAGE] missing ${key}`);
    process.exit(1);
  }
}

const bool = (v, fallback=false) => {
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

const sslEnabled = bool(env.DB_POSTGRESDB_SSL_ENABLED, false);
const config = {
  host: env.DB_POSTGRESDB_HOST,
  port: Number(env.DB_POSTGRESDB_PORT || 5432),
  database: env.DB_POSTGRESDB_DATABASE,
  user: env.DB_POSTGRESDB_USER,
  password: env.DB_POSTGRESDB_PASSWORD,
  connectionTimeoutMillis: 10000,
  ssl: sslEnabled ? { rejectUnauthorized: bool(env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED, false) } : false,
};

const workflowId = '6l5IbTxGdwcL24wT';
const engineNodeName = 'Dynamic Notion Sales Engine';
const messagesDatabaseId = 'f2a0a522-2409-45c0-b2f2-6c2a7959ac3c';
const messageState = 'CATALOGO_PRODUCTOS';
const marker = '/* INSTAGRAM_CATALOG_MESSAGE_NOTION_V1 */';

const helperAnchor = "const __wantsProductChange=input=>/(cambiar|cambia|cambio|prefiero|mejor|otro producto|quiero otro)/.test(__normProduct(input));";

const helperCode = `${marker}\nconst __catalogMessage=async list=>{\n  const fallback='Productos disponibles:\\n'+(list||'')+'\\n\\nResponde con el número o nombre del producto.';\n  try{\n    const data=await notionReq('POST','https://api.notion.com/v1/databases/${messagesDatabaseId}/query',{\n      filter:{and:[\n        {property:'Estado',title:{equals:'${messageState}'}},\n        {property:'Activo',checkbox:{equals:true}}\n      ]},\n      page_size:1\n    });\n    const page=(data.results||[])[0];\n    const rich=page?.properties?.['Mensaje Instagram']?.rich_text||[];\n    const template=rich.map(x=>x?.plain_text||x?.text?.content||'').join('').trim();\n    if(!template) return fallback;\n    return template.replace(/\\{\\{\\s*productos\\s*\\}\\}/gi,list||'');\n  }catch(error){\n    log('CATALOG_MESSAGE_NOTION_FALLBACK',{state:'${messageState}',error:String(error?.message||error)});\n    return fallback;\n  }\n};`;

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
    let changed = false;

    if (!code.includes(marker)) {
      if (!code.includes(helperAnchor)) throw new Error('Catalog message helper anchor not found');
      code = code.replace(helperAnchor, helperCode + '\n' + helperAnchor);
      changed = true;
    }

    const directHardcoded = "'Productos disponibles:\\n'+list+'\\n\\nResponde con el número o nombre del producto.'";
    const directReplacement = "(await __catalogMessage(list))";
    if (code.includes(directHardcoded)) {
      code = code.split(directHardcoded).join(directReplacement);
      changed = true;
    }

    const prefixedHardcoded = "'\\n\\nProductos disponibles:\\n'+list+'\\n\\nResponde con el número o nombre del producto.'";
    const prefixedReplacement = "'\\n\\n'+(await __catalogMessage(list))";
    if (code.includes(prefixedHardcoded)) {
      code = code.split(prefixedHardcoded).join(prefixedReplacement);
      changed = true;
    }

    if (!changed) {
      console.log('[INSTAGRAM_CATALOG_MESSAGE] already applied ' + JSON.stringify({ workflowId, messageState }));
      return;
    }

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

    console.log('[INSTAGRAM_CATALOG_MESSAGE] applied ' + JSON.stringify({
      workflowId,
      messagesDatabaseId,
      messageState,
      placeholder: '{{productos}}',
      versionsUpdated: versionIds,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[INSTAGRAM_CATALOG_MESSAGE] failed: ' + String(error?.message || error));
  process.exit(1);
});

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
const catalogMessageState = 'catalogo_productos';
const welcomeMessageState = 'bienvenida';
const markerV1 = '/* INSTAGRAM_CATALOG_MESSAGE_NOTION_V1 */';
const markerV2 = '/* INSTAGRAM_CATALOG_MESSAGE_NOTION_V2 */';

const helperAnchor = "const __wantsProductChange=input=>/(cambiar|cambia|cambio|prefiero|mejor|otro producto|quiero otro)/.test(__normProduct(input));";

const helperCode = `${markerV2}\nconst __notionMessageTemplate=async state=>{\n  try{\n    const data=await notionReq('POST','https://api.notion.com/v1/databases/${messagesDatabaseId}/query',{\n      filter:{and:[\n        {property:'Estado',title:{equals:state}},\n        {property:'Activo',checkbox:{equals:true}}\n      ]},\n      page_size:1\n    });\n    const page=(data.results||[])[0];\n    const rich=page?.properties?.['Mensaje Instagram']?.rich_text||[];\n    return rich.map(x=>x?.plain_text||x?.text?.content||'').join('').trim();\n  }catch(error){\n    log('INSTAGRAM_MESSAGE_NOTION_FALLBACK',{state,error:String(error?.message||error)});\n    return '';\n  }\n};\nconst __catalogMessage=async list=>{\n  const fallbackWelcome='¡Hola! 👋 Bienvenido a Banana Twins.';\n  const fallbackCatalog='{{bienvenida}}\\n\\n🍰 Nuestros productos disponibles son:\\n\\n{{productos}}';\n  const catalogTemplate=(await __notionMessageTemplate('${catalogMessageState}'))||fallbackCatalog;\n  const welcomeTemplate=(await __notionMessageTemplate('${welcomeMessageState}'))||fallbackWelcome;\n  return catalogTemplate\n    .replace(/\\{\\{\\s*bienvenida\\s*\\}\\}/gi,welcomeTemplate)\n    .replace(/\\{\\{\\s*productos\\s*\\}\\}/gi,list||'');\n};`;

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function replaceLegacyHelper(code) {
  if (code.includes(markerV2)) return { code, changed: false };

  if (code.includes(markerV1)) {
    const start = code.indexOf(markerV1);
    const anchorIndex = code.indexOf('\n' + helperAnchor, start);
    if (anchorIndex < 0) throw new Error('Legacy catalog helper end anchor not found');
    return {
      code: code.slice(0, start) + helperCode + code.slice(anchorIndex),
      changed: true,
    };
  }

  if (!code.includes(helperAnchor)) throw new Error('Catalog message helper anchor not found');
  return {
    code: code.replace(helperAnchor, helperCode + '\n' + helperAnchor),
    changed: true,
  };
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

    const helperResult = replaceLegacyHelper(code);
    code = helperResult.code;
    changed = changed || helperResult.changed;

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
      console.log('[INSTAGRAM_CATALOG_MESSAGE] already applied ' + JSON.stringify({
        workflowId,
        catalogMessageState,
        welcomeMessageState,
      }));
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
      catalogMessageState,
      welcomeMessageState,
      placeholders: ['{{bienvenida}}','{{productos}}'],
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

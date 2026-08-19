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
const markerV3 = '/* INSTAGRAM_MESSAGE_SEQUENCE_NOTION_V3 */';

const helperAnchor = "const __wantsProductChange=input=>/(cambiar|cambia|cambio|prefiero|mejor|otro producto|quiero otro)/.test(__normProduct(input));";

const helperCode = `${markerV3}\nconst __normMessageState=input=>String(input||'').trim().toLowerCase();\nlet __messageSequenceCache=null;\nconst __notionMessageSequence=async()=>{\n  if(Array.isArray(__messageSequenceCache)) return __messageSequenceCache;\n  try{\n    const data=await notionReq('POST','https://api.notion.com/v1/databases/${messagesDatabaseId}/query',{\n      filter:{property:'Activo',checkbox:{equals:true}},\n      sorts:[{property:'Orden',direction:'ascending'}],\n      page_size:100\n    });\n    __messageSequenceCache=(data.results||[]).map((page,index)=>{\n      const props=page?.properties||{};\n      const state=(props.Estado?.title||[]).map(x=>x?.plain_text||x?.text?.content||'').join('').trim();\n      const rich=props['Mensaje Instagram']?.rich_text||[];\n      const template=rich.map(x=>x?.plain_text||x?.text?.content||'').join('').trim();\n      const eventType=props['Tipo evento']?.select?.name||'';\n      const order=Number(props.Orden?.number);\n      return {\n        id:page?.id||'',\n        state,\n        stateKey:__normMessageState(state),\n        template,\n        eventType,\n        order:Number.isFinite(order)?order:(100000+index)\n      };\n    }).filter(x=>x.state&&x.template);\n    log('INSTAGRAM_MESSAGE_SEQUENCE_LOADED',{\n      count:__messageSequenceCache.length,\n      sequence:__messageSequenceCache.map(x=>({state:x.state,order:x.order,eventType:x.eventType}))\n    });\n    return __messageSequenceCache;\n  }catch(error){\n    log('INSTAGRAM_MESSAGE_SEQUENCE_FALLBACK',{error:String(error?.message||error)});\n    __messageSequenceCache=[];\n    return __messageSequenceCache;\n  }\n};\nconst __notionMessageRecord=async state=>{\n  const key=__normMessageState(state);\n  const sequence=await __notionMessageSequence();\n  return sequence.find(x=>x.stateKey===key)||null;\n};\nconst __notionMessageTemplate=async state=>{\n  const record=await __notionMessageRecord(state);\n  return record?.template||'';\n};\nconst __nextConfiguredMessage=async(state,eventType='')=>{\n  const sequence=await __notionMessageSequence();\n  const key=__normMessageState(state);\n  const currentIndex=sequence.findIndex(x=>x.stateKey===key);\n  if(currentIndex<0) return null;\n  const typeKey=String(eventType||'').trim().toLowerCase();\n  for(let i=currentIndex+1;i<sequence.length;i++){\n    const candidate=sequence[i];\n    if(!typeKey||String(candidate.eventType||'').trim().toLowerCase()===typeKey) return candidate;\n  }\n  return null;\n};\nconst __catalogMessage=async list=>{\n  const fallbackWelcome='¡Hola! 👋 Bienvenido a Banana Twins 🍌.';\n  const fallbackCatalog='{{bienvenida}}\\n\\n🍰 Nuestros productos disponibles son:\\n\\n{{productos}}';\n  const sequence=await __notionMessageSequence();\n  const welcomeRecord=sequence.find(x=>x.stateKey==='${welcomeMessageState}')||null;\n  const catalogRecord=sequence.find(x=>x.stateKey==='${catalogMessageState}')||null;\n  if(welcomeRecord&&catalogRecord&&welcomeRecord.order>=catalogRecord.order){\n    log('INSTAGRAM_MESSAGE_SEQUENCE_ORDER_INVALID',{\n      dependency:'${welcomeMessageState}->${catalogMessageState}',\n      welcomeOrder:welcomeRecord.order,\n      catalogOrder:catalogRecord.order\n    });\n  }\n  const welcomeTemplate=welcomeRecord?.template||fallbackWelcome;\n  const catalogTemplate=catalogRecord?.template||fallbackCatalog;\n  return catalogTemplate\n    .replace(/\\{\\{\\s*bienvenida\\s*\\}\\}/gi,welcomeTemplate)\n    .replace(/\\{\\{\\s*productos\\s*\\}\\}/gi,list||'');\n};`;

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function replaceLegacyHelper(code) {
  if (code.includes(markerV3)) return { code, changed: false };

  for (const legacyMarker of [markerV2, markerV1]) {
    if (!code.includes(legacyMarker)) continue;
    const start = code.indexOf(legacyMarker);
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
        sequenceMode: 'notion_order',
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
      sequenceMode: 'notion_order',
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

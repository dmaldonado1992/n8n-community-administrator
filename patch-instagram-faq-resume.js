const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[INSTAGRAM_FAQ] missing ${key}`);
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
const faqDb = '8083e6b3bed240b4b2da1edc317eb361';
const marker = '/* INSTAGRAM_NOTION_FAQ_RESUME_V1 */';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function replaceOnce(code, needle, replacement, label) {
  if (!code.includes(needle)) throw new Error(`${label} anchor not found`);
  return code.replace(needle, replacement);
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
      console.log('[INSTAGRAM_FAQ] already applied');
      return;
    }

    code = replaceOnce(
      code,
      "  shippingExceptions:'3a5dc41594704703a42d187dacc29ac1'\n};",
      "  shippingExceptions:'3a5dc41594704703a42d187dacc29ac1',\n  faq:'" + faqDb + "'\n};",
      'faq config'
    );

    const notionReqAnchor = "const notionReq=(method,url,body)=>this.helpers.httpRequest({method,url,headers:nh,body,json:true,timeout:HTTP_TIMEOUT});";
    const faqHelpers = `${notionReqAnchor}\n${marker}\nlet __faqCache=null;\nconst __faqRich=p=>p?.rich_text?.map(t=>t?.plain_text??t?.text?.content??'').join('')||'';\nconst __faqTitle=p=>p?.title?.map(t=>t?.plain_text??t?.text?.content??'').join('')||'';\nconst __faqNormalize=v=>String(v??'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim();\nconst getFaqEntries=async()=>{\n  if(Array.isArray(__faqCache)) return __faqCache;\n  const r=await notionReq('POST','https://api.notion.com/v1/databases/'+cfg.faq+'/query',{\n    filter:{property:'Activo',checkbox:{equals:true}},\n    sorts:[{property:'Prioridad',direction:'descending'}],\n    page_size:100\n  });\n  __faqCache=(r.results||[]).map(x=>{\n    const p=x.properties||{};\n    const question=__faqTitle(p.Pregunta);\n    const keywords=__faqRich(p['Palabras clave']).split(/[,;|\\n]/).map(v=>v.trim()).filter(Boolean);\n    const answer=__faqRich(p.Respuesta);\n    const mode=p['Modo coincidencia']?.select?.name||'contiene';\n    const priority=Number(p.Prioridad?.number||0);\n    return {id:x.id,question,keywords,answer,mode,priority};\n  }).filter(x=>x.answer&&x.keywords.length).sort((a,b)=>b.priority-a.priority);\n  log('FAQ_LOADED',{count:__faqCache.length,items:__faqCache.map(x=>({question:x.question,priority:x.priority,mode:x.mode}))});\n  return __faqCache;\n};\nconst matchFaq=async input=>{\n  const normalized=__faqNormalize(input);\n  if(!normalized) return null;\n  const rows=await getFaqEntries();\n  for(const row of rows){\n    for(const raw of row.keywords){\n      const key=__faqNormalize(raw);\n      if(!key) continue;\n      const matched=row.mode==='exacta'?normalized===key:(normalized===key||normalized.includes(key));\n      if(matched){\n        log('FAQ_MATCH',{question:row.question,keyword:raw,priority:row.priority,mode:row.mode});\n        return row;\n      }\n    }\n  }\n  return null;\n};`;
    code = replaceOnce(code, notionReqAnchor, faqHelpers, 'faq helpers');

    const outsideAnchor = `  }else if(!session){\n    const product=__matchProduct(text,products,{allowIndex:true});`;
    const outsideReplacement = `  }else if(!session){\n    const faqMatch=await matchFaq(text);\n    if(faqMatch){\n      reply=faqMatch.answer;\n      log('FAQ_ANSWER_OUTSIDE_FLOW',{sender,question:faqMatch.question});\n    }else{\n    const product=__matchProduct(text,products,{allowIndex:true});`;
    code = replaceOnce(code, outsideAnchor, outsideReplacement, 'outside FAQ branch');

    const outsideEndAnchor = `      reply='Pedido #'+orderNumber+' iniciado. El '+product.name+' cuesta Q'+product.price+'. '+(product.shipping?'El envío cuesta Q'+product.shipping+'. ':'')+first.message;\n    }\n  }else{`;
    const outsideEndReplacement = `      reply='Pedido #'+orderNumber+' iniciado. El '+product.name+' cuesta Q'+product.price+'. '+(product.shipping?'El envío cuesta Q'+product.shipping+'. ':'')+first.message;\n    }\n    }\n  }else{`;
    code = replaceOnce(code, outsideEndAnchor, outsideEndReplacement, 'outside FAQ close');

    const insideAnchor = `    const currentPrompt=await __stepPrompt(current,session);\n    if(__cancelIntent(text,current)){`;
    const insideReplacement = `    const currentPrompt=await __stepPrompt(current,session);\n    const faqMatch=await matchFaq(text);\n    if(faqMatch){\n      reply=faqMatch.answer+'\\n\\nSeguimos con tu pedido #'+orderNumber+': '+currentPrompt;\n      log('FAQ_ANSWER_AND_RESUME',{sender,sessionId:session.id,orderNumber,question:faqMatch.question,currentField:current.field,currentOrder:current.order});\n    }else if(__cancelIntent(text,current)){`;
    code = replaceOnce(code, insideAnchor, insideReplacement, 'inside FAQ branch');

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

    console.log('[INSTAGRAM_FAQ] applied ' + JSON.stringify({
      workflowId,
      faqDb,
      behavior:{outsideFlow:true,insideFlow:true,resumeSameStep:true,advanceOnFaq:false},
      versionsUpdated:versionIds,
    }));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[INSTAGRAM_FAQ] failed: ' + String(error?.message || error));
  process.exit(1);
});

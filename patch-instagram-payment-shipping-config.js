const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[INSTAGRAM_PAYMENT_SHIPPING] missing ${key}`);
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
const marker = '/* INSTAGRAM_NOTION_PAYMENT_SHIPPING_V1 */';
const paymentMethodsDb = '19bd50d0415d4146a7be2e5742cafb42';
const shippingExceptionsDb = '3a5dc41594704703a42d187dacc29ac1';

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

    if (result.rowCount !== 1) throw new Error(`Instagram workflow not found: ${workflowId}`);

    const row = result.rows[0];
    const nodes = parseJson(row.nodes, []);
    const engine = nodes.find(node => node?.name === engineNodeName);
    if (!engine?.parameters?.jsCode) throw new Error(`Instagram engine node not found: ${engineNodeName}`);

    let code = String(engine.parameters.jsCode);
    if (code.includes(marker)) {
      console.log('[INSTAGRAM_PAYMENT_SHIPPING] already applied ' + JSON.stringify({
        workflowId,
        paymentMethodsDb,
        shippingExceptionsDb,
      }));
      return;
    }

    code = replaceOnce(
      code,
      `  municipalities:'ffd242fcbfea4bd68094396208322bcf'\n};`,
      `  municipalities:'ffd242fcbfea4bd68094396208322bcf',\n  paymentMethods:'${paymentMethodsDb}',\n  shippingExceptions:'${shippingExceptionsDb}'\n};`,
      'config database'
    );

    const oldPaymentChoice = `/* INSTAGRAM_PAYMENT_BRANCH_AND_PRODUCT_QA_V1 */\nconst __paymentChoice=input=>{\n  const n=__normProduct(input);\n  if(/^(efectivo|cash|contra entrega|pago en efectivo)$/.test(n)||/\\befectivo\\b|\\bcash\\b|\\bcontra entrega\\b/.test(n)) return 'Efectivo';\n  if(/^(transferencia|transferir|transferencia bancaria|transferencia electronica)$/.test(n)||/\\btransferencia\\b|\\btransferir\\b/.test(n)) return 'Transferencia';\n  return '';\n};`;

    const newPaymentHelpers = `/* INSTAGRAM_PAYMENT_BRANCH_AND_PRODUCT_QA_V1 */\n${marker}\nconst __configTitle=p=>p?.title?.map(t=>t?.plain_text??t?.text?.content??'').join('')||'';\nconst __configRich=p=>p?.rich_text?.map(t=>t?.plain_text??t?.text?.content??'').join('')||'';\nlet __paymentMethodsCache=null;\nlet __shippingExceptionsCache=null;\nconst getPaymentMethods=async()=>{\n  if(Array.isArray(__paymentMethodsCache)) return __paymentMethodsCache;\n  const r=await notionReq('POST','https://api.notion.com/v1/databases/'+cfg.paymentMethods+'/query',{\n    filter:{property:'Activo',checkbox:{equals:true}},\n    sorts:[{property:'Orden',direction:'ascending'}],\n    page_size:100\n  });\n  __paymentMethodsCache=(r.results||[]).map(x=>{\n    const p=x.properties||{};\n    const name=__configTitle(p['Método de pago']);\n    const aliases=__configRich(p['Alias / palabras clave']).split(/[,;|\\n]/).map(v=>v.trim()).filter(Boolean);\n    return {\n      id:x.id,\n      name,\n      aliases,\n      order:Number(p.Orden?.number??9999),\n      requirements:__configRich(p['Requisitos / instrucciones']),\n      selectionMessage:__configRich(p['Mensaje al seleccionar']),\n      requiresReceipt:!!p['Requiere comprobante']?.checkbox\n    };\n  }).filter(x=>x.name).sort((a,b)=>a.order-b.order);\n  log('PAYMENT_METHODS_LOADED',{count:__paymentMethodsCache.length,methods:__paymentMethodsCache.map(x=>({name:x.name,requiresReceipt:x.requiresReceipt,order:x.order}))});\n  return __paymentMethodsCache;\n};\nconst __paymentChoice=(input,methods)=>{\n  const n=__normProduct(input);\n  if(!n) return null;\n  const list=methods||[];\n  const m=n.match(/^(?:(?:opcion|numero|metodo|pago)\\s*)?(\\d{1,2})$/);\n  if(m){const idx=Number(m[1])-1;if(list[idx])return list[idx];}\n  const scored=list.map(method=>{\n    const keys=[method.name,...(method.aliases||[])].map(__normProduct).filter(Boolean);\n    let score=0;\n    for(const key of keys){\n      if(n===key) score=Math.max(score,100);\n      else if(n.includes(key)) score=Math.max(score,90);\n      else if(key.includes(n)&&n.length>=4) score=Math.max(score,70);\n    }\n    return {method,score};\n  }).sort((a,b)=>b.score-a.score);\n  if(!scored[0]||scored[0].score<70) return null;\n  if(scored[1]&&scored[1].score===scored[0].score) return null;\n  return scored[0].method;\n};\nconst __paymentPrompt=(intro,methods)=>{\n  const list=(methods||[]).map((x,i)=>(i+1)+'. '+x.name).join('\\n');\n  return String(intro||'Selecciona tu método de pago.')+(list?'\\n\\n'+list+'\\n\\nResponde con el número o nombre del método de pago.':'');\n};\nconst __paymentRequirements=method=>[method?.selectionMessage,method?.requirements].map(v=>String(v||'').trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('\\n\\n');\nconst getShippingExceptions=async()=>{\n  if(Array.isArray(__shippingExceptionsCache)) return __shippingExceptionsCache;\n  const r=await notionReq('POST','https://api.notion.com/v1/databases/'+cfg.shippingExceptions+'/query',{\n    filter:{property:'Activo',checkbox:{equals:true}},\n    sorts:[{property:'Prioridad',direction:'descending'}],\n    page_size:100\n  });\n  __shippingExceptionsCache=(r.results||[]).map(x=>{\n    const p=x.properties||{};\n    const name=__configTitle(p['Destino / excepción']);\n    const aliases=__configRich(p['Alias / palabras clave']).split(/[,;|\\n]/).map(v=>v.trim()).filter(Boolean);\n    return {id:x.id,name,aliases,priority:Number(p.Prioridad?.number||0),rate:Number(p['Tarifa envío']?.number||0)};\n  }).filter(x=>x.name).sort((a,b)=>b.priority-a.priority);\n  log('SHIPPING_EXCEPTIONS_LOADED',{count:__shippingExceptionsCache.length,exceptions:__shippingExceptionsCache.map(x=>({name:x.name,rate:x.rate,priority:x.priority}))});\n  return __shippingExceptionsCache;\n};\nconst __resolveShippingCost=async(product,address,municipality,department)=>{\n  const fallback=Number(product?.shipping||0);\n  const haystack=__normProduct([address,municipality,department].filter(Boolean).join(' '));\n  if(!haystack) return {cost:fallback,matched:null};\n  const rules=await getShippingExceptions();\n  for(const rule of rules){\n    const keys=[rule.name,...(rule.aliases||[])].map(__normProduct).filter(Boolean);\n    if(keys.some(key=>haystack===key||haystack.includes(key))){\n      log('SHIPPING_EXCEPTION_MATCH',{destination:rule.name,rate:rule.rate,priority:rule.priority,address,municipality,department});\n      return {cost:Number(rule.rate||0),matched:rule};\n    }\n  }\n  return {cost:fallback,matched:null};\n};`;

    code = replaceOnce(code, oldPaymentChoice, newPaymentHelpers, 'payment helper');

    const oldStepPrompt = `const __stepPrompt=async(step,sessionLike)=>{\n  if(!step)return '';\n  if(step.field==='departamento')return __departmentPrompt(step.message,await getDepartments());\n  if(step.field==='municipio'){\n    const code=__geoRich(sessionLike?.properties?.['Código departamento (temporal)']);\n    const department=__geoRich(sessionLike?.properties?.['Departamento (temporal)']);\n    return __municipalityPrompt(step.message,department,code?await getMunicipalities(code):[]);\n  }\n  return step.message;\n};`;

    const newStepPrompt = `const __stepPrompt=async(step,sessionLike)=>{\n  if(!step)return '';\n  if(step.field==='departamento')return __departmentPrompt(step.message,await getDepartments());\n  if(step.field==='municipio'){\n    const code=__geoRich(sessionLike?.properties?.['Código departamento (temporal)']);\n    const department=__geoRich(sessionLike?.properties?.['Departamento (temporal)']);\n    return __municipalityPrompt(step.message,department,code?await getMunicipalities(code):[]);\n  }\n  if(step.field==='metodo_pago'){\n    const methods=await getPaymentMethods();\n    if(!methods.length) return 'No hay métodos de pago activos configurados. Intenta nuevamente más tarde.';\n    if(methods.length===1) return __paymentRequirements(methods[0])||('Método de pago: '+methods[0].name);\n    return __paymentPrompt(step.message,methods);\n  }\n  return step.message;\n};`;

    code = replaceOnce(code, oldStepPrompt, newStepPrompt, 'step prompt');

    const paymentStart = `    }else if(current.field==='metodo_pago'){`;
    const paymentEnd = `    }else{\n      const valid=current.expected==='imagen'?!!image:current.expected==='telefono'?__validPhone(text):current.expected==='numero'?/^\\d+(\\.\\d+)?$/.test(text):!!text;`;
    const startIndex = code.indexOf(paymentStart);
    const endIndex = code.indexOf(paymentEnd, startIndex);
    if (startIndex < 0 || endIndex < 0) throw new Error('payment branch anchors not found');

    const newPaymentBranch = `    }else if(current.field==='metodo_pago'){\n      const paymentMethods=await getPaymentMethods();\n      if(!paymentMethods.length){\n        reply='No hay métodos de pago activos configurados. Intenta nuevamente más tarde.';\n      }else{\n        const storedPaymentName=rich(session.properties['Método de pago (temporal)']);\n        const storedPayment=paymentMethods.find(m=>__normProduct(m.name)===__normProduct(storedPaymentName))||null;\n        const paymentMethod=paymentMethods.length===1?(storedPayment||paymentMethods[0]):__paymentChoice(text,paymentMethods);\n        if(!paymentMethod){\n          reply=__paymentPrompt(current.message,paymentMethods);\n        }else if(paymentMethod.requiresReceipt){\n          const receiptStep=steps.find(s=>s.order<current.order&&s.field==='foto_boleta');\n          if(!receiptStep) throw new Error('No active foto_boleta step found after payment method');\n          await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:{\n            'Método de pago (temporal)':{rich_text:[{text:{content:paymentMethod.name}}]},\n            'Paso actual':{relation:[{id:receiptStep.id}]},\n            'Última actividad':{date:{start:now}}\n          }});\n          reply=[__paymentRequirements(paymentMethod),receiptStep.message].map(v=>String(v||'').trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('\\n\\n');\n        }else{\n          const productRel=session.properties['Producto elegido']?.relation||[];\n          const product=activeProduct||products.find(p=>p.id===productRel[0]?.id);\n          const qty=session.properties.Cantidad?.number||1;\n          const address=rich(session.properties['Dirección (temporal)']);\n          const department=rich(session.properties['Departamento (temporal)']);\n          const municipality=rich(session.properties['Municipio (temporal)']);\n          const municipalityCode=rich(session.properties['Código municipio (temporal)']);\n          const fullAddress=[address,municipality,department].filter(Boolean).join(', ');\n          const phone=session.properties['Teléfono (temporal)']?.phone_number||'';\n          const shippingQuote=await __resolveShippingCost(product,address,municipality,department);\n          const shippingCost=shippingQuote.cost;\n          const total=(product?.price||0)*qty+shippingCost;\n          await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:{\n            'Método de pago (temporal)':{rich_text:[{text:{content:paymentMethod.name}}]},\n            'Última actividad':{date:{start:now}}\n          }});\n          const shippingNote=shippingQuote.matched?' · Tarifa envío: '+shippingQuote.matched.name+' Q'+shippingCost:'';\n          const orderProps={\n            Name:{title:[{text:{content:'Pedido #'+orderNumber+(igUsername?' - @'+igUsername:'')}}]},\n            'Teléfono':{phone_number:phone},\n            'IGSID':{rich_text:[{text:{content:sender}}]},\n            'Usuario Instagram':{rich_text:igUsername?[{text:{content:igUsername}}]:[]},\n            'Nombre cliente':{rich_text:clientName?[{text:{content:clientName}}]:[]},\n            'Pedido #':{number:orderNumber},\n            'Dirección envío':{rich_text:fullAddress?[{text:{content:fullAddress}}]:[]},\n            'Departamento':{rich_text:department?[{text:{content:department}}]:[]},\n            'Municipio':{rich_text:municipality?[{text:{content:municipality}}]:[]},\n            'Código municipio':{rich_text:municipalityCode?[{text:{content:municipalityCode}}]:[]},\n            'Producto(s)':{relation:productRel},\n            Cantidad:{number:qty},\n            'Precio unitario':{number:product?.price||0},\n            'Costo envío':{number:shippingCost},\n            Total:{number:total},\n            'Método de pago':{select:{name:paymentMethod.name}},\n            'Estado pedido':{select:{name:'Recibido'}},\n            'Estado facturación':{select:{name:'Pendiente'}},'Último estado notificado':{rich_text:[{text:{content:'Recibido'}}]},'Fecha última notificación':{date:{start:now}},'Último estado facturación notificado':{rich_text:[{text:{content:'Pendiente'}}]},'Fecha última notificación facturación':{date:{start:now}},\n            'Saldo cobrado':{number:0},\n            'Saldo pendiente':{number:total},\n            Origen:{select:{name:'Instagram'}},\n            'Historial / Notas':{rich_text:[{text:{content:'Pedido creado desde Instagram el '+now+' · Pago: '+paymentMethod.name+shippingNote}}]}\n          };\n          await notionReq('POST','https://api.notion.com/v1/pages',{parent:{database_id:cfg.orders},properties:orderProps});\n          await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{archived:true});\n          reply=await getSalesMessageTemplate('Pedido registrado · Efectivo',{nombre:clientName||igUsername||'',username:igUsername||'',pedido:orderNumber,total,metodo_pago:paymentMethod.name});\n          if(!reply) reply='Hola '+(clientName||igUsername||'')+' 👋 Recibimos tu pedido #'+orderNumber+'. Total: Q'+total+'. Método de pago: '+paymentMethod.name+'.';\n        }\n      }`;

    code = code.slice(0, startIndex) + newPaymentBranch + code.slice(endIndex);

    const oldNextBlock = `      if(next){\n        props['Paso actual']={relation:[{id:next.id}]};\n        await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:props});\n        reply=next.message;\n      }else{`;

    const newNextBlock = `      if(next){\n        if(next.field==='metodo_pago'){\n          const paymentMethods=await getPaymentMethods();\n          if(!paymentMethods.length) throw new Error('No active payment methods configured');\n          if(paymentMethods.length===1){\n            const only=paymentMethods[0];\n            props['Método de pago (temporal)']={rich_text:[{text:{content:only.name}}]};\n            if(only.requiresReceipt){\n              const receiptStep=steps.find(s=>s.order<next.order&&s.field==='foto_boleta');\n              if(!receiptStep) throw new Error('No active foto_boleta step found for single payment method');\n              props['Paso actual']={relation:[{id:receiptStep.id}]};\n              await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:props});\n              reply=[__paymentRequirements(only),receiptStep.message].map(v=>String(v||'').trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('\\n\\n');\n            }else{\n              props['Paso actual']={relation:[{id:next.id}]};\n              await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:props});\n              reply=__paymentRequirements(only)||('Método de pago: '+only.name);\n            }\n          }else{\n            props['Paso actual']={relation:[{id:next.id}]};\n            await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:props});\n            reply=__paymentPrompt(next.message,paymentMethods);\n          }\n        }else{\n          props['Paso actual']={relation:[{id:next.id}]};\n          await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:props});\n          reply=await __stepPrompt(next,session);\n        }\n      }else{`;

    code = replaceOnce(code, oldNextBlock, newNextBlock, 'generic next step');

    const oldTransferTotal = `        const total=(product?.price||0)*qty+(product?.shipping||0);\n        const paymentMethod=rich(session.properties['Método de pago (temporal)'])||(current.field==='foto_boleta'?'Transferencia':'Transferencia');`;
    const newTransferTotal = `        const shippingQuote=await __resolveShippingCost(product,address,municipality,department);\n        const shippingCost=shippingQuote.cost;\n        const total=(product?.price||0)*qty+shippingCost;\n        const paymentMethods=await getPaymentMethods();\n        const paymentMethod=rich(session.properties['Método de pago (temporal)'])||paymentMethods.find(m=>m.requiresReceipt)?.name||'Transferencia';`;
    code = replaceOnce(code, oldTransferTotal, newTransferTotal, 'receipt total');

    const oldTransferOrderCost = `'Costo envío':{number:product?.shipping||0},Total:{number:total},'Método de pago':{select:{name:paymentMethod}}`;
    const newTransferOrderCost = `'Costo envío':{number:shippingCost},Total:{number:total},'Método de pago':{select:{name:paymentMethod}}`;
    code = replaceOnce(code, oldTransferOrderCost, newTransferOrderCost, 'receipt order shipping');

    const oldTransferHistory = `'Historial / Notas':{rich_text:[{text:{content:'Pedido creado desde Instagram el '+now}}]}};`;
    const newTransferHistory = `'Historial / Notas':{rich_text:[{text:{content:'Pedido creado desde Instagram el '+now+(shippingQuote.matched?' · Tarifa envío: '+shippingQuote.matched.name+' Q'+shippingCost:'')}}]}};`;
    code = replaceOnce(code, oldTransferHistory, newTransferHistory, 'receipt history');

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

    console.log('[INSTAGRAM_PAYMENT_SHIPPING] applied ' + JSON.stringify({
      workflowId,
      paymentMethodsDb,
      shippingExceptionsDb,
      behavior: {
        dynamicPaymentMethods: true,
        singlePaymentAutoRequirements: true,
        shippingExceptions: true,
      },
      versionsUpdated: versionIds,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[INSTAGRAM_PAYMENT_SHIPPING] failed: ' + String(error?.message || error));
  process.exit(1);
});

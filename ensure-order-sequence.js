const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[ORDER_SEQUENCE] missing ${key}`);
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
  ssl: sslEnabled ? {
    rejectUnauthorized: bool(env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED, false),
  } : false,
};

const tempWorkflowIds = [
  'Evm8vkCWCQbGmdxU', // TEMP — Inspect Workflow DB Schema
  'QcFfSyIGKn6kwJoz', // TEMP — Patch English Action Admin Router
];

const instagramWorkflowId = '6l5IbTxGdwcL24wT';
const instagramEngineNodeName = 'Dynamic Notion Sales Engine';
const sessionTimeoutMarker = '/* INSTAGRAM_SESSION_INACTIVITY_15M_V1 */';
const phonePromptMarker = '/* INSTAGRAM_PHONE_PROMPT_NO_MAX_LENGTH_V1 */';
const defaultProductMarker = '/* INSTAGRAM_DEFAULT_PRODUCT_QA_V1 */';
const editOrderFieldsMarker = '/* INSTAGRAM_EDIT_ADDRESS_PHONE_V1 */';

async function patchInstagramWorkflow(client) {
  const result = await client.query(`
    SELECT nodes, "versionId", "activeVersionId"
    FROM public.workflow_entity
    WHERE id = $1
  `, [instagramWorkflowId]);

  if (result.rowCount !== 1) {
    console.log('[INSTAGRAM_PATCH] workflow not found ' + instagramWorkflowId);
    return;
  }

  const row = result.rows[0];
  const nodes = Array.isArray(row.nodes) ? row.nodes : JSON.parse(row.nodes || '[]');
  const engine = nodes.find(node => node?.name === instagramEngineNodeName);
  if (!engine?.parameters?.jsCode) {
    throw new Error('Instagram engine code node not found');
  }

  let code = String(engine.parameters.jsCode);
  let changed = false;

  if (!code.includes(sessionTimeoutMarker)) {
    const sessionNeedle = '  const session=(sessionData.results||[])[0];';
    if (!code.includes(sessionNeedle)) {
      throw new Error('Instagram session initialization anchor not found');
    }

    const sessionReplacement = `  let session=(sessionData.results||[])[0];\n  ${sessionTimeoutMarker}\n  if(session){\n    const lastActivity=session.properties?.['Última actividad']?.date?.start||'';\n    const lastActivityMs=lastActivity?Date.parse(lastActivity):NaN;\n    const inactivityMs=15*60*1000;\n    if(Number.isFinite(lastActivityMs)&&(Date.now()-lastActivityMs)>=inactivityMs){\n      log('SESSION_EXPIRED_INACTIVITY',{sender,sessionId:session.id,lastActivity,timeoutMinutes:15});\n      await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{archived:true});\n      session=null;\n    }else{\n      await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:{'Última actividad':{date:{start:now}}}});\n    }\n  }`;

    code = code.replace(sessionNeedle, sessionReplacement);
    changed = true;
  }

  if (!code.includes(phonePromptMarker)) {
    const phoneNeedle = "current.expected==='telefono'?('El número de teléfono debe tener entre 8 y 15 dígitos. '+currentPrompt)";
    if (!code.includes(phoneNeedle)) {
      throw new Error('Instagram phone validation message anchor not found');
    }

    code = code.replace(phoneNeedle, "current.expected==='telefono'?currentPrompt");
    code = code.replace(
      '      /* INSTAGRAM_IMAGE_PROMPT_NO_REDUNDANT_PREFIX */',
      `      /* INSTAGRAM_IMAGE_PROMPT_NO_REDUNDANT_PREFIX */\n      ${phonePromptMarker}`,
    );
    changed = true;
  }

  if (!code.includes(defaultProductMarker)) {
    const defaultQuestionAnchor = "    const question=__productQuestion(text);\n    if(__wantsCatalog(text)){";
    if (!code.includes(defaultQuestionAnchor)) {
      throw new Error('Instagram default-product question anchor not found');
    }
    code = code.replace(
      defaultQuestionAnchor,
      `    const question=__productQuestion(text);\n    ${defaultProductMarker}\n    const questionProduct=product||products[0]||null;\n    if(__wantsCatalog(text)){`,
    );

    const defaultAnswerNeedle = "    }else if(question.isQuestion&&product){\n      reply=__answerProduct(text,product)+'\\n\\nSi deseas pedirlo, escribe: \"Quiero '+product.name+'\".';";
    if (!code.includes(defaultAnswerNeedle)) {
      throw new Error('Instagram default-product answer anchor not found');
    }
    code = code.replace(
      defaultAnswerNeedle,
      "    }else if(question.isQuestion&&questionProduct){\n      reply=__answerProduct(text,questionProduct)+'\\n\\nSi deseas pedirlo, escribe: \"Quiero '+questionProduct.name+'\".';",
    );

    const activeQuestionNeedle = "    }else if(question.isQuestion&&(referencedProduct||activeProduct)){\n      const targetProduct=referencedProduct||activeProduct;";
    if (!code.includes(activeQuestionNeedle)) {
      throw new Error('Instagram active-session product question anchor not found');
    }
    code = code.replace(
      activeQuestionNeedle,
      "    }else if(question.isQuestion&&(referencedProduct||activeProduct||products[0])){\n      const targetProduct=referencedProduct||activeProduct||products[0];",
    );
    changed = true;
  }

  if (!code.includes(editOrderFieldsMarker)) {
    const helperAnchor = "const __wantsProductChange=input=>/(cambiar|cambia|cambio|prefiero|mejor|otro producto|quiero otro)/.test(__normProduct(input));";
    if (!code.includes(helperAnchor)) {
      throw new Error('Instagram edit-field helper anchor not found');
    }
    const helper = `${helperAnchor}\n${editOrderFieldsMarker}\nconst __editOrderFieldIntent=input=>{\n  const n=__normProduct(input);\n  const wantsEdit=/(^|\\b)(cambiar|cambia|cambio|actualizar|actualiza|modificar|modifica|editar|edita|corregir|corrige)(\\b|$)/.test(n);\n  if(!wantsEdit) return '';\n  if(/\\b(direccion|domicilio|ubicacion|direccion de entrega)\\b/.test(n)) return 'direccion';\n  if(/\\b(telefono|numero de telefono|celular|movil)\\b/.test(n)) return 'telefono';\n  return '';\n};`;
    code = code.replace(helperAnchor, helper);

    const sessionIntentAnchor = "    const question=__productQuestion(text);\n    const exactReferenced=referencedProduct&&__normProduct(text)===referencedProduct.normalizedName;";
    if (!code.includes(sessionIntentAnchor)) {
      throw new Error('Instagram edit-field session intent anchor not found');
    }
    code = code.replace(
      sessionIntentAnchor,
      "    const question=__productQuestion(text);\n    const editOrderField=__editOrderFieldIntent(text);\n    const exactReferenced=referencedProduct&&__normProduct(text)===referencedProduct.normalizedName;",
    );

    const branchAnchor = "      reply='Pedido cancelado. Empecemos de nuevo.'+(list?'\\n\\nProductos disponibles:\\n'+list+'\\n\\nResponde con el número o nombre del producto.':'');\n    }else if(__wantsCatalog(text)){";
    if (!code.includes(branchAnchor)) {
      throw new Error('Instagram edit-field branch anchor not found');
    }
    const editBranch = `      reply='Pedido cancelado. Empecemos de nuevo.'+(list?'\\n\\nProductos disponibles:\\n'+list+'\\n\\nResponde con el número o nombre del producto.':'');\n    }else if(editOrderField){\n      const targetStep=steps.find(s=>s.field===editOrderField);\n      if(!targetStep){\n        reply='No pude encontrar el paso para actualizar ese dato. Seguimos donde quedamos: '+currentPrompt;\n      }else{\n        await notionReq('PATCH','https://api.notion.com/v1/pages/'+session.id,{properties:{\n          'Paso actual':{relation:[{id:targetStep.id}]},\n          'Última actividad':{date:{start:now}}\n        }});\n        reply=await __stepPrompt(targetStep,session);\n        log('ORDER_FIELD_EDIT_REQUESTED',{sender,sessionId:session.id,orderNumber,field:editOrderField,targetStepId:targetStep.id});\n      }\n    }else if(__wantsCatalog(text)){`;
    code = code.replace(branchAnchor, editBranch);
    changed = true;
  }

  if (!changed) {
    console.log('[INSTAGRAM_PATCH] already applied ' + JSON.stringify({
      workflowId: instagramWorkflowId,
      timeoutMinutes: 15,
      phoneMaxLengthMessageRemoved: true,
      defaultProductQuestions: true,
      editableOrderFields: ['direccion','telefono'],
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
    `, [instagramWorkflowId, nodesJson]);

    if (versionIds.length) {
      await client.query(`
        UPDATE public.workflow_history
        SET nodes = $2::json,
            "updatedAt" = NOW()
        WHERE "workflowId" = $1
          AND "versionId" = ANY($3::text[])
      `, [instagramWorkflowId, nodesJson, versionIds]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  console.log('[INSTAGRAM_PATCH] applied ' + JSON.stringify({
    workflowId: instagramWorkflowId,
    timeoutMinutes: 15,
    refreshActivityOnCustomerMessage: true,
    phoneMaxLengthMessageRemoved: true,
    defaultProductQuestions: true,
    defaultProductStrategy: 'catalog_index_1',
    editableOrderFields: ['direccion','telefono'],
    versionsUpdated: versionIds,
  }));
}

async function main() {
  const client = new Client(config);
  await client.connect();
  try {
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS public.instagram_order_number_seq
      START WITH 1000
      INCREMENT BY 1
      MINVALUE 1000
      NO MAXVALUE
      CACHE 1
    `);

    const verify = await client.query(`
      SELECT sequence_name, start_value, increment
      FROM information_schema.sequences
      WHERE sequence_schema = 'public'
        AND sequence_name = 'instagram_order_number_seq'
    `);

    if (verify.rowCount !== 1) throw new Error('sequence verification failed');
    console.log('[ORDER_SEQUENCE] ready ' + JSON.stringify(verify.rows[0]));

    try {
      const result = await client.query(`
        UPDATE public.workflow_entity
        SET active = FALSE
        WHERE id = ANY($1::text[])
        RETURNING id, name, active
      `, [tempWorkflowIds]);

      const found = new Set(result.rows.map(row => String(row.id)));
      const missing = tempWorkflowIds.filter(id => !found.has(id));
      console.log('[TEMP_WORKFLOWS] deactivated ' + JSON.stringify({
        updated: result.rows,
        missing,
      }));
    } catch (error) {
      console.error('[TEMP_WORKFLOWS] deactivate failed: ' + String(error?.message || error));
    }

    try {
      await patchInstagramWorkflow(client);
    } catch (error) {
      console.error('[INSTAGRAM_PATCH] failed: ' + String(error?.message || error));
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[ORDER_SEQUENCE] failed: ' + String(error?.message || error));
  process.exit(1);
});

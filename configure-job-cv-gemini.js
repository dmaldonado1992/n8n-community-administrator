const { Client } = require('pg');
const { randomUUID } = require('crypto');

const WORKFLOW_ID = '3oZKJ4wjCmQhWdmB';
const MODELS = ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];
const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error('[JOB_CV_GEMINI] missing ' + key);
    process.exit(1);
  }
}
const bool = (value, fallback = false) => value == null || value === '' ? fallback : /^(1|true|yes|on)$/i.test(String(value));
const client = new Client({
  host: env.DB_POSTGRESDB_HOST,
  port: Number(env.DB_POSTGRESDB_PORT || 5432),
  database: env.DB_POSTGRESDB_DATABASE,
  user: env.DB_POSTGRESDB_USER,
  password: env.DB_POSTGRESDB_PASSWORD,
  connectionTimeoutMillis: 10000,
  ssl: bool(env.DB_POSTGRESDB_SSL_ENABLED, false) ? { rejectUnauthorized: bool(env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED, false) } : false,
});

function configure(workflow) {
  const obsolete = new Set(['Generar contenido de CV','Gemini CV 1','Gemini CV OK 1','Gemini CV 2','Gemini CV OK 2','Gemini CV 3','Gemini CV OK 3','Normalize Gemini CV','Gemini CV Failed']);
  const nodes = workflow.nodes.filter((node) => !obsolete.has(node.name));
  const prompt = nodes.find((node) => node.name === 'Build Truthful Adaptation Prompt');
  if (!prompt) throw new Error('Prompt builder node was not found');
  const connections = Object.fromEntries(Object.entries(workflow.connections || {}).filter(([name]) => !obsolete.has(name)));
  const httpNode = (index, model, x) => ({
    parameters: {
      method: 'POST',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'key', value: '={{ $env.GEMINI_API_KEY || $env.GOOGLE_API_KEY || $env.GOOGLE_GEMINI_API_KEY }}' }] },
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: "={{ JSON.stringify({ contents: [{ role: 'user', parts: [{ text: $('Build Truthful Adaptation Prompt').item.json.prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }) }}",
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 60000 },
    },
    id: randomUUID(), name: 'Gemini CV ' + index, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [480 + (index - 1) * 320, 0],
  });
  const ifNode = (index) => ({
    parameters: {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: randomUUID(), leftValue: '={{ $json.statusCode }}', rightValue: 200, operator: { type: 'number', operation: 'equals' } }], combinator: 'and' },
      options: {},
    },
    id: randomUUID(), name: 'Gemini CV OK ' + index, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [640 + (index - 1) * 320, 0],
  });
  MODELS.forEach((model, i) => nodes.push(httpNode(i + 1, model), ifNode(i + 1)));
  nodes.push({
    parameters: { jsCode: "const response=$json.body??$json;const text=response?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';if(!text) throw new Error('Gemini returned no text');return [{json:{output_text:text,provider:'google-gemini',modelUsed:response.modelVersion||null}}];" },
    id: randomUUID(), name: 'Normalize Gemini CV', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1440, -180],
  });
  nodes.push({
    parameters: { jsCode: "const detail=$json.body?.error?.message||$json.statusMessage||'All Gemini models failed';throw new Error(detail);" },
    id: randomUUID(), name: 'Gemini CV Failed', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1440, 220],
  });
  connections[prompt.name] = { main: [[{ node: 'Gemini CV 1', type: 'main', index: 0 }]] };
  connections['Gemini CV 1'] = { main: [[{ node: 'Gemini CV OK 1', type: 'main', index: 0 }]] };
  connections['Gemini CV OK 1'] = { main: [[{ node: 'Normalize Gemini CV', type: 'main', index: 0 }],[{ node: 'Gemini CV 2', type: 'main', index: 0 }]] };
  connections['Gemini CV 2'] = { main: [[{ node: 'Gemini CV OK 2', type: 'main', index: 0 }]] };
  connections['Gemini CV OK 2'] = { main: [[{ node: 'Normalize Gemini CV', type: 'main', index: 0 }],[{ node: 'Gemini CV 3', type: 'main', index: 0 }]] };
  connections['Gemini CV 3'] = { main: [[{ node: 'Gemini CV OK 3', type: 'main', index: 0 }]] };
  connections['Gemini CV OK 3'] = { main: [[{ node: 'Normalize Gemini CV', type: 'main', index: 0 }],[{ node: 'Gemini CV Failed', type: 'main', index: 0 }]] };
  return { nodes, connections };
}

async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('job-cv-gemini-v1'))");
    const result = await client.query('SELECT * FROM public.workflow_entity WHERE id=$1 FOR UPDATE', [WORKFLOW_ID]);
    if (result.rowCount !== 1) throw new Error('Workflow not found: ' + WORKFLOW_ID);
    const workflow = result.rows[0];
    if (workflow.nodes.some((node) => node.name === 'Gemini CV 1')) {
      await client.query('COMMIT');
      console.log('[JOB_CV_GEMINI] already configured');
      return;
    }
    const configured = configure(workflow);
    const versionId = randomUUID();
    const history = await client.query('SELECT authors FROM public.workflow_history WHERE "workflowId"=$1 ORDER BY "createdAt" DESC LIMIT 1', [WORKFLOW_ID]);
    const authors = history.rows[0]?.authors || 'Daniel Maldonado';
    await client.query(
      'INSERT INTO public.workflow_history ("versionId","workflowId",authors,"createdAt","updatedAt",nodes,connections,name,autosaved,description) VALUES ($1,$2,$3,NOW(),NOW(),$4::json,$5::json,$6,FALSE,$7)',
      [versionId, WORKFLOW_ID, authors, JSON.stringify(configured.nodes), JSON.stringify(configured.connections), workflow.name, workflow.description],
    );
    await client.query(
      'UPDATE public.workflow_entity SET nodes=$2::json,connections=$3::json,"versionId"=$4,"versionCounter"="versionCounter"+1,"updatedAt"=NOW() WHERE id=$1',
      [WORKFLOW_ID, JSON.stringify(configured.nodes), JSON.stringify(configured.connections), versionId],
    );
    const verify = await client.query("SELECT json_array_length(nodes) AS node_count, nodes::text LIKE '%Gemini CV 1%' AS configured FROM public.workflow_entity WHERE id=$1", [WORKFLOW_ID]);
    if (!verify.rows[0]?.configured) throw new Error('Database verification failed');
    await client.query('COMMIT');
    console.log('[JOB_CV_GEMINI] configured ' + JSON.stringify({ workflowId: WORKFLOW_ID, models: MODELS, nodeCount: verify.rows[0].node_count, versionId }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error('[JOB_CV_GEMINI] failed: ' + String(error?.message || error));
  process.exit(1);
});

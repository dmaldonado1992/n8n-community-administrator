const { randomUUID } = require('crypto');
const { Client } = require('pg');

const WORKFLOW_ID = '3oZKJ4wjCmQhWdmB';
const PROMPT_NODE = 'Build Truthful Adaptation Prompt';
const MODEL_CONFIG = new Map([
  ['Gemini CV 1', 'gemini-3-flash-preview'],
  ['Gemini CV 2', 'gemini-flash-latest'],
  ['Gemini CV 3', 'gemini-2.5-flash-lite'],
]);
const REQUIRED_ENV = [
  'DB_POSTGRESDB_HOST',
  'DB_POSTGRESDB_DATABASE',
  'DB_POSTGRESDB_USER',
  'DB_POSTGRESDB_PASSWORD',
];
const env = process.env;

for (const key of REQUIRED_ENV) {
  if (!env[key]) {
    console.error(`[JOB_CV_GEMINI] missing ${key}`);
    process.exit(1);
  }
}

const parseBoolean = (value, fallback = false) => (
  value == null || value === '' ? fallback : /^(1|true|yes|on)$/i.test(String(value))
);

const client = new Client({
  host: env.DB_POSTGRESDB_HOST,
  port: Number(env.DB_POSTGRESDB_PORT || 5432),
  database: env.DB_POSTGRESDB_DATABASE,
  user: env.DB_POSTGRESDB_USER,
  password: env.DB_POSTGRESDB_PASSWORD,
  connectionTimeoutMillis: 10000,
  ssl: parseBoolean(env.DB_POSTGRESDB_SSL_ENABLED)
    ? { rejectUnauthorized: parseBoolean(env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED) }
    : false,
});

const PROMPT_CODE = "const rawJob=$json.job_json;let job;try{job=typeof rawJob==='string'?JSON.parse(rawJob):rawJob;}catch{throw new Error('job_json must be valid JSON');}if(!job||typeof job!=='object'||Array.isArray(job))throw new Error('job_json must be an object');const facts={yearsExperience:'12+ years',roles:['Full Stack Developer','Technical Lead'],coreStack:['Java','Spring Boot','Angular','TypeScript','Node.js','SQL','Docker','Azure DevOps','AWS'],languages:'Spanish native; English A2/B1-compatible'};const instructions=String(job.language||'EN').toUpperCase()==='ES'?'Responde solo JSON válido con TARGET_HEADLINE, SUMMARY y COVER_LETTER. Usa únicamente los hechos listados; no inventes experiencia.':'Return only valid JSON with TARGET_HEADLINE, SUMMARY and COVER_LETTER. Use only the listed facts; do not invent experience.';return [{json:{job,profile:$json.profile,masterFileId:$json.master_file_id,notionPageId:$json.notion_page_id,prompt:instructions+'\\nFACTS:'+JSON.stringify(facts)+'\\nVACANCY:'+JSON.stringify(job)}}];";
const GEMINI_BODY = "={{ JSON.stringify({ contents: [{ role: 'user', parts: [{ text: $('Build Truthful Adaptation Prompt').item.json.prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }) }}";
const GLM_BODY = "={{ JSON.stringify({ model: 'glm-4.5-flash', messages: [{ role: 'user', content: $('Build Truthful Adaptation Prompt').item.json.prompt }], temperature: 0.2 }) }}";

function getNode(nodes, name) {
  const node = nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Required node not found: ${name}`);
  return node;
}

function setConnection(connections, source, targets) {
  connections[source] = {
    main: targets.map((branch) => branch.map((node) => ({ node, type: 'main', index: 0 }))),
  };
}

function configureTrigger(nodes) {
  const trigger = getNode(nodes, 'When Called after Match');
  trigger.parameters = trigger.parameters || {};
  trigger.parameters.workflowInputs = {
    values: [
      { name: 'job_json' },
      { name: 'profile' },
      { name: 'master_file_id' },
      { name: 'notion_page_id' },
    ],
  };
}

function configurePrompt(nodes) {
  let prompt = nodes.find((node) => node.name === PROMPT_NODE);
  if (!prompt) {
    prompt = {
      id: randomUUID(),
      name: PROMPT_NODE,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [240, 0],
      parameters: {},
    };
    nodes.push(prompt);
  }
  prompt.parameters = { jsCode: PROMPT_CODE };
}

function configureHttpNode(node) {
  node.onError = 'continueRegularOutput';
  node.parameters.options = node.parameters.options || {};
  node.parameters.options.response = {
    response: { fullResponse: true, neverError: true },
  };
}

function configureModels(nodes) {
  for (const [name, model] of MODEL_CONFIG) {
    const node = getNode(nodes, name);
    configureHttpNode(node);
    node.parameters.url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    node.parameters.body = GEMINI_BODY;
  }

  const glm = getNode(nodes, 'GLM Fallback Zai');
  configureHttpNode(glm);
  glm.parameters.url = 'https://api.z.ai/api/paas/v4/chat/completions';
  glm.parameters.body = GLM_BODY;
}

function configureConnections(connections) {
  setConnection(connections, 'When Called after Match', [[PROMPT_NODE]]);
  setConnection(connections, PROMPT_NODE, [['Gemini CV 1']]);
  setConnection(connections, 'Gemini CV 1', [['Gemini CV OK 1']]);
  setConnection(connections, 'Gemini CV OK 1', [['Normalize Gemini CV'], ['Gemini CV 2']]);
  setConnection(connections, 'Gemini CV 2', [['Gemini CV OK 2']]);
  setConnection(connections, 'Gemini CV OK 2', [['Normalize Gemini CV'], ['Gemini CV 3']]);
  setConnection(connections, 'Gemini CV 3', [['Gemini CV OK 3']]);
  setConnection(connections, 'Gemini CV OK 3', [['Normalize Gemini CV'], ['GLM Fallback Zai']]);
  setConnection(connections, 'GLM Fallback Zai', [['GLM Fallback OK']]);
  setConnection(connections, 'GLM Fallback OK', [['Normalize GLM CV'], ['All Models Failed']]);
}

function assertNoOpenAi(nodes) {
  const found = nodes.some((node) => JSON.stringify(node).toLowerCase().includes('openai'));
  if (found) throw new Error('OpenAI node/config detected; refusing to apply');
}

function configure(workflow) {
  const nodes = structuredClone(workflow.nodes || []);
  const connections = structuredClone(workflow.connections || {});
  configureTrigger(nodes);
  configurePrompt(nodes);
  configureModels(nodes);
  configureConnections(connections);
  assertNoOpenAi(nodes);
  return { nodes, connections };
}

function assertConfigured(workflow) {
  const names = new Set(workflow.nodes.map((node) => node.name));
  const required = [PROMPT_NODE, ...MODEL_CONFIG.keys(), 'GLM Fallback Zai', 'All Models Failed'];
  for (const name of required) {
    if (!names.has(name)) throw new Error(`Verification failed; missing node: ${name}`);
  }
  for (const name of [...MODEL_CONFIG.keys(), 'GLM Fallback Zai']) {
    if (getNode(workflow.nodes, name).onError !== 'continueRegularOutput') {
      throw new Error(`Verification failed; transport fallback disabled: ${name}`);
    }
  }
  assertNoOpenAi(workflow.nodes);
}

async function saveWorkflow(workflow, configured) {
  const versionId = randomUUID();
  const history = await client.query(
    'SELECT authors FROM public.workflow_history WHERE "workflowId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
    [WORKFLOW_ID],
  );
  const authors = history.rows[0]?.authors || 'Daniel Maldonado';
  await client.query(
    'INSERT INTO public.workflow_history ("versionId","workflowId",authors,"createdAt","updatedAt",nodes,connections,name,autosaved,description) VALUES ($1,$2,$3,NOW(),NOW(),$4::json,$5::json,$6,FALSE,$7)',
    [versionId, WORKFLOW_ID, authors, JSON.stringify(configured.nodes), JSON.stringify(configured.connections), workflow.name, workflow.description],
  );
  await client.query(
    'UPDATE public.workflow_entity SET nodes=$2::json,connections=$3::json,"versionId"=$4,"versionCounter"="versionCounter"+1,"updatedAt"=NOW() WHERE id=$1',
    [WORKFLOW_ID, JSON.stringify(configured.nodes), JSON.stringify(configured.connections), versionId],
  );
  return versionId;
}

async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('job-cv-gemini-v2'))");
    const result = await client.query('SELECT * FROM public.workflow_entity WHERE id=$1 FOR UPDATE', [WORKFLOW_ID]);
    if (result.rowCount !== 1) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

    const workflow = result.rows[0];
    const configured = configure(workflow);
    assertConfigured(configured);
    const unchanged = JSON.stringify(workflow.nodes) === JSON.stringify(configured.nodes)
      && JSON.stringify(workflow.connections) === JSON.stringify(configured.connections);
    const dryRun = parseBoolean(env.JOB_CV_GEMINI_DRY_RUN);

    if (dryRun || unchanged) {
      await client.query('ROLLBACK');
      console.log(`[JOB_CV_GEMINI] ${dryRun ? 'dry-run valid' : 'already configured'}`);
      return;
    }

    const versionId = await saveWorkflow(workflow, configured);
    const verify = await client.query('SELECT nodes,connections FROM public.workflow_entity WHERE id=$1', [WORKFLOW_ID]);
    assertConfigured(verify.rows[0]);
    await client.query('COMMIT');
    console.log(`[JOB_CV_GEMINI] repaired ${JSON.stringify({ workflowId: WORKFLOW_ID, versionId })}`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(`[JOB_CV_GEMINI] rollback failed: ${String(rollbackError?.message || rollbackError)}`);
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[JOB_CV_GEMINI] failed: ${String(error?.message || error)}`);
  process.exit(1);
});


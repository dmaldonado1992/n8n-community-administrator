const { randomUUID } = require('crypto');
const { Client } = require('pg');

const GATEWAY_ID = 'HktxtfXtASJInxsG';
const DATABASE_ID = 'db72d8bbd4484bc4b6f90151310792ab';
const REQUIRED_ENV = ['DB_POSTGRESDB_HOST', 'DB_POSTGRESDB_DATABASE', 'DB_POSTGRESDB_USER', 'DB_POSTGRESDB_PASSWORD'];
const env = process.env;

for (const key of REQUIRED_ENV) {
  if (!env[key]) throw new Error(`Missing ${key}`);
}

const parseBoolean = (value) => /^(1|true|yes|on)$/i.test(String(value || ''));
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

const NODE_NAMES = {
  trigger: 'Check Approved Applications',
  query: 'Notion — Query Application Queue',
  split: 'Split Application Queue',
  prepare: 'Prepare Platform Application',
  claim: 'Notion — Claim Application',
  blocks: 'Notion — Load Adapted CV Blocks',
  request: 'Build Platform Application Request',
  apply: 'Application Runner — Platform API',
  update: 'Build Application Result Update',
  save: 'Notion — Save Application Result',
};

const SPLIT_CODE = "const response=$json.body??$json;const results=Array.isArray(response.results)?response.results:[];return results.map(page=>({json:{page}}));";
const PREPARE_CODE = "const page=$json.page||{};const p=page.properties||{};const title=v=>(v?.title||[]).map(x=>x.plain_text||'').join('');const rich=v=>(v?.rich_text||[]).map(x=>x.plain_text||'').join('');const selected=v=>v?.select?.name||'';const url=v=>v?.url||'';const number=v=>Number(v?.number||0);const platform=selected(p['Plataforma']);const slugs={'Indeed':'indeed','ZipRecruiter':'ziprecruiter','Remote.com':'remote-com','We Work Remotely':'we-work-remotely','Remote OK':'remote-ok','Remotive':'remotive','Working Nomads':'working-nomads','Jobspresso':'jobspresso','LinkedIn':'linkedin','Glassdoor':'glassdoor','Wellfound':'wellfound','Dice':'dice','Torre':'torre','Get on Board':'get-on-board','Computrabajo':'computrabajo','Tecoloco':'tecoloco','Empresa directa':'empresa-directa','Direct':'direct'};const slug=slugs[platform];if(!slug)throw new Error('Unsupported application platform: '+platform);const generated=url(p['CV generado']);const match=generated.match(/([0-9a-f]{32})(?:\\?|$)/i);if(!match)throw new Error('Adapted CV Notion page URL is missing or invalid');const cvPageId=match[1];const sessionId=rich(p['Sesión navegador']);const applicationId=rich(p['ID aplicación'])||page.id;const approvedAt=new Date().toISOString();const attempts=number(p['Intentos aplicación'])+1;const pageId=String(page.id||'').replace(/-/g,'');const claimUrl='https://api.notion.com/v1/pages/'+pageId;const claimBody=JSON.stringify({properties:{'Aplicar ahora':{checkbox:false},'Estatus':{select:{name:'Application Ready'}},'Intentos aplicación':{number:attempts},'Último error aplicación':{rich_text:[]}}});return[{json:{pageId,platform,slug,jobUrl:url(p['URL Vacante']),vacancy:title(p['Vacante']),company:rich(p['Empresa']),cvPageId,sessionId,applicationId,approvedAt,attempts,claimUrl,claimBody}}];";
const REQUEST_CODE = "const prep=$('Prepare Platform Application').item.json;const response=$json.body??$json;const blocks=Array.isArray(response.results)?response.results:[];const textOf=block=>{const data=block[block.type]||{};return(data.rich_text||[]).map(x=>x.plain_text||'').join('')};let section='resume';const resume=[];const cover=[];for(const block of blocks){const text=textOf(block).trim();if(!text)continue;if(/^Tailored Cover Letter$/i.test(text)){section='cover';continue}if(/^ATS Keywords$|^Review Notes$/i.test(text))section='other';if(section==='resume')resume.push(text);else if(section==='cover')cover.push(text)}if(resume.join('\\n').length<20)throw new Error('Adapted CV content is empty');const base=String($env.APPLICATION_RUNNER_URL||'').replace(/\\/$/,'');if(!base)throw new Error('APPLICATION_RUNNER_URL is missing');const isResume=!!prep.sessionId;const endpoint=base+'/v1/'+prep.slug+'/'+(isResume?'resume':'apply');const payload=isResume?{applicationId:prep.applicationId,sessionId:prep.sessionId,approvalSource:'notion_apply_button',approvedAt:prep.approvedAt}:{applicationId:prep.applicationId,notionPageId:prep.pageId,jobUrl:prep.jobUrl,candidate:{firstName:String($env.JOB_APPLICANT_FIRST_NAME||''),lastName:String($env.JOB_APPLICANT_LAST_NAME||''),email:String($env.JOB_APPLICANT_EMAIL||''),phone:String($env.JOB_APPLICANT_PHONE||'')||undefined,city:String($env.JOB_APPLICANT_CITY||'')||undefined,country:String($env.JOB_APPLICANT_COUNTRY||'')||undefined,linkedinUrl:String($env.JOB_APPLICANT_LINKEDIN_URL||'')||undefined,websiteUrl:String($env.JOB_APPLICANT_WEBSITE_URL||'')||undefined},resumeText:resume.join('\\n\\n'),coverLetter:cover.join('\\n\\n')||undefined,approvalSource:'notion_apply_button',approvedAt:prep.approvedAt,dryRun:/^(1|true|yes)$/i.test(String($env.APPLICATION_RUNNER_DRY_RUN||''))};return[{json:{...prep,runnerEndpoint:endpoint,runnerBody:JSON.stringify(payload)}}];";
const UPDATE_CODE = "const prep=$('Build Platform Application Request').item.json;const raw=$json.body??$json;const status=String(raw.status||'error');const applied=status==='applied';const manual=status==='manual_required'||!applied;const properties={'Aplicar ahora':{checkbox:false},'Estatus':{select:{name:applied?'Applied':manual?'Manual Action Required':'Application Ready'}},'ID aplicación':{rich_text:[{type:'text',text:{content:String(raw.applicationId||prep.applicationId).slice(0,1900)}}]},'Sesión navegador':{rich_text:raw.sessionId?[{type:'text',text:{content:String(raw.sessionId).slice(0,1900)}}]:[]},'Control remoto':{url:raw.controlUrl||null},'Último error aplicación':{rich_text:manual?[{type:'text',text:{content:String(raw.reason||raw.error||'Platform requires manual action').slice(0,1900)}}]:[]}};if(applied){properties['Fecha aplicación']={date:{start:raw.submittedAt||new Date().toISOString()}};properties['Evidencia']={url:raw.evidenceUrl||prep.jobUrl}}const updateUrl='https://api.notion.com/v1/pages/'+prep.pageId;return[{json:{updateUrl,updateBody:JSON.stringify({properties}),status,applicationId:raw.applicationId||prep.applicationId,platform:prep.platform}}];";

function notionHeaders() {
  return {
    parameters: [
      { name: 'Authorization', value: "={{ 'Bearer ' + ($env.NOTION_API_KEY || $env.NOTION_TOKEN || $env.NOTION_API_TOKEN || '') }}" },
      { name: 'Notion-Version', value: '2022-06-28' },
      { name: 'Content-Type', value: 'application/json' },
    ],
  };
}

function upsert(nodes, name, type, position, parameters, onError) {
  let node = nodes.find((candidate) => candidate.name === name);
  if (!node) {
    node = { id: randomUUID(), name, type, typeVersion: type === 'n8n-nodes-base.scheduleTrigger' ? 1.2 : type === 'n8n-nodes-base.code' ? 2 : 4.2, position, parameters };
    nodes.push(node);
  }
  node.type = type;
  node.position = position;
  node.parameters = parameters;
  if (onError) node.onError = onError;
  else delete node.onError;
  return node;
}

function connect(connections, source, target) {
  connections[source] = { main: [[{ node: target, type: 'main', index: 0 }]] };
}

function configure(workflow) {
  const nodes = structuredClone(workflow.nodes || []);
  const connections = structuredClone(workflow.connections || {});
  upsert(nodes, NODE_NAMES.trigger, 'n8n-nodes-base.scheduleTrigger', [0, 620], { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } });
  upsert(nodes, NODE_NAMES.query, 'n8n-nodes-base.httpRequest', [240, 620], {
    method: 'POST', url: `https://api.notion.com/v1/databases/${DATABASE_ID}/query`, sendHeaders: true, headerParameters: notionHeaders(), sendBody: true,
    contentType: 'raw', rawContentType: 'application/json', body: "={{ JSON.stringify({ page_size: 20, filter: { and: [{ property: 'Aplicar ahora', checkbox: { equals: true } }, { property: 'Estatus', select: { equals: 'Approved to Apply' } }] } }) }}",
    options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true } } },
  }, 'continueRegularOutput');
  upsert(nodes, NODE_NAMES.split, 'n8n-nodes-base.code', [480, 620], { jsCode: SPLIT_CODE });
  upsert(nodes, NODE_NAMES.prepare, 'n8n-nodes-base.code', [720, 620], { jsCode: PREPARE_CODE });
  upsert(nodes, NODE_NAMES.claim, 'n8n-nodes-base.httpRequest', [960, 620], {
    method: 'PATCH', url: '={{ $json.claimUrl }}', sendHeaders: true, headerParameters: notionHeaders(), sendBody: true,
    contentType: 'raw', rawContentType: 'application/json', body: '={{ $json.claimBody }}', options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true } } },
  }, 'continueRegularOutput');
  upsert(nodes, NODE_NAMES.blocks, 'n8n-nodes-base.httpRequest', [1200, 620], {
    method: 'GET', url: "={{ 'https://api.notion.com/v1/blocks/' + $('Prepare Platform Application').item.json.cvPageId + '/children?page_size=100' }}", sendHeaders: true, headerParameters: notionHeaders(),
    options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true } } },
  }, 'continueRegularOutput');
  upsert(nodes, NODE_NAMES.request, 'n8n-nodes-base.code', [1440, 620], { jsCode: REQUEST_CODE });
  upsert(nodes, NODE_NAMES.apply, 'n8n-nodes-base.httpRequest', [1680, 620], {
    method: 'POST', url: '={{ $json.runnerEndpoint }}', sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Authorization', value: "={{ 'Bearer ' + $env.APPLICATION_RUNNER_TOKEN }}" }, { name: 'Content-Type', value: 'application/json' }] },
    sendBody: true, contentType: 'raw', rawContentType: 'application/json', body: '={{ $json.runnerBody }}',
    options: { timeout: 120000, response: { response: { fullResponse: true, neverError: true } } },
  }, 'continueRegularOutput');
  upsert(nodes, NODE_NAMES.update, 'n8n-nodes-base.code', [1920, 620], { jsCode: UPDATE_CODE });
  upsert(nodes, NODE_NAMES.save, 'n8n-nodes-base.httpRequest', [2160, 620], {
    method: 'PATCH', url: '={{ $json.updateUrl }}', sendHeaders: true, headerParameters: notionHeaders(), sendBody: true,
    contentType: 'raw', rawContentType: 'application/json', body: '={{ $json.updateBody }}', options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true } } },
  }, 'continueRegularOutput');

  connect(connections, NODE_NAMES.trigger, NODE_NAMES.query);
  connect(connections, NODE_NAMES.query, NODE_NAMES.split);
  connect(connections, NODE_NAMES.split, NODE_NAMES.prepare);
  connect(connections, NODE_NAMES.prepare, NODE_NAMES.claim);
  connect(connections, NODE_NAMES.claim, NODE_NAMES.blocks);
  connect(connections, NODE_NAMES.blocks, NODE_NAMES.request);
  connect(connections, NODE_NAMES.request, NODE_NAMES.apply);
  connect(connections, NODE_NAMES.apply, NODE_NAMES.update);
  connect(connections, NODE_NAMES.update, NODE_NAMES.save);
  return { nodes, connections };
}

function assertConfigured(workflow) {
  for (const name of Object.values(NODE_NAMES)) {
    if (!workflow.nodes.some((node) => node.name === name)) throw new Error(`Missing application node: ${name}`);
  }
  const request = workflow.nodes.find((node) => node.name === NODE_NAMES.request);
  if (!request.parameters.jsCode.includes("'/v1/'+prep.slug+'/'")) throw new Error('Per-platform API routing is missing');
  const apply = workflow.nodes.find((node) => node.name === NODE_NAMES.apply);
  if (apply.onError !== 'continueRegularOutput') throw new Error('Application transport error handling is disabled');
}

async function save(workflow, configured) {
  const versionId = randomUUID();
  const history = await client.query('SELECT authors FROM public.workflow_history WHERE "workflowId"=$1 ORDER BY "createdAt" DESC LIMIT 1', [workflow.id]);
  const authors = history.rows[0]?.authors || 'Daniel Maldonado';
  await client.query(
    'INSERT INTO public.workflow_history ("versionId","workflowId",authors,"createdAt","updatedAt",nodes,connections,name,autosaved,description) VALUES ($1,$2,$3,NOW(),NOW(),$4::json,$5::json,$6,FALSE,$7)',
    [versionId, workflow.id, authors, JSON.stringify(configured.nodes), JSON.stringify(configured.connections), workflow.name, workflow.description],
  );
  await client.query('UPDATE public.workflow_entity SET nodes=$2::json,connections=$3::json,"versionId"=$4,"versionCounter"="versionCounter"+1,"updatedAt"=NOW() WHERE id=$1', [workflow.id, JSON.stringify(configured.nodes), JSON.stringify(configured.connections), versionId]);
  return versionId;
}

async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('job-application-platform-runner-v1'))");
    const result = await client.query('SELECT * FROM public.workflow_entity WHERE id=$1 FOR UPDATE', [GATEWAY_ID]);
    if (result.rowCount !== 1) throw new Error('Job Applications Gateway was not found');
    const workflow = result.rows[0];
    const configured = configure(workflow);
    assertConfigured(configured);
    const unchanged = JSON.stringify(workflow.nodes) === JSON.stringify(configured.nodes) && JSON.stringify(workflow.connections) === JSON.stringify(configured.connections);
    if (unchanged) {
      await client.query('ROLLBACK');
      console.log('[JOB_APPLICATION_RUNNER] already configured');
      return;
    }
    const versionId = await save(workflow, configured);
    await client.query('COMMIT');
    console.log(`[JOB_APPLICATION_RUNNER] configured ${JSON.stringify({ workflowId: GATEWAY_ID, versionId })}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[JOB_APPLICATION_RUNNER] failed: ${String(error?.message || error)}`);
  process.exit(1);
});


const MODELS = [
  { name: 'gemini-3-flash-preview', provider: 'gemini' },
  { name: 'gemini-flash-latest', provider: 'gemini' },
  { name: 'gemini-2.5-flash-lite', provider: 'gemini' },
  { name: 'glm-4.5-flash', provider: 'glm' },
];
const DATABASE_ID = 'db72d8bbd4484bc4b6f90151310792ab';
const CONFIG_PAGE_ID = '3c362fd8699b818a8d38d3c7ab389ddb';
const NOTION_VERSION = '2022-06-28';
const env = process.env;

function requireEnv(name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const notionKey = requireEnv('NOTION_API_KEY');
const geminiKey = requireEnv('GEMINI_API_KEY');
const zaiKey = requireEnv('Z_AI_API_KEY');

const TEST_JOB = {
  title: 'Controlled Full Stack CV Redundancy Test',
  company: 'Codex QA',
  language: 'EN',
  requirements: ['Java', 'Spring Boot', 'Angular', 'TypeScript', 'SQL'],
  testOnly: true,
};
const TEST_FACTS = {
  yearsExperience: '12+ years',
  roles: ['Full Stack Developer', 'Technical Lead'],
  coreStack: ['Java', 'Spring Boot', 'Angular', 'TypeScript', 'Node.js', 'SQL', 'Docker', 'AWS'],
  languages: 'Spanish native; English A2/B1-compatible',
};

async function requestJson(url, options) {
  const retryable = new Set([429, 500, 502, 503, 504]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
    const body = await response.text();
    let json;
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      throw new Error(`Non-JSON response (${response.status}): ${body.slice(0, 300)}`);
    }
    if (response.ok) return json;
    const message = json?.error?.message || json?.message || body.slice(0, 300);
    if (!retryable.has(response.status) || attempt === 3) {
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000 * (2 ** (attempt - 1))));
  }
  throw new Error('Request retries exhausted');
}

function parseCv(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return a JSON object');
    parsed = JSON.parse(match[0]);
  }
  for (const field of ['TARGET_HEADLINE', 'SUMMARY', 'COVER_LETTER']) {
    if (!String(parsed[field] || '').trim()) throw new Error(`Model response missing ${field}`);
  }
  return parsed;
}

async function loadPrompt() {
  const page = await requestJson(`https://api.notion.com/v1/pages/${CONFIG_PAGE_ID}`, {
    method: 'GET',
    headers: notionHeaders(),
  });
  if (page.properties?.Enabled?.checkbox !== true) throw new Error('Notion AI prompt is disabled');
  const template = (page.properties?.Prompt?.rich_text || []).map((part) => part.plain_text || '').join('').trim();
  for (const placeholder of ['{{FACTS}}', '{{PROFILE}}', '{{VACANCY}}']) {
    if (!template.includes(placeholder)) throw new Error(`Notion AI prompt is missing ${placeholder}`);
  }
  return template
    .replaceAll('{{FACTS}}', JSON.stringify(TEST_FACTS))
    .replaceAll('{{PROFILE}}', 'Controlled QA test; do not submit an application')
    .replaceAll('{{VACANCY}}', JSON.stringify(TEST_JOB));
}

async function runGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const response = await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  const text = response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  return parseCv(text);
}

async function runGlm(model, prompt) {
  const response = await requestJson('https://api.z.ai/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${zaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });
  return parseCv(response?.choices?.[0]?.message?.content || '');
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${notionKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function testUrl(model) {
  return `https://example.invalid/codex-ai-redundancy/${encodeURIComponent(model)}`;
}

async function findExisting(model) {
  const response = await requestJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: { property: 'URL Vacante', url: { equals: testUrl(model) } },
      page_size: 1,
    }),
  });
  return response.results?.[0] || null;
}

function richText(content) {
  return [{ type: 'text', text: { content: String(content).slice(0, 1900) } }];
}

async function createParent(model) {
  return requestJson('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { database_id: DATABASE_ID },
      properties: {
        Vacante: { title: richText(`CONTROLLED TEST — ${model}`) },
        Empresa: { rich_text: richText('Codex QA') },
        Plataforma: { select: { name: 'Empresa directa' } },
        Idioma: { select: { name: 'EN' } },
        Estatus: { select: { name: 'Discarded' } },
        'URL Vacante': { url: testUrl(model) },
        'Fecha descubrimiento': { date: { start: new Date().toISOString().slice(0, 10) } },
        'Modelo IA': { select: { name: model } },
        Notas: { rich_text: richText('Controlled AI redundancy test. Not a real vacancy. No application will be submitted.') },
      },
    }),
  });
}

async function createCvPage(parentId, model, cv) {
  const lines = [
    `Model: ${model}`,
    `Target headline: ${cv.TARGET_HEADLINE}`,
    `Summary: ${cv.SUMMARY}`,
    `Cover letter: ${cv.COVER_LETTER}`,
  ];
  return requestJson('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { page_id: parentId },
      properties: { title: { title: richText(`CV Test — ${model}`) } },
      children: lines.map((line) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: richText(line) },
      })),
    }),
  });
}

async function linkCv(parentId, cvUrl) {
  await requestJson(`https://api.notion.com/v1/pages/${parentId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({ properties: { 'CV generado': { url: cvUrl }, 'Carta de presentación': { url: cvUrl } } }),
  });
}

async function testModel(config, prompt) {
  const existing = await findExisting(config.name);
  if (existing) {
    console.log(`[JOB_CV_AI_TEST] already passed ${config.name}`);
    return;
  }
  const cv = config.provider === 'gemini' ? await runGemini(config.name, prompt) : await runGlm(config.name, prompt);
  const parent = await createParent(config.name);
  const child = await createCvPage(parent.id, config.name, cv);
  await linkCv(parent.id, child.url);
  console.log(`[JOB_CV_AI_TEST] passed ${JSON.stringify({ model: config.name, parentId: parent.id, cvUrl: child.url })}`);
}

async function main() {
  const prompt = await loadPrompt();
  const failures = [];
  for (const config of MODELS) {
    try {
      await testModel(config, prompt);
    } catch (error) {
      failures.push({ model: config.name, error: String(error?.message || error) });
      console.error(`[JOB_CV_AI_TEST] failed ${config.name}: ${String(error?.message || error)}`);
    }
  }
  if (failures.length) throw new Error(`AI redundancy failures: ${JSON.stringify(failures)}`);
}

main().catch((error) => {
  console.error(`[JOB_CV_AI_TEST] suite failed: ${String(error?.message || error)}`);
  process.exit(1);
});



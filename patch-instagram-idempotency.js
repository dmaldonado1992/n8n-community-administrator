const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[INSTAGRAM_IDEMPOTENCY] missing ${key}`);
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

const workflowId = '6l5IbTxGdwcL24wT';
const engineNodeName = 'Dynamic Notion Sales Engine';
const dedupeNodeName = 'Instagram Event Dedupe';
const dedupeMarker = '/* INSTAGRAM_EVENT_DEDUPE_V1 */';

const dedupeCode = `${dedupeMarker}
const items = $input.all();
const state = $getWorkflowStaticData('global');
const now = Date.now();
const ttlMs = 6 * 60 * 60 * 1000;
const maxKeys = 2000;

if (!state.instagramEventDedupe || typeof state.instagramEventDedupe !== 'object') {
  state.instagramEventDedupe = {};
}
const seen = state.instagramEventDedupe;

for (const [key, value] of Object.entries(seen)) {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || now - ts > ttlMs) delete seen[key];
}

const entries = Object.entries(seen);
if (entries.length > maxKeys) {
  entries.sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0));
  for (const [key] of entries.slice(0, entries.length - maxKeys)) delete seen[key];
}

function extractEvent(json) {
  const root = json || {};
  const body = root.body || root;

  if (Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      if (Array.isArray(entry.messaging) && entry.messaging.length) {
        return { field: 'messaging', value: entry.messaging[0], entry, body };
      }
      if (Array.isArray(entry.changes) && entry.changes.length) {
        const change = entry.changes[0] || {};
        return { field: change.field || '', value: change.value || change, entry, body };
      }
    }
  }

  if (body.field && body.value) {
    return { field: body.field, value: body.value, entry: null, body };
  }
  if (root.field && root.value) {
    return { field: root.field, value: root.value, entry: null, body: root };
  }

  return { field: body.field || '', value: body.value || body, entry: null, body };
}

function eventKey(json) {
  const event = extractEvent(json);
  const value = event.value || {};
  const message = value.message || {};
  const postback = value.postback || {};
  const reaction = value.reaction || {};

  const mid = message.mid || value.mid || postback.mid || reaction.mid || '';
  if (mid) return 'mid:' + String(mid);

  const sender = value.sender?.id || value.from?.id || value.user_id || value.sender_id || '';
  const timestamp = value.timestamp || value.time || event.entry?.time || event.body?.time || '';
  if (!sender || !timestamp) return '';

  const payload = postback.payload || postback.title || message.text || value.text || reaction.action || reaction.emoji || '';
  return 'evt:' + String(event.field || 'unknown') + ':' + String(sender) + ':' + String(timestamp) + ':' + String(payload);
}

const output = [];
for (const item of items) {
  const key = eventKey(item.json);
  if (!key) {
    output.push(item);
    continue;
  }

  if (seen[key] && now - Number(seen[key]) <= ttlMs) {
    console.log('[INSTAGRAM_DEDUPE] duplicate ignored', key);
    continue;
  }

  seen[key] = now;
  output.push(item);
}

return output;`;

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function patchPostWebhooks(nodes) {
  let changed = false;
  const patched = [];

  for (const node of nodes) {
    if (node?.type !== 'n8n-nodes-base.webhook') continue;
    const method = String(node?.parameters?.httpMethod || 'GET').toUpperCase();
    if (method !== 'POST') continue;

    const searchable = `${node.name || ''} ${node?.parameters?.path || ''}`.toLowerCase();
    if (!searchable.includes('instagram') && !searchable.includes('meta')) continue;

    if (node.parameters.responseMode !== 'onReceived') {
      node.parameters.responseMode = 'onReceived';
      changed = true;
    }
    patched.push(node.name);
  }

  return { changed, patched };
}

function ensureDedupeNode(nodes, connections) {
  const engine = nodes.find(node => node?.name === engineNodeName);
  if (!engine) throw new Error(`Instagram engine node not found: ${engineNodeName}`);

  let changed = false;
  let node = nodes.find(item => item?.name === dedupeNodeName);

  if (!node) {
    const position = Array.isArray(engine.position) ? engine.position : [0, 0];
    node = {
      parameters: { jsCode: dedupeCode },
      id: 'a4c61ab0-35c7-4ed1-a996-f21d7fd18e31',
      name: dedupeNodeName,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [Number(position[0] || 0) - 260, Number(position[1] || 0)],
    };
    nodes.push(node);
    changed = true;
  } else if (node?.parameters?.jsCode !== dedupeCode) {
    node.parameters = { ...(node.parameters || {}), jsCode: dedupeCode };
    node.type = 'n8n-nodes-base.code';
    node.typeVersion = 2;
    changed = true;
  }

  let rewired = 0;
  for (const [sourceName, outputs] of Object.entries(connections || {})) {
    if (sourceName === dedupeNodeName || !outputs || typeof outputs !== 'object') continue;

    for (const groups of Object.values(outputs)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const connection of group) {
          if (connection?.node === engineNodeName) {
            connection.node = dedupeNodeName;
            rewired += 1;
            changed = true;
          }
        }
      }
    }
  }

  const expectedConnection = {
    main: [[{ node: engineNodeName, type: 'main', index: 0 }]],
  };
  const existing = connections[dedupeNodeName];
  if (JSON.stringify(existing) !== JSON.stringify(expectedConnection)) {
    connections[dedupeNodeName] = expectedConnection;
    changed = true;
  }

  const hasInbound = Object.entries(connections).some(([sourceName, outputs]) => {
    if (sourceName === dedupeNodeName || !outputs || typeof outputs !== 'object') return false;
    return Object.values(outputs).some(groups =>
      Array.isArray(groups) && groups.some(group =>
        Array.isArray(group) && group.some(connection => connection?.node === dedupeNodeName)
      )
    );
  });

  if (!hasInbound) {
    throw new Error('Could not find an inbound connection to the Instagram engine to rewire');
  }

  return { changed, rewired, marker: dedupeMarker };
}

async function main() {
  const client = new Client(config);
  await client.connect();

  try {
    const result = await client.query(`
      SELECT nodes, connections, "versionId", "activeVersionId"
      FROM public.workflow_entity
      WHERE id = $1
    `, [workflowId]);

    if (result.rowCount !== 1) throw new Error(`Instagram workflow not found: ${workflowId}`);

    const row = result.rows[0];
    const nodes = parseJson(row.nodes, []);
    const connections = parseJson(row.connections, {});

    const webhookResult = patchPostWebhooks(nodes);
    const dedupeResult = ensureDedupeNode(nodes, connections);
    const changed = webhookResult.changed || dedupeResult.changed;

    if (!changed) {
      console.log('[INSTAGRAM_IDEMPOTENCY] already applied ' + JSON.stringify({
        workflowId,
        immediateAckWebhooks: webhookResult.patched,
        dedupeNode: dedupeNodeName,
      }));
      return;
    }

    const nodesJson = JSON.stringify(nodes);
    const connectionsJson = JSON.stringify(connections);
    const versionIds = [...new Set([row.versionId, row.activeVersionId].filter(Boolean).map(String))];

    await client.query('BEGIN');
    try {
      await client.query(`
        UPDATE public.workflow_entity
        SET nodes = $2::json,
            connections = $3::json,
            "updatedAt" = NOW()
        WHERE id = $1
      `, [workflowId, nodesJson, connectionsJson]);

      if (versionIds.length) {
        await client.query(`
          UPDATE public.workflow_history
          SET nodes = $2::json,
              connections = $3::json,
              "updatedAt" = NOW()
          WHERE "workflowId" = $1
            AND "versionId" = ANY($4::text[])
        `, [workflowId, nodesJson, connectionsJson, versionIds]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log('[INSTAGRAM_IDEMPOTENCY] applied ' + JSON.stringify({
      workflowId,
      immediateAckWebhooks: webhookResult.patched,
      dedupeNode: dedupeNodeName,
      rewiredConnections: dedupeResult.rewired,
      ttlHours: 6,
      maxRememberedEvents: 2000,
      versionsUpdated: versionIds,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[INSTAGRAM_IDEMPOTENCY] failed: ' + String(error?.message || error));
  process.exit(1);
});

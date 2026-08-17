const appId = process.env.META_APP_ID || '2492263324619283';
const appSecret = process.env.META_APP_SECRET || '';
const appAccessToken = process.env.META_APP_ACCESS_TOKEN || (appId && appSecret ? `${appId}|${appSecret}` : '');
const verifyToken = process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || '';
const callbackUrl = process.env.META_CALLBACK_URL || process.env.META_WEBHOOK_URL || 'https://n8n-community-8ttv.onrender.com/webhook/instagram-sales';
const version = process.env.META_GRAPH_VERSION || 'v26.0';
const requiredFields = ['messages', 'messaging_postbacks'];

function safeError(error) {
  const body = error?.body || {};
  const meta = body?.error || {};
  return {
    message: meta.message || error?.message || String(error),
    type: meta.type || null,
    code: meta.code || error?.status || null,
    error_subcode: meta.error_subcode || null,
    fbtrace_id: meta.fbtrace_id || null,
  };
}

async function graph(path, options = {}) {
  const response = await fetch(`https://graph.facebook.com/${version}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${appAccessToken}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function fieldNames(entry) {
  return (entry?.fields || []).map(field => typeof field === 'string' ? field : field?.name).filter(Boolean);
}

async function preflightCallback() {
  const challenge = `IG_VERIFY_${Date.now()}`;
  const url = new URL(callbackUrl);
  url.searchParams.set('hub.mode', 'subscribe');
  url.searchParams.set('hub.verify_token', verifyToken);
  url.searchParams.set('hub.challenge', challenge);
  const response = await fetch(url, { redirect: 'follow' });
  const text = await response.text();
  const ok = response.ok && text.trim() === challenge;
  console.log('[META_APP_WEBHOOK] callback preflight', JSON.stringify({
    callbackUrl,
    status: response.status,
    challengeMatched: ok,
  }));
  return ok;
}

async function inspectSubscriptions() {
  const result = await graph(`/${encodeURIComponent(appId)}/subscriptions`);
  const rows = Array.isArray(result?.data) ? result.data : [];
  console.log('[META_APP_WEBHOOK] subscriptions', JSON.stringify(rows.map(row => ({
    object: row.object || null,
    callback_url: row.callback_url || null,
    active: row.active !== false,
    fields: fieldNames(row),
  }))));
  return rows;
}

async function repairObject(objectName, existing) {
  const fields = [...new Set([...fieldNames(existing), ...requiredFields])];
  const form = new URLSearchParams();
  form.set('object', objectName);
  form.set('callback_url', callbackUrl);
  form.set('verify_token', verifyToken);
  form.set('fields', fields.join(','));
  form.set('include_values', 'true');

  const result = await graph(`/${encodeURIComponent(appId)}/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  console.log('[META_APP_WEBHOOK] repair result', JSON.stringify({
    object: objectName,
    callbackUrl,
    fields,
    success: result?.success === true || result === true,
  }));
}

async function main() {
  console.log('[META_APP_WEBHOOK] config', JSON.stringify({
    appId,
    hasAppSecret: !!appSecret,
    hasAppAccessToken: !!appAccessToken,
    hasVerifyToken: !!verifyToken,
    callbackUrl,
    version,
  }));

  if (!appAccessToken || !verifyToken) {
    console.log('[META_APP_WEBHOOK] skipped: META_APP_SECRET/META_APP_ACCESS_TOKEN or META_VERIFY_TOKEN missing');
    return;
  }

  const rows = await inspectSubscriptions();
  const preflightOk = await preflightCallback();
  if (!preflightOk) {
    console.log('[META_APP_WEBHOOK] repair blocked: callback verification failed');
    return;
  }

  const relevant = rows.filter(row => ['instagram', 'page'].includes(String(row?.object || '').toLowerCase()));
  if (relevant.length) {
    for (const row of relevant) {
      await repairObject(String(row.object).toLowerCase(), row);
    }
  } else {
    // Instagram-specific workflow: create the Instagram app subscription if none exists.
    await repairObject('instagram', null);
  }

  const after = await inspectSubscriptions();
  const good = after.some(row => {
    const objectName = String(row?.object || '').toLowerCase();
    const fields = fieldNames(row);
    return ['instagram', 'page'].includes(objectName)
      && row?.callback_url === callbackUrl
      && requiredFields.every(field => fields.includes(field));
  });
  console.log('[META_APP_WEBHOOK] final', JSON.stringify({ ok: good, callbackUrl }));
}

main().catch(error => {
  console.error('[META_APP_WEBHOOK] non-fatal failure', JSON.stringify(safeError(error)));
});

const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || '';
const preferredVersion = process.env.META_GRAPH_VERSION || 'v26.0';
const versions = [...new Set([preferredVersion, 'v24.0'])];
const requiredFields = 'messages,messaging_postbacks';
const requiredIgFacebookPermissions = [
  'instagram_basic',
  'instagram_manage_messages',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_read_engagement',
];

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

async function request(url, options = {}, bearer = token) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
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

async function inspectFacebookPermissions(version) {
  try {
    const result = await request(`https://graph.facebook.com/${version}/me/permissions`);
    const statuses = Object.fromEntries((result?.data || []).map(p => [p.permission, p.status]));
    const required = Object.fromEntries(requiredIgFacebookPermissions.map(p => [p, statuses[p] || 'missing']));
    const missing = Object.entries(required).filter(([, status]) => status !== 'granted').map(([permission]) => permission);
    console.log('[META_PERMISSIONS] required', JSON.stringify({ required, missing }));
    return { required, missing };
  } catch (error) {
    console.log('[META_PERMISSIONS] check failed', JSON.stringify({ error: safeError(error) }));
    return { required: {}, missing: requiredIgFacebookPermissions };
  }
}

async function inspectInstagramConversations(pageId, pageToken, version) {
  try {
    const result = await request(
      `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/conversations?platform=instagram&fields=id,updated_time&limit=5`,
      {},
      pageToken
    );
    const rows = (result?.data || []).map(x => ({ id: String(x.id || ''), updated_time: x.updated_time || null }));
    console.log('[META_CONVERSATIONS] instagram accessible', JSON.stringify({ pageId: String(pageId), count: rows.length, recent: rows }));
    return { ok: true, count: rows.length };
  } catch (error) {
    console.log('[META_CONVERSATIONS] instagram unavailable', JSON.stringify({ pageId: String(pageId), error: safeError(error) }));
    return { ok: false, error: safeError(error) };
  }
}

async function subscribeInstagramLogin() {
  for (const version of versions) {
    try {
      const me = await request(`https://graph.instagram.com/${version}/me?fields=id,username`);
      if (!me?.id) continue;
      console.log('[META_SUBSCRIBE] instagram identity', JSON.stringify({ version, id: String(me.id), username: me.username || null }));

      const result = await request(
        `https://graph.instagram.com/${version}/${encodeURIComponent(me.id)}/subscribed_apps?subscribed_fields=${encodeURIComponent(requiredFields)}`,
        { method: 'POST' }
      );
      console.log('[META_SUBSCRIBE] instagram subscribe result', JSON.stringify({ id: String(me.id), success: result?.success === true }));

      const verify = await request(`https://graph.instagram.com/${version}/${encodeURIComponent(me.id)}/subscribed_apps`);
      const fields = Array.isArray(verify?.data)
        ? [...new Set(verify.data.flatMap(item => Array.isArray(item?.subscribed_fields) ? item.subscribed_fields : []))]
        : [];
      console.log('[META_SUBSCRIBE] instagram verified', JSON.stringify({ id: String(me.id), subscribed_fields: fields }));
      return { ok: fields.includes('messages') && fields.includes('messaging_postbacks'), mode: 'instagram', id: String(me.id), fields };
    } catch (error) {
      console.log('[META_SUBSCRIBE] instagram path unavailable', JSON.stringify({ version, error: safeError(error) }));
    }
  }
  return { ok: false, mode: 'instagram' };
}

async function subscribeFacebookPage(pageId, pageToken, version, pageName, igAccount, tasks = []) {
  const result = await request(
    `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=${encodeURIComponent(requiredFields)}`,
    { method: 'POST' },
    pageToken
  );
  const verify = await request(
    `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/subscribed_apps`,
    {},
    pageToken
  );
  const fields = Array.isArray(verify?.data)
    ? [...new Set(verify.data.flatMap(item => Array.isArray(item?.subscribed_fields) ? item.subscribed_fields : []))]
    : [];
  const apps = (verify?.data || []).map(item => ({
    id: String(item?.id || ''),
    name: item?.name || null,
    subscribed_fields: Array.isArray(item?.subscribed_fields) ? item.subscribed_fields : [],
  }));
  console.log('[META_SUBSCRIBE] facebook page verified', JSON.stringify({
    pageId: String(pageId),
    pageName: pageName || null,
    instagram: igAccount ? { id: String(igAccount.id || ''), username: igAccount.username || null } : null,
    tasks: Array.isArray(tasks) ? tasks : [],
    success: result?.success === true,
    subscribed_fields: fields,
    apps,
  }));
  await inspectInstagramConversations(pageId, pageToken, version);
  return fields.includes('messages') && fields.includes('messaging_postbacks');
}

async function subscribeFacebookLogin() {
  for (const version of versions) {
    try {
      const me = await request(`https://graph.facebook.com/${version}/me?fields=id,name`);
      console.log('[META_SUBSCRIBE] facebook identity', JSON.stringify({ version, id: String(me?.id || ''), name: me?.name || null }));
      await inspectFacebookPermissions(version);

      let repaired = false;
      try {
        const accounts = await request(`https://graph.facebook.com/${version}/me/accounts?fields=id,name,access_token,tasks,instagram_business_account%7Bid,username%7D`);
        for (const page of accounts?.data || []) {
          if (!page?.id) continue;
          try {
            const ok = await subscribeFacebookPage(
              page.id,
              page.access_token || token,
              version,
              page.name,
              page.instagram_business_account || null,
              page.tasks || []
            );
            repaired = repaired || ok;
          } catch (error) {
            console.log('[META_SUBSCRIBE] page subscribe failed', JSON.stringify({ pageId: String(page.id), error: safeError(error) }));
          }
        }
      } catch (error) {
        console.log('[META_SUBSCRIBE] /me/accounts unavailable', JSON.stringify({ error: safeError(error) }));
      }

      if (!repaired && me?.id) {
        try {
          const page = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(me.id)}?fields=id,name,instagram_business_account%7Bid,username%7D`);
          repaired = await subscribeFacebookPage(page.id, token, version, page.name, page.instagram_business_account || null, []);
        } catch (error) {
          console.log('[META_SUBSCRIBE] direct page path failed', JSON.stringify({ id: String(me.id), error: safeError(error) }));
        }
      }

      if (repaired) return { ok: true, mode: 'facebook' };
    } catch (error) {
      console.log('[META_SUBSCRIBE] facebook path unavailable', JSON.stringify({ version, error: safeError(error) }));
    }
  }
  return { ok: false, mode: 'facebook' };
}

async function main() {
  if (!token) {
    console.log('[META_SUBSCRIBE] skipped: no Meta/Instagram access token configured');
    return;
  }

  console.log('[META_SUBSCRIBE] starting subscription repair');
  const instagram = await subscribeInstagramLogin();
  const facebook = await subscribeFacebookLogin();
  console.log('[META_SUBSCRIBE] final', JSON.stringify({ instagram, facebook }));
}

main().catch(error => {
  console.error('[META_SUBSCRIBE] non-fatal failure', JSON.stringify(safeError(error)));
});

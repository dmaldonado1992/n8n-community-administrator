const { Client } = require('pg');
const { randomUUID } = require('crypto');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST', 'DB_POSTGRESDB_DATABASE', 'DB_POSTGRESDB_USER', 'DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[WORKFLOW_FOLDERS] missing ${key}`);
    process.exit(1);
  }
}

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const clientConfig = {
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

const folderRules = [
  {
    name: 'English Learning',
    match: (workflowName) => workflowName.startsWith('English Learning') || workflowName === 'Reader Tracker from Notion + Linear',
  },
  {
    name: 'Instagram Sales',
    match: (workflowName) => workflowName.startsWith('Instagram Sales'),
  },
  {
    name: 'Job Applications',
    match: (workflowName) => workflowName.startsWith('Job Applications'),
  },
  {
    name: 'MCP & Infrastructure',
    match: (workflowName) => workflowName.startsWith('MCP —') || workflowName === 'ChatGPT — n8n Gateway' || workflowName === 'Render Keep Alive',
  },
  {
    name: 'Temporary / Maintenance',
    match: (workflowName) => workflowName.startsWith('TEMP —'),
  },
];

function folderFor(workflowName) {
  return folderRules.find((rule) => rule.match(workflowName))?.name || null;
}

async function ensureFolder(client, projectId, name) {
  const existing = await client.query(
    `SELECT id
       FROM public.folder
      WHERE "projectId" = $1
        AND name = $2
        AND "parentFolderId" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    [projectId, name],
  );

  if (existing.rowCount) return existing.rows[0].id;

  const id = randomUUID();
  await client.query(
    `INSERT INTO public.folder (id, name, "projectId", "parentFolderId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NULL, NOW(), NOW())`,
    [id, name, projectId],
  );
  return id;
}

async function main() {
  const client = new Client(clientConfig);
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('n8n-workflow-folder-organization-v1'))`);

    const result = await client.query(`
      SELECT w.id,
             w.name,
             w."parentFolderId" AS "parentFolderId",
             sw."projectId" AS "projectId"
        FROM public.workflow_entity w
        JOIN public.shared_workflow sw
          ON sw."workflowId" = w.id
         AND sw.role = 'workflow:owner'
       WHERE COALESCE(w."isArchived", FALSE) = FALSE
       ORDER BY w.name
    `);

    const unmapped = result.rows.filter((row) => !folderFor(row.name));
    if (unmapped.length) {
      throw new Error(`Unmapped workflows: ${unmapped.map((row) => `${row.id}:${row.name}`).join(', ')}`);
    }

    const projects = [...new Set(result.rows.map((row) => String(row.projectId)))];
    const folderIds = new Map();

    for (const projectId of projects) {
      for (const rule of folderRules) {
        const id = await ensureFolder(client, projectId, rule.name);
        folderIds.set(`${projectId}:${rule.name}`, id);
      }
    }

    const moved = [];
    const unchanged = [];

    for (const row of result.rows) {
      const folderName = folderFor(row.name);
      const folderId = folderIds.get(`${row.projectId}:${folderName}`);

      if (row.parentFolderId === folderId) {
        unchanged.push({ id: row.id, name: row.name, folder: folderName });
        continue;
      }

      await client.query(
        `UPDATE public.workflow_entity
            SET "parentFolderId" = $2
          WHERE id = $1`,
        [row.id, folderId],
      );
      moved.push({ id: row.id, name: row.name, folder: folderName });
    }

    const verification = await client.query(`
      SELECT w.id,
             w.name,
             f.name AS folder_name,
             sw."projectId" AS project_id
        FROM public.workflow_entity w
        JOIN public.shared_workflow sw
          ON sw."workflowId" = w.id
         AND sw.role = 'workflow:owner'
        LEFT JOIN public.folder f
          ON f.id = w."parentFolderId"
       WHERE COALESCE(w."isArchived", FALSE) = FALSE
       ORDER BY f.name, w.name
    `);

    const missingFolder = verification.rows.filter((row) => !row.folder_name);
    if (missingFolder.length) {
      throw new Error(`Folder verification failed for: ${missingFolder.map((row) => row.id).join(', ')}`);
    }

    await client.query('COMMIT');

    const counts = verification.rows.reduce((acc, row) => {
      acc[row.folder_name] = (acc[row.folder_name] || 0) + 1;
      return acc;
    }, {});

    console.log('[WORKFLOW_FOLDERS] ready ' + JSON.stringify({
      totalWorkflows: verification.rowCount,
      moved: moved.length,
      unchanged: unchanged.length,
      folders: counts,
      workflowIdsPreserved: true,
    }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[WORKFLOW_FOLDERS] failed: ' + String(error?.message || error));
  process.exit(1);
});

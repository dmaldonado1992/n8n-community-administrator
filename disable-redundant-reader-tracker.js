const { Client } = require('pg');

const env = process.env;
const required = ['DB_POSTGRESDB_HOST','DB_POSTGRESDB_DATABASE','DB_POSTGRESDB_USER','DB_POSTGRESDB_PASSWORD'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[WORKFLOW_CLEANUP] missing ${key}`);
    process.exit(1);
  }
}

const bool = (v, fallback = false) => {
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

const client = new Client({
  host: env.DB_POSTGRESDB_HOST,
  port: Number(env.DB_POSTGRESDB_PORT || 5432),
  database: env.DB_POSTGRESDB_DATABASE,
  user: env.DB_POSTGRESDB_USER,
  password: env.DB_POSTGRESDB_PASSWORD,
  connectionTimeoutMillis: 10000,
  ssl: bool(env.DB_POSTGRESDB_SSL_ENABLED, false)
    ? { rejectUnauthorized: bool(env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED, false) }
    : false,
});

const workflowId = 'HZAPMwQOsOMAcUFm';

async function main() {
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, name, active FROM public.workflow_entity WHERE id = $1`,
      [workflowId],
    );

    if (!result.rowCount) {
      console.log('[WORKFLOW_CLEANUP] redundant reader tracker already absent');
      return;
    }

    const workflow = result.rows[0];
    if (!workflow.active) {
      console.log('[WORKFLOW_CLEANUP] redundant reader tracker already inactive');
      return;
    }

    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE public.workflow_entity SET active = false, "updatedAt" = NOW() WHERE id = $1`,
        [workflowId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log('[WORKFLOW_CLEANUP] deactivated redundant reader tracker ' + JSON.stringify({
      id: workflow.id,
      name: workflow.name,
      replacement: 'English Learning Sync action=read',
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[WORKFLOW_CLEANUP] failed: ' + String(error?.message || error));
  process.exit(1);
});

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
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[ORDER_SEQUENCE] failed: ' + String(error?.message || error));
  process.exit(1);
});

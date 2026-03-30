import pg from 'pg';

const { Client } = pg;

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL is required');
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const res = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  console.log('tables:', res.rows.length);
  console.log(res.rows.map((r) => r.tablename).join(', '));
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}

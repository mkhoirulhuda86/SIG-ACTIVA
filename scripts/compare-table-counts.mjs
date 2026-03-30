import pg from 'pg';

const { Client } = pg;

const SOURCE_DATABASE_URL = process.env.SOURCE_DATABASE_URL;
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL;

if (!SOURCE_DATABASE_URL || !TARGET_DATABASE_URL) {
  console.error('SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required');
  process.exit(1);
}

const ssl = { rejectUnauthorized: false };

const tables = [
  'users',
  'accruals',
  'accrual_periodes',
  'prepaids',
  'prepaid_periodes',
  'fluktuasi_imports',
  'fluktuasi_keywords',
  'fluktuasi_sheet_rows',
  'fluktuasi_akun_periodes',
  'material_data',
];

const q = (t) => `SELECT COUNT(*)::int AS c FROM public."${t}"`;

const src = new Client({ connectionString: SOURCE_DATABASE_URL, ssl });
const dst = new Client({ connectionString: TARGET_DATABASE_URL, ssl });

await src.connect();
await dst.connect();

try {
  for (const t of tables) {
    const [a, b] = await Promise.all([src.query(q(t)), dst.query(q(t))]);
    console.log(`${t}: source=${a.rows[0].c}, target=${b.rows[0].c}`);
  }
} finally {
  await src.end();
  await dst.end();
}

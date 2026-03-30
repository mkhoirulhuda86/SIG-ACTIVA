import pg from 'pg';

const { Client } = pg;

const SOURCE_DATABASE_URL = process.env.SOURCE_DATABASE_URL;
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL;

if (!SOURCE_DATABASE_URL || !TARGET_DATABASE_URL) {
  console.error('SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required');
  process.exit(1);
}

const ssl = { rejectUnauthorized: false };

const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

const source = new Client({ connectionString: SOURCE_DATABASE_URL, ssl });
const target = new Client({ connectionString: TARGET_DATABASE_URL, ssl });

const batchSize = 200;

async function getTables(client) {
  const res = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );
  return res.rows.map((r) => r.tablename);
}

async function getColumns(client, tableName) {
  const res = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return res.rows.map((r) => r.column_name);
}

async function getJsonColumns(client, tableName) {
  const res = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND data_type IN ('json', 'jsonb')`,
    [tableName]
  );
  return new Set(res.rows.map((r) => r.column_name));
}

function normalizeJsonValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Preserve malformed payload as valid JSON object instead of failing entire migration.
      return { _raw: trimmed };
    }
  }
  return value;
}

function salvageJsonValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') return { _raw_string: value };
  try {
    return { _raw_json: JSON.stringify(value) };
  } catch {
    return { _raw_fallback: String(value) };
  }
}

async function tableExists(client, tableName) {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return Boolean(res.rows[0]?.exists);
}

async function syncSequenceForSerialColumns(client, tableName) {
  const serialColsRes = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_default LIKE 'nextval(%'`,
    [tableName]
  );

  for (const row of serialColsRes.rows) {
    const col = row.column_name;
    const tableRef = `public.${tableName}`;
    const colRef = quoteIdent(col);
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence($1, $2),
         COALESCE((SELECT MAX(${colRef}) FROM ${quoteIdent('public')}.${quoteIdent(tableName)}), 0) + 1,
         false
       )`,
      [tableRef, col]
    );
  }
}

async function copyTable(tableName) {
  const exists = await tableExists(target, tableName);
  if (!exists) {
    console.log(`[SKIP] ${tableName} (missing in target)`);
    return;
  }

  const columns = await getColumns(source, tableName);
  const jsonColumns = await getJsonColumns(target, tableName);
  if (columns.length === 0) {
    console.log(`[SKIP] ${tableName} (no columns)`);
    return;
  }

  const colList = columns.map(quoteIdent).join(', ');
  const tableRef = `${quoteIdent('public')}.${quoteIdent(tableName)}`;

  await target.query(`TRUNCATE TABLE ${tableRef} RESTART IDENTITY CASCADE`);

  const srcRows = await source.query(`SELECT ${colList} FROM ${tableRef}`);
  const rows = srcRows.rows;

  if (rows.length === 0) {
    console.log(`[OK] ${tableName}: 0 rows`);
    return;
  }

  const insertRows = async (tableName, columns, tableRef, rowItems, jsonColumns, useSalvage = false) => {
    const values = [];
    const placeholders = [];
    let p = 1;

    for (const row of rowItems) {
      const rowParams = [];
      for (const c of columns) {
        const raw = row[c];
        const val = jsonColumns.has(c)
          ? (useSalvage ? salvageJsonValue(raw) : normalizeJsonValue(raw))
          : raw;
        values.push(val);
        rowParams.push(`$${p++}`);
      }
      placeholders.push(`(${rowParams.join(', ')})`);
    }

    const insertSql = `INSERT INTO ${tableRef} (${colList}) VALUES ${placeholders.join(', ')}`;
    await target.query(insertSql, values);
  };

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    try {
      await insertRows(tableName, columns, tableRef, chunk, jsonColumns, false);
    } catch (batchErr) {
      console.warn(`[WARN] Batch insert failed on ${tableName}, falling back to row-by-row`);
      for (const row of chunk) {
        try {
          await insertRows(tableName, columns, tableRef, [row], jsonColumns, false);
        } catch {
          await insertRows(tableName, columns, tableRef, [row], jsonColumns, true);
        }
      }
    }
  }

  await syncSequenceForSerialColumns(target, tableName);
  console.log(`[OK] ${tableName}: ${rows.length} rows`);
}

async function main() {
  await source.connect();
  await target.connect();

  try {
    const sourceTables = await getTables(source);
    console.log(`Found ${sourceTables.length} tables in source.`);

    const preferredOrder = [
      'users',
      'material_data',
      'fluktuasi_imports',
      'fluktuasi_keywords',
      'fluktuasi_sheet_rows',
      'fluktuasi_akun_periodes',
      'accruals',
      'accrual_periodes',
      'accrual_periode_costcenters',
      'accrual_realisasis',
      'prepaids',
      'prepaid_periodes',
      'prepaid_periode_costcenters',
      'push_subscriptions',
      '_prisma_migrations',
    ];

    const inSource = new Set(sourceTables);
    const ordered = preferredOrder.filter((t) => inSource.has(t));
    const remaining = sourceTables.filter((t) => !ordered.includes(t));
    const tables = [...ordered, ...remaining];

    for (const table of tables) {
      await copyTable(table);
    }

    console.log('Migration finished.');
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

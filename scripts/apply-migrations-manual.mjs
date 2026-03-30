import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';

const { Client } = pg;

const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL;
if (!TARGET_DATABASE_URL) {
  console.error('TARGET_DATABASE_URL is required');
  process.exit(1);
}

const migrationsDir = path.resolve('prisma', 'migrations');

async function main() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^\d+_/.test(name))
    .sort();

  const client = new Client({
    connectionString: TARGET_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    for (const dir of migrationDirs) {
      const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
      const sql = await fs.readFile(sqlPath, 'utf8');
      if (!sql.trim()) continue;
      console.log(`Applying ${dir} ...`);
      await client.query(sql);
    }
    console.log('All migrations applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration apply failed:', err);
  process.exit(1);
});

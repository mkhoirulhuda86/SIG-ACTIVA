import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('Stage D persistence is additive and does not write legacy transaction models', () => {
  const migration = readFileSync('prisma/migrations/20260904180000_add_raw_v2_stage_d_reconciliation/migration.sql', 'utf8');
  const service = readFileSync('lib/cost-structure/raw-v2/reconciliation-service.ts', 'utf8');
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE|ALTER TABLE)\b/i);
  assert.doesNotMatch(service, /\.cost(?:Period|Upload|SourceRow|ValidationIssue|CalculationRun|ActualLine|CalculationResult)\b|activeCalculationRunId/);
  assert.match(service, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
});

test('Stage D API uses PREPARE for POST and READ for GET', () => {
  assert.match(readFileSync('app/api/cost-structure/raw-v2/reconciliation/calculate/route.ts', 'utf8'), /requireCostStructurePrepare/);
  assert.match(readFileSync('app/api/cost-structure/raw-v2/reconciliation/route.ts', 'utf8'), /requireCostStructureRead/);
});

test('Stage D does not persist false mapped amounts before Stage E', () => {
  const service = readFileSync('lib/cost-structure/raw-v2/reconciliation-service.ts', 'utf8');
  assert.doesNotMatch(service, /costRawV2AnalyticalRow\.(?:create|createMany|update|upsert)/);
  assert.match(service, /mappingApplied: false/);
  assert.match(service, /analyticalRowsPersisted: false/);
});

test('reserved analytical table has source-row foreign-key lineage', () => {
  const migration = readFileSync('prisma/migrations/20260904180000_add_raw_v2_stage_d_reconciliation/migration.sql', 'utf8');
  assert.match(migration, /cost_raw_v2_analytical_rows_sourceRowId_fkey/);
  assert.match(migration, /REFERENCES "cost_raw_v2_source_rows"\("id"\) ON DELETE RESTRICT/);
});

test('reconciliation GET is scoped to the active upload id', () => {
  const route = readFileSync('app/api/cost-structure/raw-v2/reconciliation/route.ts', 'utf8');
  assert.match(route, /uploadId: upload\.id/);
});

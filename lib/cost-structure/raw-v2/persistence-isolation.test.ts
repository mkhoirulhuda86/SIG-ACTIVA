import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';

const migrationPath = path.resolve(
  'prisma/migrations/20260904120000_add_cost_raw_v2_skeleton/migration.sql'
);

test('Raw V2 migration is additive and cannot mutate legacy workflow tables', () => {
  const migration = readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|UPDATE|RENAME|TRUNCATE)\b/im);
  assert.doesNotMatch(migration, /\b(?:ALTER TABLE)\s+"cost_(?:periods|uploads|calculation_runs)"/i);
  assert.doesNotMatch(migration, /activeCalculationRunId/);
  assert.match(migration, /CREATE TABLE "cost_raw_v2_periods"/);
  assert.match(migration, /CREATE TABLE "cost_raw_v2_calculation_runs"/);
});

test('Raw V2 schema models do not relate to legacy transaction models', () => {
  const schema = readFileSync(path.resolve('prisma/schema.prisma'), 'utf8');
  const rawModels = schema.match(/model CostRawV2[\s\S]*?(?=\nmodel CostCompany)/)?.[0];
  assert.ok(rawModels, 'Raw V2 schema boundary must exist');
  assert.doesNotMatch(rawModels, /\bCostPeriod\b/);
  assert.doesNotMatch(rawModels, /\bCostUpload\b/);
  assert.doesNotMatch(rawModels, /\bCostCalculationRun\b/);
  assert.doesNotMatch(rawModels, /activeCalculationRunId/);
});

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

test('Raw V2 enforces one active upload and one active calculation run per period', () => {
  const migration = readFileSync(migrationPath, 'utf8');
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "cost_raw_v2_uploads_one_active_per_period_key" ON "cost_raw_v2_uploads"\("periodId"\) WHERE "isActiveVersion" = true;/
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "cost_raw_v2_calculation_runs_one_active_per_period_key" ON "cost_raw_v2_calculation_runs"\("periodId"\) WHERE "isActive" = true;/
  );
});

test('Raw V2 audit actor ids are protected by users foreign keys', () => {
  const migration = readFileSync(migrationPath, 'utf8');
  assert.match(
    migration,
    /cost_raw_v2_uploads_uploadedById_fkey[\s\S]*FOREIGN KEY \("uploadedById"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT/
  );
  assert.match(
    migration,
    /cost_raw_v2_validation_issues_resolvedById_fkey[\s\S]*FOREIGN KEY \("resolvedById"\) REFERENCES "users"\("id"\) ON DELETE SET NULL/
  );
  assert.match(
    migration,
    /cost_raw_v2_calculation_runs_startedById_fkey[\s\S]*FOREIGN KEY \("startedById"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT/
  );
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

test('Raw V2 Prisma actor relations mirror the database audit constraints', () => {
  const schema = readFileSync(path.resolve('prisma/schema.prisma'), 'utf8');
  const rawModels = schema.match(/model CostRawV2[\s\S]*?(?=\nmodel CostCompany)/)?.[0];
  assert.ok(rawModels, 'Raw V2 schema boundary must exist');
  assert.match(rawModels, /uploadedBy\s+User\s+@relation\("CostRawV2UploadUploadedBy"/);
  assert.match(rawModels, /resolvedBy\s+User\?\s+@relation\("CostRawV2ValidationIssueResolvedBy"/);
  assert.match(rawModels, /startedBy\s+User\s+@relation\("CostRawV2CalculationRunStartedBy"/);
});

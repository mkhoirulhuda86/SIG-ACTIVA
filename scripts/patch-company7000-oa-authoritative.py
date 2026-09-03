from pathlib import Path

adapter_path = Path('lib/cost-structure/calculations/company-7000-source-adapter.ts')
engine_path = Path('lib/cost-structure/calculations/company-7000.ts')
adapter_test_path = Path('lib/cost-structure/calculations/company-7000-source-adapter.test.ts')
engine_test_path = Path('lib/cost-structure/calculations/company-7000.test.ts')

adapter = adapter_path.read_text()
start = adapter.index('function buildOa(input: Company7000AdapterInput, pasar: Map<string, AggregatedCoa>) {')
end = adapter.index('\nexport function buildCompany7000Input', start)
new_oa = r'''function selectOaStatComponent(input: Company7000AdapterInput, gl: string, role: 'SUMMARY' | 'TRANSACTION' | 'DERIVATIVE') {
  const stat = rowsFor(input, 'OA_STAT');
  const matches = stat.filter((row) => {
    if (normalized(rawValue(row, 'G/L Account', 'GL Account', 'COA', 'ROLE_GL')) !== gl || normalized(rawValue(row, 'Component Type', 'Role', 'SECTION', 'ROLE')) !== role) return false;
    if (role !== 'TRANSACTION') return true;
    const company = rawValue(row, 'Company Code', 'COMPANY_CODE');
    const period = rawValue(row, 'Posting Period', 'POSTING_PERIOD');
    return normalized(company) === input.companyCode && normalized(period) === String(input.fiscalPeriod);
  });
  if (!matches.length) {
    if (role === 'TRANSACTION' || role === 'DERIVATIVE') return { rows: [] as AdapterSourceRow[], amount: zero() };
    throw new Error(`OA ${gl} ${role} source component is missing.`);
  }
  return {
    rows: matches,
    amount: sum(matches.map((row) => decimal(rawValue(row, 'Amount in local currency', 'Amount', 'VALUE', 'ROLE_AMOUNT'), `OA ${gl} ${role}`))),
  };
}

export function deriveCompany7000OaFromRincian(rows: AdapterSourceRow[]) {
  const rincianRows = rows.filter((row) => row.logicalSourceCode === 'AUDIT_RINCIAN' && row.sourceRowNumber >= 315 && row.sourceRowNumber <= 395);
  if (!rincianRows.length) return null;

  const coaColumns = new Set<number>();
  for (const row of rincianRows) {
    for (const [key, value] of Object.entries(rawRecord(row))) {
      const match = /^COLUMN_(\d+)$/.exec(key);
      if (match && OA_GLS.includes(String(value ?? '').trim() as typeof OA_GLS[number])) coaColumns.add(Number(match[1]));
    }
  }
  if (coaColumns.size !== 1) throw new Error('OA_7000_EXISTING authoritative Rincian COA column is missing or ambiguous.');
  const coaColumn = [...coaColumns][0];
  const amountColumn = coaColumn + 4;
  const allocations = new Map<string, { amount: Prisma.Decimal; rows: AdapterSourceRow[] }>();
  const amounts: Prisma.Decimal[] = [];

  for (const row of rincianRows) {
    const amountRaw = rawValue(row, `COLUMN_${amountColumn}`);
    const blankAmount = amountRaw == null || String(amountRaw).trim() === '';
    const amount = blankAmount ? zero() : decimal(amountRaw, `AUDIT_RINCIAN row ${row.sourceRowNumber} OA amount`);
    amounts.push(amount);
    const coa = String(rawValue(row, `COLUMN_${coaColumn}`) ?? '').trim();
    if (!amount.isZero() && !/^\d{8}$/.test(coa)) throw new Error(`OA_7000_EXISTING authoritative Rincian row ${row.sourceRowNumber} has non-zero amount without an 8-digit COA.`);
    if (!/^\d{8}$/.test(coa)) continue;
    const current = allocations.get(coa) ?? { amount: zero(), rows: [] as AdapterSourceRow[] };
    current.amount = current.amount.add(amount);
    current.rows.push(row);
    allocations.set(coa, current);
  }

  const total = money(sum(amounts));
  const normalizedAllocations = new Map([...allocations].map(([coa, value]) => [coa, { amount: money(value.amount), rows: value.rows }]));
  const allocationAudit = [...normalizedAllocations].map(([coa, value]) => ({ coa, amount: value.amount.toString(), sourceRowIds: value.rows.map((row) => row.id) }));
  return {
    components: [dep(total, 'AUDIT_RINCIAN', rincianRows, {
      role: 'AUTHORITATIVE_OA',
      businessRule: "SUM('rincian biaya'!F315:F395)",
      authoritativeRange: 'rincian biaya!F315:F395',
      coaColumn: `COLUMN_${coaColumn}`,
      amountColumn: `COLUMN_${amountColumn}`,
      allocations: allocationAudit,
    })],
    pasarAllocations: normalizedAllocations,
    allocationSourceLogicalCode: 'AUDIT_RINCIAN' as const,
  };
}

function buildLegacyOa(input: Company7000AdapterInput, pasar: Map<string, AggregatedCoa>) {
  const summary6811 = selectOaStatComponent(input, '68110001', 'SUMMARY');
  const summary681405 = selectOaStatComponent(input, '68140005', 'SUMMARY');
  const tx681405 = selectOaStatComponent(input, '68140005', 'TRANSACTION');
  const summary681406 = selectOaStatComponent(input, '68140006', 'SUMMARY');
  const tx681406 = selectOaStatComponent(input, '68140006', 'TRANSACTION');
  const derivative = selectOaStatComponent(input, '68140005', 'DERIVATIVE');
  const cc6811 = pasar.get('68110001');
  const cc6817 = pasar.get('68170002');
  if (!cc6811 || !cc6817) throw new Error('OA direct CC_PASAR components are missing.');

  const components = [
    dep(cc6811.amount, 'CC_PASAR', cc6811.rows, { gl: '68110001', role: 'CC_PASAR_DIRECT' }),
    dep(summary6811.amount, 'OA_STAT', summary6811.rows, { gl: '68110001', role: 'SUMMARY' }),
    dep(summary681405.amount, 'OA_STAT', summary681405.rows, { gl: '68140005', role: 'SUMMARY' }),
    dep(tx681405.amount, 'OA_STAT', tx681405.rows, { gl: '68140005', role: 'TRANSACTION', absentTreatedAsZero: tx681405.rows.length === 0 }),
    dep(summary681406.amount, 'OA_STAT', summary681406.rows, { gl: '68140006', role: 'SUMMARY' }),
    dep(tx681406.amount, 'OA_STAT', tx681406.rows, { gl: '68140006', role: 'TRANSACTION', absentTreatedAsZero: tx681406.rows.length === 0 }),
    dep(cc6817.amount, 'CC_PASAR', cc6817.rows, { gl: '68170002', role: 'CC_PASAR_DIRECT' }),
  ];
  const pasarAllocations = new Map<string, { amount: Prisma.Decimal; rows: AdapterSourceRow[] }>([
    ['68110001', { amount: money(cc6811.amount.add(summary6811.amount)), rows: uniqueRows([...cc6811.rows, ...summary6811.rows]) }],
    ['68140005', { amount: money(summary681405.amount.add(tx681405.amount)), rows: uniqueRows([...summary681405.rows, ...tx681405.rows]) }],
    ['68140006', { amount: money(summary681406.amount.add(tx681406.amount)), rows: uniqueRows([...summary681406.rows, ...tx681406.rows]) }],
    ['68170002', { amount: money(cc6817.amount), rows: uniqueRows([...cc6817.rows]) }],
  ]);
  return { components, pasarAllocations, derivative: { amount: derivative.amount, rows: derivative.rows }, allocationSourceLogicalCode: 'OA_STAT' as const };
}

function buildOa(input: Company7000AdapterInput, pasar: Map<string, AggregatedCoa>) {
  const authoritative = deriveCompany7000OaFromRincian(input.rows);
  if (!authoritative) return buildLegacyOa(input, pasar);
  const derivative = selectOaStatComponent(input, '68140005', 'DERIVATIVE');
  return { ...authoritative, derivative: { amount: derivative.amount, rows: derivative.rows } };
}
'''
adapter = adapter[:start] + new_oa + adapter[end:]
adapter = adapter.replace(
    "...(oaPasarAllocation ? { pasarAllocationRuleCode: 'OA_7000_EXISTING' } : {}),",
    "...(oaPasarAllocation ? { pasarAllocationRuleCode: 'OA_7000_EXISTING', pasarAllocationSourceLogicalCode: oa.allocationSourceLogicalCode } : {}),",
)
adapter_path.write_text(adapter)

engine = engine_path.read_text()
old_validation = """  input.formulaDependencies.oaComponents.forEach((item, index) => assertDependency(item, ['OA_STAT', 'CC_PASAR'], `OA component ${index + 1}`, item.sourceReference?.absentTreatedAsZero === true));\n  if (!input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode === 'OA_STAT')) throw new Error('OA_7000_EXISTING requires OA_STAT lineage.');"""
new_validation = """  const authoritativeRincian = input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode === 'AUDIT_RINCIAN');\n  if (authoritativeRincian) {\n    if (input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode !== 'AUDIT_RINCIAN')) throw new Error('OA_7000_EXISTING authoritative Rincian lineage must not be mixed with legacy OA sources.');\n    input.formulaDependencies.oaComponents.forEach((item, index) => assertDependency(item, 'AUDIT_RINCIAN', `OA authoritative Rincian component ${index + 1}`));\n  } else {\n    input.formulaDependencies.oaComponents.forEach((item, index) => assertDependency(item, ['OA_STAT', 'CC_PASAR'], `OA component ${index + 1}`, item.sourceReference?.absentTreatedAsZero === true));\n    if (!input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode === 'OA_STAT')) throw new Error('OA_7000_EXISTING legacy fallback requires OA_STAT lineage.');\n  }"""
if old_validation not in engine:
    raise SystemExit('company-7000.ts OA validation anchor not found')
engine_path.write_text(engine.replace(old_validation, new_validation))

adapter_test = adapter_test_path.read_text()
old_import = "import { buildCompany7000Input, deriveCompany7000TotalHpp, type AdapterMapping, type AdapterSourceRow } from './company-7000-source-adapter';"
new_import = "import { buildCompany7000Input, deriveCompany7000OaFromRincian, deriveCompany7000TotalHpp, type AdapterMapping, type AdapterSourceRow } from './company-7000-source-adapter';"
if old_import not in adapter_test:
    raise SystemExit('adapter test import anchor not found')
adapter_test = adapter_test.replace(old_import, new_import)
append_tests = r'''

test('Company 7000 authoritative Rincian OA reproduces Jan-Jun regression values and July control exactly', () => {
  const cases = [
    { period: 3, values: ['3716214178', '10094520554', '14452383785', '-61269091'], expected: '28201849426.00' },
    { period: 5, values: ['2482012325', '33284583512', '32027815656', '103007785'], expected: '67897419278.00' },
    { period: 6, values: ['2715416078', '31848948493', '28806721700', '103007785'], expected: '63474094056.00' },
    { period: 7, values: ['1488708636', '36586156368', '33890854236', '103007785'], expected: '72068727025.00' },
  ];
  for (const item of cases) {
    nextId = 9000 + item.period * 100;
    const rows = [
      row('AUDIT_RINCIAN', null, null, 315, { COLUMN_1: '68110001', COLUMN_5: item.values[0] }, null),
      row('AUDIT_RINCIAN', null, null, 339, { COLUMN_1: '68140005', COLUMN_5: item.values[1] }, null),
      row('AUDIT_RINCIAN', null, null, 340, { COLUMN_1: '68140006', COLUMN_5: item.values[2] }, null),
      row('AUDIT_RINCIAN', null, null, 350, { COLUMN_1: '68170002', COLUMN_5: item.values[3] }, null),
      row('AUDIT_RINCIAN', null, null, 351, { COLUMN_1: '68180001', COLUMN_5: '' }, null),
    ];
    const derived = deriveCompany7000OaFromRincian(rows);
    assert.ok(derived, `period ${item.period} authoritative OA should be detected`);
    assert.equal(derived.components[0].amount.toFixed(2), item.expected, `period ${item.period}`);
    assert.equal(derived.components[0].logicalSourceCode, 'AUDIT_RINCIAN');
    assert.equal(derived.components[0].sourceReference?.authoritativeRange, 'rincian biaya!F315:F395');
  }
});

test('adapter prefers authoritative Rincian OA for formula and HPP allocation while retaining derivative isolation', () => {
  const value = fixture();
  value.rows.push(
    row('AUDIT_RINCIAN', null, null, 315, { COLUMN_1: '68110001', COLUMN_5: '12' }, null),
    row('AUDIT_RINCIAN', null, null, 339, { COLUMN_1: '68140005', COLUMN_5: '7' }, null),
    row('AUDIT_RINCIAN', null, null, 340, { COLUMN_1: '68140006', COLUMN_5: '8' }, null),
    row('AUDIT_RINCIAN', null, null, 350, { COLUMN_1: '68170002', COLUMN_5: '20' }, null),
  );
  const input = buildCompany7000Input(value);
  assert.deepEqual(input.formulaDependencies.oaComponents.map((item) => item.logicalSourceCode), ['AUDIT_RINCIAN']);
  const result = calculateCompany7000(input);
  assert.equal(result.formulaResults.oa.toFixed(2), '47.00');
  const expected = new Map([['68110001', '88.00'], ['68140005', '7.00'], ['68140006', '12.00'], ['68170002', '10.00']]);
  for (const [coa, amount] of expected) {
    const line = input.sourceLines.find((item) => item.ruleCode === 'BASE_HPP_BY_COA_7000' && item.coaCode === coa);
    assert.ok(line, `missing authoritative HPP allocation line ${coa}`);
    assert.equal(line.amount.toFixed(2), amount);
    assert.equal(line.sourceReference?.pasarAllocationSourceLogicalCode, 'AUDIT_RINCIAN');
  }
});

test('authoritative Rincian OA fails closed when a non-zero authoritative row cannot be assigned to an 8-digit COA', () => {
  nextId = 9900;
  const rows = [
    row('AUDIT_RINCIAN', null, null, 315, { COLUMN_1: '68110001', COLUMN_5: '1' }, null),
    row('AUDIT_RINCIAN', null, null, 316, { COLUMN_1: 'TOTAL', COLUMN_5: '2' }, null),
  ];
  assert.throws(() => deriveCompany7000OaFromRincian(rows), /non-zero amount without an 8-digit COA/);
});
'''
if 'Company 7000 authoritative Rincian OA reproduces Jan-Jun regression values' not in adapter_test:
    adapter_test += append_tests
adapter_test_path.write_text(adapter_test)

engine_test = engine_test_path.read_text()
engine_test = engine_test.replace(
    "assert.throws(() => calculateCompany7000(wrongSource), /must resolve from OA_STAT/);",
    "assert.throws(() => calculateCompany7000(wrongSource), /legacy fallback requires OA_STAT lineage/);",
)
engine_append = r'''

test('engine accepts authoritative AUDIT_RINCIAN OA lineage and rejects mixed authoritative/legacy OA lineage', () => {
  const authoritative = golden();
  authoritative.formulaDependencies.oaComponents = [dep('72068727025', 'AUDIT_RINCIAN', [930, 931, 932, 933])];
  assert.equal(calculateCompany7000(authoritative).formulaResults.oa.toFixed(2), '72068727025.00');
  const mixed = golden();
  mixed.formulaDependencies.oaComponents = [dep('1', 'AUDIT_RINCIAN', [940]), dep('2', 'OA_STAT', [941])];
  assert.throws(() => calculateCompany7000(mixed), /must not be mixed/);
});
'''
if 'engine accepts authoritative AUDIT_RINCIAN OA lineage' not in engine_test:
    engine_test += engine_append
engine_test_path.write_text(engine_test)

print('patched Company 7000 OA authoritative calculation and regression tests')

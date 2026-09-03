import { Prisma } from '@prisma/client';
import { COMPANY_7000_RULES, type Company7000Input } from './company-7000';
import type { Company7000NatureTarget, FormulaDependency, ResolvedSourceLine } from './types';

const OA_GLS = ['68110001', '68140005', '68140006', '68170002'] as const;
const MORTAR_COA = '51300003';
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const zero = () => D(0);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.add(value), zero());
const uniqueRows = (rows: AdapterSourceRow[]) => [...new Map(rows.map((row) => [row.id, row])).values()];

export type AdapterSourceRow = {
  id: number;
  uploadId: number;
  uploadVersion: number;
  logicalSourceCode: string;
  sourceRowNumber: number;
  coaId: number | null;
  coaCode: string | null;
  description: string | null;
  amount: Prisma.Decimal | null;
  rawData: unknown;
};

export type AdapterMapping = {
  id: number;
  sourceLogicalCode: string;
  coaId: number;
  mappingAction: 'INCLUDE' | 'EXCLUDE' | 'RECLASS';
  costGroupId: number | null;
  natureId: number | null;
  groupCode: string | null;
  natureCode: string | null;
  targetActive: boolean;
  natureCalculationType: string | null;
};

export type Company7000AdapterInput = {
  companyCode: '7000';
  fiscalPeriod: number;
  rows: AdapterSourceRow[];
  mappings: AdapterMapping[];
  natures: Company7000NatureTarget[];
};

type AggregatedCoa = { amount: Prisma.Decimal; rows: AdapterSourceRow[]; coaId: number | null };

const rawRecord = (row: AdapterSourceRow) => row.rawData && typeof row.rawData === 'object' && !Array.isArray(row.rawData) ? row.rawData as Record<string, unknown> : {};
const normalized = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[\s_.-]+/g, ' ');
const rawValue = (row: AdapterSourceRow, ...keys: string[]) => {
  const raw = rawRecord(row);
  for (const [key, value] of Object.entries(raw)) if (keys.some((candidate) => normalized(candidate) === normalized(key))) return value;
  return undefined;
};
const decimal = (value: unknown, label: string) => {
  if (value == null || String(value).trim() === '') throw new Error(`${label} is missing.`);
  const cleaned = String(value).replace(/,/g, '').trim();
  try { return D(cleaned); } catch { throw new Error(`${label} must be numeric.`); }
};
const rowsFor = (input: Company7000AdapterInput, source: string) => input.rows.filter((row) => row.logicalSourceCode === source);
const rowComponent = (row: AdapterSourceRow) => ({
  logicalSourceCode: row.logicalSourceCode,
  sourceRowId: row.id,
  sourceRow: row.sourceRowNumber,
  coaCode: row.coaCode,
  amount: row.amount?.toString() ?? null,
});
const dep = (amount: Prisma.Decimal, source: string, rows: AdapterSourceRow[], reference: Record<string, unknown>): FormulaDependency => ({
  amount,
  logicalSourceCode: source,
  sourceRowIds: rows.map((row) => row.id),
  sourceReference: { ...reference, components: rows.map(rowComponent) },
});

export function deriveCompany7000TotalHpp(rows: AdapterSourceRow[]) {
  const tbRows = rows.filter((row) => row.logicalSourceCode === 'TB' && row.coaCode?.startsWith('5') && row.amount !== null);
  const mortar = tbRows.filter((row) => row.coaCode === MORTAR_COA);
  if (mortar.length > 1) throw new Error(`COGS Mortar ${MORTAR_COA} must not have more than one effective TB source row.`);
  const accountGroup5Total = sum(tbRows.map((row) => row.amount!));
  const cogsMortar = mortar[0]?.amount ?? zero();
  return {
    accountGroup5Total: money(accountGroup5Total),
    cogsMortar: money(cogsMortar),
    totalHpp: money(accountGroup5Total.sub(cogsMortar)),
    accountGroup5Rows: tbRows,
    mortarRows: mortar,
  };
}

function mappingsFor(input: Company7000AdapterInput, source: string, coaId: number) {
  return input.mappings.filter((mapping) => mapping.sourceLogicalCode === source && mapping.coaId === coaId);
}

function resolveMapping(input: Company7000AdapterInput, source: string, row: AdapterSourceRow, group: string, amount: Prisma.Decimal) {
  if (!row.coaId) {
    if (amount.isZero()) return null;
    throw new Error(`${source} COA ${row.coaCode ?? '?'} has no CostCoa.`);
  }
  const applicable = mappingsFor(input, source, row.coaId);
  if (applicable.length === 0) {
    if (amount.isZero()) return null;
    throw new Error(`${source} COA ${row.coaCode} has no effective mapping.`);
  }
  if (applicable.length > 1) throw new Error(`${source} COA ${row.coaCode} has ambiguous effective mappings.`);
  const mapping = applicable[0];
  if (!mapping.targetActive && mapping.mappingAction !== 'EXCLUDE') throw new Error(`${source} COA ${row.coaCode} mapping target is inactive.`);
  if (mapping.mappingAction !== 'EXCLUDE' && mapping.groupCode !== group) throw new Error(`${source} COA ${row.coaCode} must target ${group}.`);
  return mapping;
}

function aggregateByCoa(rows: AdapterSourceRow[]) {
  const result = new Map<string, AggregatedCoa>();
  for (const row of rows) {
    if (!row.coaCode || row.amount === null) continue;
    const current = result.get(row.coaCode) ?? { amount: zero(), rows: [], coaId: row.coaId };
    current.amount = current.amount.add(row.amount);
    current.rows.push(row);
    current.coaId ??= row.coaId;
    result.set(row.coaCode, current);
  }
  return result;
}

function specialCell(rows: AdapterSourceRow[], rowNumber: number, column: number, label: string) {
  const matches = rows.filter((row) => row.sourceRowNumber === rowNumber);
  if (matches.length !== 1) throw new Error(`${label} requires exactly one source row.`);
  return { row: matches[0], amount: decimal(rawValue(matches[0], `COLUMN_${column}`), label) };
}

function selectOaStatComponent(input: Company7000AdapterInput, gl: string, role: 'SUMMARY' | 'TRANSACTION' | 'DERIVATIVE') {
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

export function buildCompany7000Input(input: Company7000AdapterInput): Company7000Input {
  const tb = aggregateByCoa(rowsFor(input, 'TB'));
  const hppTotal = deriveCompany7000TotalHpp(input.rows);
  const adum = aggregateByCoa(rowsFor(input, 'CC_ADUM'));
  const pasar = aggregateByCoa(rowsFor(input, 'CC_PASAR'));
  const oa = buildOa(input, pasar);
  const sourceLines: ResolvedSourceLine[] = [];

  const makeLine = (row: AdapterSourceRow, mapping: AdapterMapping, amount: Prisma.Decimal, ruleCode?: string, refs?: AdapterSourceRow[], extra: Record<string, unknown> = {}): ResolvedSourceLine => {
    const lineageRows = refs ?? [row];
    return {
      sourceRowId: row.id,
      sourceRowIds: lineageRows.map((item) => item.id),
      uploadId: row.uploadId,
      uploadVersion: row.uploadVersion,
      logicalSourceCode: mapping.sourceLogicalCode,
      sourceRowNumber: row.sourceRowNumber,
      coaId: row.coaId,
      coaCode: row.coaCode ?? '',
      amount: money(amount),
      disposition: mapping.mappingAction === 'EXCLUDE' ? 'EXCLUDED' : mapping.mappingAction === 'RECLASS' ? 'RECLASSIFIED' : 'MAPPED',
      applicableMappingCount: 1,
      mappingId: mapping.id,
      mappingAction: mapping.mappingAction,
      costGroupId: mapping.costGroupId ?? undefined,
      groupCode: mapping.groupCode ?? undefined,
      natureId: mapping.natureId ?? undefined,
      natureCode: mapping.natureCode ?? undefined,
      targetActive: mapping.targetActive,
      natureCalculationType: mapping.natureCalculationType ?? undefined,
      ruleCode,
      sourceReference: {
        ...(ruleCode ? { ruleCode } : {}),
        mappingSourceLogicalCode: mapping.sourceLogicalCode,
        coaCode: row.coaCode,
        mappingId: mapping.id,
        sourceRowIds: lineageRows.map((item) => item.id),
        components: lineageRows.map(rowComponent),
        ...extra,
      },
    };
  };

  const makeDerivedLine = (target: Company7000NatureTarget, amount: Prisma.Decimal, ruleCode: string, logicalSourceCode: string, refs: AdapterSourceRow[], extra: Record<string, unknown> = {}): ResolvedSourceLine => {
    if (!refs.length) throw new Error(`${ruleCode} requires source-row lineage.`);
    const first = refs[0];
    return {
      sourceRowId: first.id,
      sourceRowIds: refs.map((row) => row.id),
      uploadId: first.uploadId,
      uploadVersion: first.uploadVersion,
      logicalSourceCode,
      sourceRowNumber: first.sourceRowNumber,
      coaId: null,
      coaCode: ruleCode,
      amount: money(amount),
      disposition: 'RECLASSIFIED',
      applicableMappingCount: 1,
      mappingAction: 'RECLASS',
      costGroupId: target.costGroupId,
      groupCode: target.groupCode,
      natureId: target.natureId,
      natureCode: target.natureCode,
      targetActive: target.active,
      natureCalculationType: target.calculationType,
      ruleCode,
      sourceReference: { ruleCode, logicalSourceCode, sourceRowIds: refs.map((row) => row.id), components: refs.map(rowComponent), ...extra },
    };
  };

  for (const [, item] of adum) {
    const row = item.rows[0];
    const mapping = resolveMapping(input, 'CC_ADUM', row, 'ADUM', item.amount);
    if (mapping && mapping.mappingAction !== 'EXCLUDE') sourceLines.push(makeLine(row, mapping, item.amount, undefined, item.rows));
  }

  for (const [, item] of pasar) {
    const row = item.rows[0];
    const mapping = resolveMapping(input, 'CC_PASAR', row, 'PASAR', item.amount);
    if (OA_GLS.includes(row.coaCode as typeof OA_GLS[number])) {
      if (!mapping || mapping.mappingAction !== 'EXCLUDE') throw new Error(`OA-controlled CC_PASAR COA ${row.coaCode} must have EXCLUDE disposition.`);
      continue;
    }
    if (mapping && mapping.mappingAction !== 'EXCLUDE') sourceLines.push(makeLine(row, mapping, item.amount, undefined, item.rows));
  }

  for (const coa of [...tb.keys()].filter((value) => value.startsWith('6'))) {
    const base = tb.get(coa)!;
    const adumAmount = adum.get(coa)?.amount ?? zero();
    const rawPasarAmount = pasar.get(coa)?.amount ?? zero();
    const oaPasarAllocation = oa.pasarAllocations.get(coa);
    const pasarAmount = oaPasarAllocation?.amount ?? rawPasarAmount;
    const derivative = coa === '68140005' ? oa.derivative.amount : zero();
    const amount = money(base.amount.sub(adumAmount).sub(pasarAmount).sub(derivative));
    const classifier = { ...base.rows[0], coaId: base.coaId };
    const mapping = resolveMapping(input, 'CC_PROD', classifier, 'HPP', amount);
    if (!mapping || mapping.mappingAction === 'EXCLUDE' || amount.isZero()) continue;
    const refs = uniqueRows([
      ...base.rows,
      ...(adum.get(coa)?.rows ?? []),
      ...(pasar.get(coa)?.rows ?? []),
      ...(oaPasarAllocation?.rows ?? []),
      ...(coa === '68140005' ? oa.derivative.rows : []),
    ]);
    sourceLines.push(makeLine(classifier, mapping, amount, 'BASE_HPP_BY_COA_7000', refs, {
      tb: base.amount.toString(),
      adum: adumAmount.toString(),
      pasarRaw: rawPasarAmount.toString(),
      pasarFinal: pasarAmount.toString(),
      ...(oaPasarAllocation ? { pasarAllocationRuleCode: 'OA_7000_EXISTING', pasarAllocationSourceLogicalCode: oa.allocationSourceLogicalCode } : {}),
      derivativeExcluded: derivative.toString(),
      ...(coa === '68140005' ? { derivativeRuleCode: 'DERIVATIVE_EXCLUDED_7000', derivativeAbsentTreatedAsZero: oa.derivative.rows.length === 0 } : {}),
    }));
  }

  const coalRows = rowsFor(input, 'COAL');
  const h10 = specialCell(coalRows, 10, 8, 'COAL H10');
  const h18 = specialCell(coalRows, 18, 8, 'COAL H18');
  const i10 = specialCell(coalRows, 10, 9, 'COAL I10');
  const i18 = specialCell(coalRows, 18, 9, 'COAL I18');
  const coalSplit = h10.amount.add(h18.amount).add(i10.amount).add(i18.amount);

  const whrpg = aggregateByCoa(rowsFor(input, 'CC_WHRPG'));
  const whrpgByNature = new Map<number, { amount: Prisma.Decimal; rows: AdapterSourceRow[]; mappingIds: Set<number> }>();
  for (const [coa, item] of whrpg) {
    const mapping = resolveMapping(input, 'CC_WHRPG', item.rows[0], 'HPP', item.amount);
    if (coa.startsWith('97')) {
      if (item.amount.isZero() && !mapping) continue;
      if (!mapping || mapping.mappingAction !== 'EXCLUDE') throw new Error(`WHRPG internal Cost Element ${coa} must be EXCLUDE.`);
      continue;
    }
    if (!coa.startsWith('6') || !mapping || mapping.mappingAction === 'EXCLUDE' || !mapping.natureId) continue;
    const current = whrpgByNature.get(mapping.natureId) ?? { amount: zero(), rows: [], mappingIds: new Set<number>() };
    current.amount = current.amount.add(item.amount);
    current.rows.push(...item.rows);
    current.mappingIds.add(mapping.id);
    whrpgByNature.set(mapping.natureId, current);
  }

  const allowedWhrpgNatureCodes = new Set(['H06', 'H07', 'H08', 'H09', 'H10', 'H11', 'H12', 'H13']);
  const primaryWhrpgRows: AdapterSourceRow[] = [];
  for (const [natureId, item] of whrpgByNature) {
    const target = input.natures.find((nature) => nature.natureId === natureId && nature.groupCode === 'HPP');
    if (!target) throw new Error(`WHRPG Nature ${natureId} is not an active HPP target.`);
    if (!allowedWhrpgNatureCodes.has(target.natureCode) && !item.amount.isZero()) throw new Error(`WHRPG primary amount cannot target ${target.natureCode}.`);
    primaryWhrpgRows.push(...item.rows);
    if (target.natureCode !== 'H07' && !item.amount.isZero()) {
      sourceLines.push(makeDerivedLine(target, item.amount.neg(), 'WHRPG_RECLASS_7000', 'CC_WHRPG', item.rows, {
        whrpgAmount: item.amount.toString(),
        mappingIds: [...item.mappingIds],
        direction: 'REMOVE_FROM_ORIGINAL_NATURE',
      }));
    }
  }

  const h07 = input.natures.find((nature) => nature.groupCode === 'HPP' && nature.natureCode === 'H07');
  const h06 = input.natures.find((nature) => nature.groupCode === 'HPP' && nature.natureCode === 'H06');
  if (!h07 || !h06) throw new Error('H06/H07 HPP Nature masters are required.');
  const whrpgTotal = sum([...whrpgByNature.values()].map((item) => item.amount));
  if (!whrpgTotal.isZero()) sourceLines.push(makeDerivedLine(h07, whrpgTotal, 'WHRPG_RECLASS_7000', 'CC_WHRPG', primaryWhrpgRows, { whrpgPrimaryTotal: whrpgTotal.toString(), direction: 'ADD_ALL_PRIMARY_TO_ELECTRICITY' }));
  sourceLines.push(makeDerivedLine(h06, coalSplit.neg(), 'COAL_ENERGY_SPLIT_7000', 'COAL', [h10.row, h18.row, i10.row, i18.row], {
    coal: h10.amount.add(h18.amount).toString(),
    coalInbound: i10.amount.add(i18.amount).toString(),
    direction: 'REMOVE_COAL_FROM_OTHER_FUEL',
  }));

  const solarRows = rowsFor(input, 'SOLAR_PP_ORDER').filter((row) => normalized(rawValue(row, 'Material')) === '112 200001' && normalized(rawValue(row, 'Plant')) === '7702' && normalized(rawValue(row, 'Cost element text')).includes('CONSUMPTION PRODUCTION CKM3N'));
  if (solarRows.length !== 1) throw new Error('SOLAR_PP_ORDER support record 112-200001 / 7702 is missing or ambiguous.');
  const solarAmount = decimal(rawValue(solarRows[0], 'Value in Obj Crcy', 'Amount'), 'SOLAR_PP_ORDER Value in Obj Crcy');
  const solarLine = sourceLines.find((line) => line.coaCode === '62140001');
  if (!solarLine) throw new Error('HPP allocation COA 62140001 for SOLAR_PP_ORDER support is missing.');
  solarLine.sourceReference = {
    ...solarLine.sourceReference,
    solarSupport: { ruleCode: 'SOLAR_PP_ORDER_SUPPORT_7000', amount: solarAmount.toString(), sourceRowIds: solarRows.map((row) => row.id), additive: false, components: solarRows.map(rowComponent) },
  };

  const clinkerRows = rowsFor(input, 'CLINKER_PURCHASE').filter((row) => row.sourceRowNumber >= 63 && row.sourceRowNumber <= 69);
  if (clinkerRows.length !== 7) throw new Error('CLINKER_PURCHASE F63:F69 dependency is incomplete.');
  const clinker = money(sum(clinkerRows.map((row) => decimal(rawValue(row, 'COLUMN_6'), 'CLINKER_PURCHASE F63:F69'))));
  const h14 = input.natures.find((nature) => nature.groupCode === 'HPP' && nature.natureCode === 'H14');
  if (!h14) throw new Error('H14 clinker Nature is missing.');
  const h14Base = money(sum(sourceLines.filter((line) => line.groupCode === 'HPP' && line.natureCode === 'H14').map((line) => line.amount)));
  sourceLines.push(makeDerivedLine(h14, clinker.sub(h14Base), 'CLINKER_PURCHASE_7000', 'CLINKER_PURCHASE', clinkerRows, {
    cells: 'F63:F69',
    baseH14: h14Base.toString(),
    authoritativeClinker: clinker.toString(),
    direction: 'SET_H14_TO_CLINKER_SOURCE_BY_DELTA',
  }));

  return {
    natures: input.natures,
    sourceLines,
    formulaDependencies: {
      accountGroup5Total: dep(hppTotal.accountGroup5Total, 'TB', hppTotal.accountGroup5Rows, { selector: 'account group starts with 5' }),
      cogsMortar: dep(hppTotal.cogsMortar, 'TB', hppTotal.mortarRows, { coa: MORTAR_COA, absentTreatedAsZero: hppTotal.mortarRows.length === 0 }),
      coalComponents: [dep(h10.amount, 'COAL', [h10.row], { cell: 'H10' }), dep(h18.amount, 'COAL', [h18.row], { cell: 'H18' })],
      coalInboundComponents: [dep(i10.amount, 'COAL', [i10.row], { cell: 'I10' }), dep(i18.amount, 'COAL', [i18.row], { cell: 'I18' })],
      oaComponents: oa.components,
    },
  };
}

export const COMPANY_7000_ADAPTER_RULES = {
  ...COMPANY_7000_RULES,
  baseHpp: 'BASE_HPP_BY_COA_7000',
  derivativeExcluded: 'DERIVATIVE_EXCLUDED_7000',
  whrpgReclass: 'WHRPG_RECLASS_7000',
  coalEnergySplit: 'COAL_ENERGY_SPLIT_7000',
  clinker: 'CLINKER_PURCHASE_7000',
  solarSupport: 'SOLAR_PP_ORDER_SUPPORT_7000',
} as const;
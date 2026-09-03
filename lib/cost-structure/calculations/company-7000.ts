import { Prisma } from '@prisma/client';
import { isMappingBlockingAmount } from '../reconciliation/money';
import { DERIVATIVE_SOURCE_CODES } from './constants';
import type { Company7000GroupCode, Company7000NatureTarget, EngineActualLine, FormulaDependency, ResolvedAdjustment, ResolvedSourceLine } from './types';

export const ENGINE1_7000_RULE_SET_VERSION = 'ENGINE1_7000_V1';
export const COMPANY_7000_GROUPS = ['HPP', 'ADUM', 'PASAR'] as const;
export const COMPANY_7000_MAPPED_SOURCES = ['CC_PROD', 'CC_ADUM', 'CC_PASAR', 'CC_WHRPG', 'CLINKER_PURCHASE', 'SOLAR_PP_ORDER'] as const;
export const COMPANY_7000_RULES = {
  totalHpp: 'HPP_TOTAL_7000', coal: 'COAL_7000_EXISTING', coalInbound: 'COAL_INBOUND_7000_EXISTING',
  oa: 'OA_7000_EXISTING', inventoryDifference: 'HPP_INVENTORY_DIFF_7000',
} as const;

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const derivatives = new Set<string>(DERIVATIVE_SOURCE_CODES);
const mappedSources = new Set<string>(COMPANY_7000_MAPPED_SOURCES);

export type Company7000Input = {
  sourceLines: ResolvedSourceLine[];
  adjustments?: ResolvedAdjustment[];
  natures: Company7000NatureTarget[];
  formulaDependencies: {
    accountGroup5Total: FormulaDependency;
    cogsMortar: FormulaDependency;
    coalComponents: FormulaDependency[];
    coalInboundComponents: FormulaDependency[];
    oaComponents: FormulaDependency[];
  };
};

function uniqueTarget(input: Company7000Input, groupCode: Company7000GroupCode, ruleCode: string) {
  const targets = input.natures.filter((nature) => nature.groupCode === groupCode && nature.ruleCode === ruleCode);
  if (targets.length !== 1) throw new Error(`Exactly one active ${groupCode} Nature is required for rule ${ruleCode}.`);
  const target = targets[0];
  if (!target.active) throw new Error(`Rule target ${ruleCode} is inactive.`);
  return target;
}

function sum(values: Prisma.Decimal[]) { return values.reduce((total, value) => total.add(value), zero()); }

function assertDependency(dependency: FormulaDependency, expectedSources: string | string[], label: string, allowAbsentZero = false) {
  const allowed = Array.isArray(expectedSources) ? expectedSources : [expectedSources];
  if (!allowed.includes(dependency.logicalSourceCode)) throw new Error(`${label} must resolve from ${allowed.join(' or ')}.`);
  const explicitAbsentZero = allowAbsentZero
    && dependency.amount.isZero()
    && dependency.sourceRowIds.length === 0
    && dependency.sourceReference?.absentTreatedAsZero === true;
  if (dependency.sourceRowIds.length === 0 && !explicitAbsentZero) throw new Error(`${label} requires source-row lineage.`);
}

function assertFormulaDependencies(input: Company7000Input) {
  assertDependency(input.formulaDependencies.accountGroup5Total, 'TB', 'Account Group 5 total');
  assertDependency(input.formulaDependencies.cogsMortar, 'TB', 'COGS Mortar', true);
  if (input.formulaDependencies.coalComponents.length !== 2) throw new Error('COAL_7000_EXISTING requires exactly two verified COAL components.');
  if (input.formulaDependencies.coalInboundComponents.length !== 2) throw new Error('COAL_INBOUND_7000_EXISTING requires exactly two verified COAL components.');
  if (input.formulaDependencies.oaComponents.length === 0) throw new Error('OA_7000_EXISTING requires verified OA components.');
  input.formulaDependencies.coalComponents.forEach((item, index) => assertDependency(item, 'COAL', `Batubara component ${index + 1}`));
  input.formulaDependencies.coalInboundComponents.forEach((item, index) => assertDependency(item, 'COAL', `Batubara Inbound component ${index + 1}`));
  const authoritativeRincian = input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode === 'AUDIT_RINCIAN');
  if (authoritativeRincian) {
    if (input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode !== 'AUDIT_RINCIAN')) throw new Error('OA_7000_EXISTING authoritative Rincian lineage must not be mixed with legacy OA sources.');
    input.formulaDependencies.oaComponents.forEach((item, index) => assertDependency(item, 'AUDIT_RINCIAN', `OA authoritative Rincian component ${index + 1}`));
  } else {
    input.formulaDependencies.oaComponents.forEach((item, index) => assertDependency(item, ['OA_STAT', 'CC_PASAR'], `OA component ${index + 1}`, item.sourceReference?.absentTreatedAsZero === true));
    if (!input.formulaDependencies.oaComponents.some((item) => item.logicalSourceCode === 'OA_STAT')) throw new Error('OA_7000_EXISTING legacy fallback requires OA_STAT lineage.');
  }
}

export function calculateCompany7000(input: Company7000Input) {
  assertFormulaDependencies(input);
  const actualLines: EngineActualLine[] = [];
  const metadata = new Map<string, Company7000NatureTarget>();
  for (const nature of input.natures) {
    if (nature.active && COMPANY_7000_GROUPS.includes(nature.groupCode)) metadata.set(`${nature.costGroupId}:${nature.natureId}`, nature);
  }

  for (const line of input.sourceLines) {
    const controlledDerived = line.disposition === 'RECLASSIFIED' && Boolean(line.ruleCode);
    if (derivatives.has(line.logicalSourceCode) || (!mappedSources.has(line.logicalSourceCode) && !controlledDerived)) continue;
    if (line.disposition === 'CONTROL_ROW' || line.disposition === 'SUPPORT_SOURCE' || line.disposition === 'EXCLUDED') continue;
    if (line.disposition === 'UNMAPPED' && !isMappingBlockingAmount(line.amount.toString())) continue;
    if (line.applicableMappingCount !== 1) throw new Error(line.applicableMappingCount === 0 ? 'Non-zero source row has no effective mapping.' : 'Source row has ambiguous effective mappings.');
    if (line.disposition === 'UNMAPPED') throw new Error('Non-zero UNMAPPED source amount blocks calculation.');
    const target = input.natures.find((nature) => nature.costGroupId === line.costGroupId && nature.natureId === line.natureId);
    if (!target || !target.active || !line.targetActive) throw new Error('Mapping target is inactive.');
    if (target.calculationType !== 'MAPPED' || line.natureCalculationType !== 'MAPPED') throw new Error('FORMULA and RESIDUAL Nature cannot be a direct COA mapping target.');
    const derivedLine = controlledDerived && line.coaId === null;
    actualLines.push({
      costGroupId: target.costGroupId,
      natureId: target.natureId,
      coaId: line.coaId,
      lineType: derivedLine ? 'FORMULA' : 'COA',
      sourceAmount: derivedLine ? null : money(line.amount),
      adjustmentAmount: zero(),
      finalAmount: money(line.amount),
      sourceRowId: line.sourceRowId || null,
      ruleCode: line.ruleCode,
      sourceReference: line.sourceReference ?? { uploadId: line.uploadId, uploadVersion: line.uploadVersion, logicalSourceCode: line.logicalSourceCode, sourceRowNumber: line.sourceRowNumber, sourceRowIds: line.sourceRowIds ?? [line.sourceRowId], mappingId: line.mappingId, mappingAction: line.mappingAction, coaCode: line.coaCode },
    });
  }

  for (const adjustment of input.adjustments ?? []) {
    const target = input.natures.find((nature) => nature.costGroupId === adjustment.costGroupId && nature.natureId === adjustment.natureId);
    if (!target || !target.active || !adjustment.targetActive) throw new Error('Adjustment target is inactive.');
    if (target.calculationType !== 'MAPPED' || adjustment.natureCalculationType !== 'MAPPED') throw new Error('FORMULA and RESIDUAL Nature cannot receive a normal adjustment.');
    actualLines.push({ costGroupId: target.costGroupId, natureId: target.natureId, coaId: adjustment.coaId, lineType: 'ADJUSTMENT', sourceAmount: null, adjustmentAmount: money(adjustment.amount), finalAmount: money(adjustment.amount), sourceRowId: null, sourceReference: { adjustmentId: adjustment.adjustmentId, reason: adjustment.reason, reference: adjustment.reference } });
  }

  const formula = (group: Company7000GroupCode, ruleCode: string, dependencies: FormulaDependency[]) => {
    const target = uniqueTarget(input, group, ruleCode);
    if (target.calculationType !== 'FORMULA') throw new Error(`${ruleCode} must target a FORMULA Nature.`);
    const amount = money(sum(dependencies.map((item) => item.amount)));
    actualLines.push({ costGroupId: target.costGroupId, natureId: target.natureId, coaId: null, lineType: 'FORMULA', sourceAmount: null, adjustmentAmount: zero(), finalAmount: amount, sourceRowId: null, ruleCode, sourceReference: { ruleCode, dependencies: dependencies.map((item) => ({ logicalSourceCode: item.logicalSourceCode, sourceRowIds: item.sourceRowIds, ...item.sourceReference })) } });
    return amount;
  };
  const coal = formula('HPP', COMPANY_7000_RULES.coal, input.formulaDependencies.coalComponents);
  const coalInbound = formula('HPP', COMPANY_7000_RULES.coalInbound, input.formulaDependencies.coalInboundComponents);
  const oa = formula('PASAR', COMPANY_7000_RULES.oa, input.formulaDependencies.oaComponents);

  const totalHpp = money(input.formulaDependencies.accountGroup5Total.amount.sub(input.formulaDependencies.cogsMortar.amount));
  const totalsBeforeResidual = new Map<string, Prisma.Decimal>();
  for (const line of actualLines) totalsBeforeResidual.set(`${line.costGroupId}:${line.natureId}`, (totalsBeforeResidual.get(`${line.costGroupId}:${line.natureId}`) ?? zero()).add(line.finalAmount));
  const inventoryTarget = uniqueTarget(input, 'HPP', COMPANY_7000_RULES.inventoryDifference);
  if (inventoryTarget.calculationType !== 'RESIDUAL') throw new Error('HPP_INVENTORY_DIFF_7000 must target a RESIDUAL Nature.');
  const hppSubtotal = sum([...metadata.values()].filter((nature) => nature.groupCode === 'HPP' && nature.natureId !== inventoryTarget.natureId).map((nature) => totalsBeforeResidual.get(`${nature.costGroupId}:${nature.natureId}`) ?? zero()));
  const inventoryDifference = money(totalHpp.sub(hppSubtotal));
  actualLines.push({ costGroupId: inventoryTarget.costGroupId, natureId: inventoryTarget.natureId, coaId: null, lineType: 'RESIDUAL', sourceAmount: null, adjustmentAmount: zero(), finalAmount: inventoryDifference, sourceRowId: null, ruleCode: COMPANY_7000_RULES.inventoryDifference, sourceReference: { ruleCode: COMPANY_7000_RULES.inventoryDifference, totalHppRuleCode: COMPANY_7000_RULES.totalHpp, totalHpp: totalHpp.toString(), subtotalBeforeResidual: hppSubtotal.toString(), accountGroup5: input.formulaDependencies.accountGroup5Total.sourceReference, cogsMortar: input.formulaDependencies.cogsMortar.sourceReference } });

  const totals = new Map<string, Prisma.Decimal>();
  for (const line of actualLines) totals.set(`${line.costGroupId}:${line.natureId}`, (totals.get(`${line.costGroupId}:${line.natureId}`) ?? zero()).add(line.finalAmount));
  const natureTotals = [...metadata.values()].map((nature) => ({ costGroupId: nature.costGroupId, natureId: nature.natureId, groupCode: nature.groupCode, natureCode: nature.natureCode, amount: money(totals.get(`${nature.costGroupId}:${nature.natureId}`) ?? zero()) })).sort((a, b) => COMPANY_7000_GROUPS.indexOf(a.groupCode) - COMPANY_7000_GROUPS.indexOf(b.groupCode) || a.natureCode.localeCompare(b.natureCode));
  const groupTotals: Record<Company7000GroupCode, Prisma.Decimal> = { HPP: totalHpp, ADUM: zero(), PASAR: zero() };
  groupTotals.ADUM = money(sum(natureTotals.filter((item) => item.groupCode === 'ADUM').map((item) => item.amount)));
  groupTotals.PASAR = money(sum(natureTotals.filter((item) => item.groupCode === 'PASAR').map((item) => item.amount)));
  const groupIds = new Map(natureTotals.map((item) => [item.groupCode, item.costGroupId]));
  const controls = COMPANY_7000_GROUPS.map((code) => {
    const natureSum = sum(natureTotals.filter((item) => item.groupCode === code).map((item) => item.amount));
    return { resultCode: `${code}_NATURE_RECONCILIATION`, costGroupId: groupIds.get(code) ?? 0, amount: groupTotals[code], difference: money(groupTotals[code].sub(natureSum)) };
  });
  if (!controls.find((item) => item.resultCode === 'HPP_NATURE_RECONCILIATION')!.difference.isZero()) throw new Error('HPP Nature reconciliation must equal zero.');
  return { actualLines, natureTotals, groupTotals, companyTotal: money(groupTotals.HPP.add(groupTotals.ADUM).add(groupTotals.PASAR)), controls, formulaResults: { totalHpp, coal, coalInbound, oa, inventoryDifference, pasarRegular: money(groupTotals.PASAR.sub(oa)) } };
}

import 'server-only';
import { CostMappingAction, CostPeriodStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isMappingBlockingAmount } from '@/lib/cost-structure/reconciliation/money';
import { deriveCompany7000CcProdMappingCandidates } from './company-7000-derived-cc-prod';
import {
  coaFamilyPrefixes,
  exactTargetsAgreeWithFamily,
  historicalPredecessorValidTo,
  inferHierarchicalFamilyMappingTarget,
  type FamilyMappingEvidence,
  type HierarchicalFamilyEvidenceLevel,
} from './family-mapping-policy';

const SOURCES_BY_COMPANY: Record<string, string[]> = {
  '2000': ['CC_ADUM', 'CC_PASAR'],
  '7000': ['CC_PROD', 'CC_ADUM', 'CC_PASAR', 'CC_WHRPG'],
};

function candidateKey(source: string, coaCode: string) {
  return `${source}\u0000${coaCode}`;
}

/**
 * Creates an exact COA mapping only when its family has a single deterministic
 * disposition. Family matching is hierarchical: four digits first, then a guarded
 * three-digit fallback. A conflicting narrower family fails closed and the broader
 * family is never used to hide that ambiguity.
 *
 * Same-company evidence wins inside each family level. Cross-company evidence is
 * allowed only when the current company has no usable family evidence and all usable
 * mappings for that same source/family agree on action + Cost Group code + Nature code.
 * The broader three-digit fallback additionally requires at least two distinct evidence
 * COAs in the selected scope.
 *
 * A future exact mapping no longer blocks historical recovery by itself. When there is
 * no exact mapping effective for the current period, a predecessor may be created only
 * when every existing exact interval agrees with the deterministic family target. The
 * predecessor ends before the next exact interval and never crosses a FINALIZED period.
 * This permits safe historical reuse without mutating finalized lineage or overriding a
 * narrower authoritative mapping.
 *
 * Amounts within the Rp1 de-minimis tolerance are deliberately ignored here. They stay
 * visible for audit but do not justify creating a persistent business mapping.
 */
export async function backfillDeterministicFamilyMappings(uploadId: number, userId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301, ${uploadId})`;

    const upload = await tx.costUpload.findUnique({
      where: { id: uploadId },
      include: { period: { include: { company: true } }, sourceRows: true },
    });
    if (!upload) throw new Error('Upload tidak ditemukan.');
    if (!upload.isActiveVersion) throw new Error('Family mapping hanya untuk upload aktif.');
    if (upload.period.status === CostPeriodStatus.FINALIZED) throw new Error('Periode FINALIZED tidak dapat diubah.');

    const sources = SOURCES_BY_COMPANY[upload.period.company.companyCode] ?? [];
    if (!sources.length) return { created: 0, skipped: 0, mappingIds: [] as number[] };

    const candidates = new Map<string, {
      source: string;
      coaCode: string;
      description: string;
      total: Prisma.Decimal;
    }>();

    for (const row of upload.sourceRows) {
      if (!sources.includes(row.logicalSourceCode) || !row.coaCodeRaw) continue;
      if (!coaFamilyPrefixes(row.coaCodeRaw).length) continue;
      const key = candidateKey(row.logicalSourceCode, row.coaCodeRaw);
      const existing = candidates.get(key) ?? {
        source: row.logicalSourceCode,
        coaCode: row.coaCodeRaw,
        description: row.descriptionRaw?.trim() || row.coaCodeRaw,
        total: new Prisma.Decimal(0),
      };
      existing.total = existing.total.add(row.amount ?? 0);
      candidates.set(key, existing);
    }

    // Company 7000 calculation can require a CC_PROD mapping for a COA that exists
    // only in TB, because base HPP is derived from TB - ADUM - PASAR. Feed those
    // deterministic residual requirements through the same guarded family inference.
    if (upload.period.company.companyCode === '7000') {
      for (const derived of deriveCompany7000CcProdMappingCandidates(upload.sourceRows)) {
        const key = candidateKey('CC_PROD', derived.coaCode);
        const existing = candidates.get(key);
        if (!existing || isMappingBlockingAmount(derived.total.toString())) {
          candidates.set(key, {
            source: 'CC_PROD',
            coaCode: derived.coaCode,
            description: derived.description,
            total: derived.total,
          });
        }
      }
    }

    for (const [key, item] of [...candidates]) {
      if (!isMappingBlockingAmount(item.total.toString())) candidates.delete(key);
    }
    if (!candidates.size) return { created: 0, skipped: 0, mappingIds: [] as number[] };

    const yearPeriods = await tx.costPeriod.findMany({
      where: {
        companyId: upload.period.companyId,
        fiscalYear: upload.period.fiscalYear,
      },
      include: {
        uploads: {
          where: { isActiveVersion: true },
          include: {
            sourceRows: {
              where: { logicalSourceCode: { in: sources } },
              select: { logicalSourceCode: true, coaCodeRaw: true, amount: true },
            },
          },
        },
      },
      orderBy: { periodStart: 'asc' },
    });

    const occurrence = new Map<string, { earliest: Date | null }>();
    for (const period of yearPeriods) {
      const activeUpload = period.uploads[0];
      if (!activeUpload) continue;
      const totals = new Map<string, Prisma.Decimal>();
      for (const row of activeUpload.sourceRows) {
        if (!row.coaCodeRaw) continue;
        const key = candidateKey(row.logicalSourceCode, row.coaCodeRaw);
        if (!candidates.has(key)) continue;
        totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).add(row.amount ?? 0));
      }
      for (const [key, total] of totals) {
        if (!isMappingBlockingAmount(total.toString())) continue;
        const state = occurrence.get(key) ?? { earliest: null };
        if (
          period.status !== CostPeriodStatus.FINALIZED &&
          (!state.earliest || period.periodStart < state.earliest)
        ) state.earliest = period.periodStart;
        occurrence.set(key, state);
      }
    }

    const familyEvidenceCache = new Map<string, FamilyMappingEvidence[]>();
    const createdIds: number[] = [];
    let skipped = 0;

    async function loadFamilyEvidence(source: string, familyPrefix: string) {
      const familyCacheKey = `${source}\u0000${familyPrefix}`;
      let evidence = familyEvidenceCache.get(familyCacheKey);
      if (evidence) return evidence;

      const mappings = await tx.costCoaMapping.findMany({
        where: {
          sourceLogicalCode: source,
          active: true,
          coa: { coaCode: { startsWith: familyPrefix } },
        },
        include: {
          coa: { select: { coaCode: true } },
          costGroup: true,
          nature: true,
        },
      });
      evidence = mappings
        .filter((mapping) => {
          if (mapping.mappingAction === CostMappingAction.EXCLUDE) return true;
          if (mapping.mappingAction !== CostMappingAction.INCLUDE) return false;
          return Boolean(
            mapping.costGroup?.active &&
            mapping.costGroup.companyId === mapping.companyId &&
            mapping.nature?.active &&
            mapping.nature.calculationType === 'MAPPED' &&
            mapping.nature.costGroupId === mapping.costGroupId
          );
        })
        .map((mapping) => ({
          companyId: mapping.companyId,
          coaCode: mapping.coa.coaCode,
          mappingAction: mapping.mappingAction,
          groupCode: mapping.costGroup?.code ?? null,
          natureCode: mapping.nature?.code ?? null,
        }));
      familyEvidenceCache.set(familyCacheKey, evidence);
      return evidence;
    }

    for (const [key, item] of candidates) {
      const state = occurrence.get(key);
      let coa = await tx.costCoa.findUnique({ where: { coaCode: item.coaCode } });
      if (!coa) {
        coa = await tx.costCoa.create({
          data: { coaCode: item.coaCode, coaDescription: item.description },
        });
      }

      const exactMappings = await tx.costCoaMapping.findMany({
        where: {
          companyId: upload.period.companyId,
          sourceLogicalCode: item.source,
          coaId: coa.id,
          active: true,
        },
        include: { costGroup: true, nature: true },
        orderBy: { validFrom: 'asc' },
      });
      const effectiveExact = exactMappings.some((mapping) =>
        mapping.validFrom <= upload.period.periodStart &&
        (!mapping.validTo || mapping.validTo >= upload.period.periodStart)
      );
      if (effectiveExact) { skipped += 1; continue; }

      const families = coaFamilyPrefixes(item.coaCode);
      if (!families.length) { skipped += 1; continue; }
      const levels: HierarchicalFamilyEvidenceLevel[] = [];
      for (const familyPrefix of families) {
        levels.push({
          familyPrefix,
          evidence: await loadFamilyEvidence(item.source, familyPrefix),
        });
      }

      const inferred = inferHierarchicalFamilyMappingTarget(levels, upload.period.companyId);
      if (!inferred) { skipped += 1; continue; }
      const exactTargets = exactMappings.map((mapping) => ({
        mappingAction: mapping.mappingAction,
        groupCode: mapping.costGroup?.code ?? null,
        natureCode: mapping.nature?.code ?? null,
      }));
      if (!exactTargetsAgreeWithFamily(exactTargets, inferred)) { skipped += 1; continue; }

      let costGroupId: number | null = null;
      let natureId: number | null = null;
      if (inferred.mappingAction === 'INCLUDE') {
        const group = await tx.costGroup.findFirst({
          where: {
            companyId: upload.period.companyId,
            code: inferred.groupCode ?? undefined,
            active: true,
          },
        });
        if (!group) { skipped += 1; continue; }
        const nature = await tx.costNature.findFirst({
          where: {
            costGroupId: group.id,
            code: inferred.natureCode ?? undefined,
            active: true,
            calculationType: 'MAPPED',
          },
        });
        if (!nature) { skipped += 1; continue; }
        costGroupId = group.id;
        natureId = nature.id;
      }

      const validFrom = state?.earliest ?? upload.period.periodStart;
      const futureExactStarts = exactMappings
        .map((mapping) => mapping.validFrom)
        .filter((value) => value > validFrom);
      const nextExactStart = futureExactStarts.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const finalizedPeriods = await tx.costPeriod.findMany({
        where: {
          companyId: upload.period.companyId,
          status: CostPeriodStatus.FINALIZED,
          periodStart: {
            gt: validFrom,
            ...(nextExactStart ? { lt: nextExactStart } : {}),
          },
        },
        orderBy: { periodStart: 'asc' },
        select: { periodStart: true },
      });
      const validTo = historicalPredecessorValidTo(
        validFrom,
        futureExactStarts,
        finalizedPeriods.map((period) => period.periodStart)
      );
      if (validTo && validTo < validFrom) { skipped += 1; continue; }

      const predecessor = exactMappings.length > 0;
      const mapping = await tx.costCoaMapping.create({
        data: {
          companyId: upload.period.companyId,
          sourceLogicalCode: item.source,
          coaId: coa.id,
          costGroupId,
          natureId,
          mappingAction: inferred.mappingAction === 'EXCLUDE' ? CostMappingAction.EXCLUDE : CostMappingAction.INCLUDE,
          validFrom,
          validTo,
          active: true,
          note: predecessor
            ? `Auto historical family predecessor ${inferred.familyPrefix}; target agrees with all existing exact mapping intervals; ${inferred.scope}; ${inferred.mappingAction}:${inferred.groupCode ?? '-'}:${inferred.natureCode ?? '-'}`
            : `Auto family mapping ${inferred.familyPrefix} (${inferred.familyPrefix.length}-digit); ${inferred.scope}; ${inferred.evidenceCount} unanimous evidence row(s), ${inferred.evidenceCoaCount} distinct COA(s); ${inferred.mappingAction}:${inferred.groupCode ?? '-'}:${inferred.natureCode ?? '-'}`,
          createdById: userId,
        },
      });
      createdIds.push(mapping.id);

      await tx.costAuditLog.create({
        data: {
          userId,
          periodId: upload.periodId,
          action: predecessor ? 'AUTO_FAMILY_PREDECESSOR_MAPPING' : 'AUTO_FAMILY_COA_MAPPING',
          entityType: 'CostCoaMapping',
          entityId: String(mapping.id),
          newValueJson: {
            sourceLogicalCode: item.source,
            coaCode: item.coaCode,
            familyPrefix: inferred.familyPrefix,
            familyDigits: inferred.familyPrefix.length,
            evidenceScope: inferred.scope,
            evidenceCount: inferred.evidenceCount,
            evidenceCoaCount: inferred.evidenceCoaCount,
            exactIntervalCount: exactMappings.length,
            mappingAction: inferred.mappingAction,
            costGroupId,
            natureId,
            groupCode: inferred.groupCode,
            natureCode: inferred.natureCode,
            validFrom: validFrom.toISOString(),
            validTo: validTo?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
          reason: predecessor
            ? 'Historical predecessor allowed only when deterministic family target agrees with every existing exact mapping interval; interval stops before the next exact mapping or FINALIZED period.'
            : 'Deterministic hierarchical COA family mapping (4-digit then guarded 3-digit); unanimous evidence only; de-minimis and ambiguous families excluded.',
        },
      });
    }

    return { created: createdIds.length, skipped, mappingIds: createdIds };
  }, { maxWait: 10_000, timeout: 60_000 });
}

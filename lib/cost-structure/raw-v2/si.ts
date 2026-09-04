import { Prisma } from '@prisma/client';

const D = (value: Prisma.Decimal.Value = 0) => new Prisma.Decimal(value);

export type SiSourceRow = {
  id: number;
  logicalSourceCode: string;
  originalSheetName: string;
  sourceRowNumber: number;
  coaCode: string;
  descriptionRaw?: string | null;
  amount: Prisma.Decimal;
};

export type SiMapping = {
  id: number;
  sourceLogicalCode: string;
  coaCode: string;
  action: 'INCLUDE' | 'EXCLUDE' | 'RECLASS';
  groupId: number | null;
  groupCode: string | null;
  natureId: number | null;
  natureCode: string | null;
  natureCalculationType: string | null;
  groupActive: boolean | null;
  natureActive: boolean | null;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  updatedAt: Date;
  note?: string | null;
};

export type SiIssue = {
  code: string;
  source: string;
  coaCode: string;
  amount: string;
  message: string;
};

type Bucket = { count: number; amount: Prisma.Decimal };
type Coverage = Record<'include' | 'exclude' | 'reclass' | 'unmapped' | 'ambiguous' | 'invalidTarget', Bucket> & {
  nonZeroCount: number;
  sourceAmount: Prisma.Decimal;
  accountedAmount: Prisma.Decimal;
  difference: Prisma.Decimal;
};
export type SiAnalyticalRow = SiSourceRow & {
  rawAmount: Prisma.Decimal;
  mappedAmount: Prisma.Decimal;
  analyticalClass: string;
  ruleCode: string;
  mappingStatus: string;
  mapping: SiMapping | null;
  reference: unknown;
};

function bucket(): Bucket {
  return { count: 0, amount: D() };
}
function coverage(): Coverage {
  return {
    include: bucket(),
    exclude: bucket(),
    reclass: bucket(),
    unmapped: bucket(),
    ambiguous: bucket(),
    invalidTarget: bucket(),
    nonZeroCount: 0,
    sourceAmount: D(),
    accountedAmount: D(),
    difference: D(),
  };
}
function sum(rows: SiSourceRow[]) {
  return rows.reduce((value, row) => value.plus(row.amount), D());
}
function group(rows: SiSourceRow[]) {
  const out = new Map<string, SiSourceRow[]>();
  for (const row of rows) out.set(row.coaCode, [...(out.get(row.coaCode) ?? []), row]);
  return out;
}
function consolidated(rows: SiSourceRow[], source: string): SiSourceRow[] {
  return [...group(rows.filter((row) => row.logicalSourceCode === source)).entries()].map(([coaCode, values]) => ({
    ...values[0],
    coaCode,
    amount: sum(values),
  }));
}

export function calculateCompany2000Si(input: { rows: SiSourceRow[]; mappings: SiMapping[]; effectiveDate: Date }) {
  const issues: SiIssue[] = [];
  const analyticalRows: SiAnalyticalRow[] = [];
  const coverageBySource: Record<string, Coverage> = {
    CC_ADUM: coverage(),
    CC_PASAR: coverage(),
    RINCIAN_ADUM_DELTA: coverage(),
    CC_DERIV: coverage(),
  };
  const mappingUsed = new Map<number, SiMapping>();
  const natureTotals = new Map<
    string,
    { natureId: number; natureCode: string; groupId: number; groupCode: string; amount: Prisma.Decimal }
  >();
  const sources = Object.fromEntries(
    ['TB', 'CC_ADUM', 'CC_PASAR', 'CC_DERIV'].map((code) => [code, consolidated(input.rows, code)])
  ) as Record<string, SiSourceRow[]>;
  const tb = group(sources.TB);
  const adum = group(sources.CC_ADUM);
  const pasar = group(sources.CC_PASAR);

  function resolve(
    source: 'CC_ADUM' | 'CC_PASAR',
    row: SiSourceRow,
    coverageKey: string,
    amount: Prisma.Decimal,
    klass: string,
    ruleCode: string,
    reference: unknown,
    sign = D(1)
  ) {
    const currentCoverage = coverageBySource[coverageKey];
    if (!amount.isZero()) {
      currentCoverage.nonZeroCount++;
      currentCoverage.sourceAmount = currentCoverage.sourceAmount.plus(amount);
    }

    const candidates = input.mappings.filter(
      (mapping) =>
        mapping.sourceLogicalCode === source &&
        mapping.coaCode === row.coaCode &&
        mapping.active &&
        mapping.validFrom <= input.effectiveDate &&
        (mapping.validTo === null || mapping.validTo >= input.effectiveDate)
    );

    let status: keyof Pick<Coverage, 'include' | 'exclude' | 'reclass' | 'unmapped' | 'ambiguous' | 'invalidTarget'>;
    let mapping: SiMapping | null = null;
    if (candidates.length === 0) {
      status = 'unmapped';
    } else if (candidates.length > 1) {
      status = 'ambiguous';
    } else {
      mapping = candidates[0];
      status = mapping.action.toLowerCase() as 'include' | 'exclude' | 'reclass';
      const expectedGroup = source === 'CC_ADUM' ? 'ADUM' : 'PASAR';
      if (
        mapping.action !== 'EXCLUDE' &&
        (!mapping.groupId ||
          !mapping.natureId ||
          !mapping.groupActive ||
          !mapping.natureActive ||
          mapping.groupCode !== expectedGroup ||
          mapping.natureCalculationType !== 'MAPPED')
      ) {
        status = 'invalidTarget';
      }
    }

    if (!amount.isZero()) {
      currentCoverage[status].count++;
      currentCoverage[status].amount = currentCoverage[status].amount.plus(amount);
    }
    if (!amount.isZero() && ['unmapped', 'ambiguous', 'invalidTarget'].includes(status)) {
      issues.push({
        code: status.toUpperCase(),
        source: coverageKey,
        coaCode: row.coaCode,
        amount: amount.toString(),
        message: `Non-zero ${coverageKey} ${row.coaCode} has ${status} mapping.`,
      });
    }

    const contributes = mapping && (status === 'include' || status === 'reclass');
    const mappedAmount = contributes ? amount.mul(sign) : D();
    if (mapping) mappingUsed.set(mapping.id, mapping);
    analyticalRows.push({
      ...row,
      logicalSourceCode: coverageKey === 'RINCIAN_ADUM_DELTA' ? 'TB' : row.logicalSourceCode,
      rawAmount: amount,
      mappedAmount,
      analyticalClass: mapping?.action === 'EXCLUDE' ? 'EXCLUDED_EVIDENCE' : klass,
      ruleCode,
      mappingStatus: status.toUpperCase(),
      mapping,
      reference,
    });

    if (contributes && mapping!.natureId && mapping!.natureCode && mapping!.groupId && mapping!.groupCode) {
      const key = `${mapping!.groupCode}:${mapping!.natureCode}`;
      const prior = natureTotals.get(key);
      natureTotals.set(key, {
        natureId: mapping!.natureId,
        natureCode: mapping!.natureCode,
        groupId: mapping!.groupId,
        groupCode: mapping!.groupCode,
        amount: (prior?.amount ?? D()).plus(mappedAmount),
      });
    }
    if (!amount.isZero() && !['unmapped', 'ambiguous', 'invalidTarget'].includes(status)) {
      currentCoverage.accountedAmount = currentCoverage.accountedAmount.plus(amount);
    }
  }

  for (const row of sources.CC_ADUM) {
    resolve('CC_ADUM', row, 'CC_ADUM', row.amount, 'BASE_CC_ADUM', 'RAW_BASE_ADUM', {
      sourceRowIds: adum.get(row.coaCode)?.map((item) => item.id),
    });
  }
  for (const row of sources.CC_PASAR) {
    resolve('CC_PASAR', row, 'CC_PASAR', row.amount, 'BASE_CC_PASAR', 'RAW_BASE_PASAR', {
      sourceRowIds: pasar.get(row.coaCode)?.map((item) => item.id),
    });
  }
  for (const coaCode of new Set([...adum.keys(), ...pasar.keys()])) {
    const tbRows = tb.get(coaCode);
    const adumRows = adum.get(coaCode) ?? [];
    const pasarRows = pasar.get(coaCode) ?? [];
    if (!tbRows?.length) {
      const baseAmount = sum([...adumRows, ...pasarRows]);
      if (!baseAmount.isZero()) {
        issues.push({
          code: 'MISSING_TB',
          source: 'RINCIAN_ADUM_DELTA',
          coaCode,
          amount: baseAmount.toString(),
          message: `TB is required for ${coaCode}.`,
        });
      }
      continue;
    }
    const delta = sum(tbRows).minus(sum(adumRows)).minus(sum(pasarRows));
    if (!delta.isZero()) {
      resolve(
        'CC_ADUM',
        tbRows[0],
        'RINCIAN_ADUM_DELTA',
        delta,
        'RINCIAN_ADUM_DELTA',
        'RINCIAN_ADUM_RESIDUAL',
        {
          tbRowIds: tbRows.map((item) => item.id),
          adumRowIds: adumRows.map((item) => item.id),
          pasarRowIds: pasarRows.map((item) => item.id),
          rawAdum: sum(adumRows).toString(),
          rawPasar: sum(pasarRows).toString(),
          tbAmount: sum(tbRows).toString(),
        }
      );
    }
  }

  const derivRows = group(input.rows.filter((row) => row.logicalSourceCode === 'CC_DERIV'));
  for (const row of sources.CC_DERIV) {
    if (!row.amount.isZero() && !pasar.has(row.coaCode)) {
      issues.push({
        code: 'DERIV_NOT_IN_PASAR',
        source: 'CC_DERIV',
        coaCode: row.coaCode,
        amount: row.amount.toString(),
        message: `DERIV ${row.coaCode} is absent from PASAR.`,
      });
    }
    resolve(
      'CC_PASAR',
      row,
      'CC_DERIV',
      row.amount,
      'DERIV_PASAR_OFFSET',
      'CC_DERIV_NEGATIVE_PASAR',
      { derivSourceRowIds: derivRows.get(row.coaCode)?.map((item) => item.id) },
      D(-1)
    );
  }

  for (const currentCoverage of Object.values(coverageBySource)) {
    currentCoverage.difference = currentCoverage.sourceAmount.minus(currentCoverage.accountedAmount);
  }
  const nature = [...natureTotals.values()].sort(
    (left, right) => left.groupCode.localeCompare(right.groupCode) || left.natureCode.localeCompare(right.natureCode)
  );
  const adumTotal = nature
    .filter((item) => item.groupCode === 'ADUM')
    .reduce((value, item) => value.plus(item.amount), D());
  const pasarTotal = nature
    .filter((item) => item.groupCode === 'PASAR')
    .reduce((value, item) => value.plus(item.amount), D());

  return {
    success: issues.length === 0 && Object.values(coverageBySource).every((item) => item.difference.isZero()),
    issues,
    analyticalRows,
    coverageBySource,
    natureTotals: nature,
    adumTotal,
    pasarTotal,
    companyTotal: adumTotal.plus(pasarTotal),
    mappingsUsed: [...mappingUsed.values()].sort((left, right) => left.id - right.id),
  };
}

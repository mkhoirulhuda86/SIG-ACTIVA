import { gunzipSync } from 'node:zlib';
import {
  COMPANY_2000_EXACT_STYLE_GZIP_BASE64,
  COMPANY_2000_EXACT_STYLE_SOURCE,
} from './company-2000-exact-data';
import type {
  BlueprintCellStyle,
  SheetStyleBlueprint,
  WorkbookStyleBlueprint,
  WorksheetPropertiesBlueprint,
} from './types';

type ExtractedColumn = {
  column: number;
  width?: number;
  hidden?: boolean;
  outlineLevel?: number;
  style?: BlueprintCellStyle;
};

type ExtractedRow = {
  row: number;
  height?: number;
  hidden?: boolean;
  outlineLevel?: number;
};

type ExtractedSheet = {
  name: string;
  state?: SheetStyleBlueprint['state'];
  views?: SheetStyleBlueprint['views'];
  pageSetup?: SheetStyleBlueprint['pageSetup'];
  headerFooter?: SheetStyleBlueprint['headerFooter'];
  properties?: Record<string, unknown>;
  merges?: string[];
  autoFilter?: SheetStyleBlueprint['autoFilter'];
  columns?: ExtractedColumn[];
  rows?: ExtractedRow[];
  styles?: BlueprintCellStyle[];
  runs?: Array<{ range: string; style: number }>;
};

type ExtractedPackage = {
  companyCode: string;
  sourceFileName: string;
  uploadId: number;
  uploadVersion: number;
  sheets: ExtractedSheet[];
};

function columnLetter(column: number) {
  let value = column;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheetProperties(value: Record<string, unknown> | undefined): WorksheetPropertiesBlueprint | undefined {
  if (!value) return undefined;
  const output: WorksheetPropertiesBlueprint = {};
  for (const key of ['defaultRowHeight', 'defaultColWidth', 'dyDescent', 'outlineLevelRow', 'outlineLevelCol'] as const) {
    const candidate = value[key];
    if (typeof candidate === 'number') output[key] = candidate;
  }
  return Object.keys(output).length ? output : undefined;
}

function decodePackage(): ExtractedPackage {
  const json = gunzipSync(Buffer.from(COMPANY_2000_EXACT_STYLE_GZIP_BASE64, 'base64')).toString('utf8');
  const value = JSON.parse(json) as ExtractedPackage;
  if (
    value.companyCode !== COMPANY_2000_EXACT_STYLE_SOURCE.companyCode ||
    value.sourceFileName !== COMPANY_2000_EXACT_STYLE_SOURCE.sourceFileName ||
    value.uploadId !== COMPANY_2000_EXACT_STYLE_SOURCE.uploadId ||
    value.uploadVersion !== COMPANY_2000_EXACT_STYLE_SOURCE.uploadVersion
  ) {
    throw new Error('Frozen Company 2000 style package identity mismatch.');
  }
  return value;
}

function convertSheet(raw: ExtractedSheet, aliases: string[]): SheetStyleBlueprint {
  const styleCatalog: Record<string, BlueprintCellStyle> = {};
  for (const [index, style] of (raw.styles ?? []).entries()) styleCatalog[`cell-${index}`] = style;

  const columns = (raw.columns ?? []).map((column, index) => {
    let styleRole: string | undefined;
    if (column.style && Object.keys(column.style).length) {
      styleRole = `column-${index}`;
      styleCatalog[styleRole] = column.style;
    }
    return {
      key: columnLetter(column.column),
      width: column.width,
      hidden: column.hidden,
      outlineLevel: column.outlineLevel,
      styleRole,
    };
  });

  return {
    sourceTemplateName: raw.name,
    aliases,
    styleCatalog,
    columns,
    rows: (raw.rows ?? []).map((row) => ({
      index: row.row,
      height: row.height,
      hidden: row.hidden,
      outlineLevel: row.outlineLevel,
    })),
    merges: raw.merges ?? [],
    views: raw.views,
    autoFilter: raw.autoFilter,
    pageSetup: raw.pageSetup,
    headerFooter: raw.headerFooter,
    properties: worksheetProperties(raw.properties),
    state: raw.state,
    ranges: (raw.runs ?? []).map((run) => {
      const styleRole = `cell-${run.style}`;
      if (!styleCatalog[styleRole]) throw new Error(`Frozen Company 2000 style references missing style ${run.style}.`);
      return { range: run.range, styleRole };
    }),
  };
}

const extracted = decodePackage();
const sheetByName = new Map(extracted.sheets.map((sheet) => [sheet.name.trim().toLocaleLowerCase('id-ID'), sheet]));

function requireSheet(name: string) {
  const sheet = sheetByName.get(name.trim().toLocaleLowerCase('id-ID'));
  if (!sheet) throw new Error(`Frozen Company 2000 template sheet ${name} tidak tersedia.`);
  return sheet;
}

export const company2000ExactStyleBlueprint: WorkbookStyleBlueprint = {
  companyCode: '2000',
  templateVersion: 'company-2000-jul-2026-active-upload-v2-exact-style-v1',
  sourceTemplatePeriod: '2026-07',
  exactTemplateFidelity: true,
  sheets: {
    SI: convertSheet(requireSheet('SI'), []),
    'rincian biaya': convertSheet(requireSheet('rincian biaya'), []),
    'cc ADM': convertSheet(requireSheet('cc_adm'), ['cc_adm', 'cc adm']),
    'cc pasar': convertSheet(requireSheet('cc pasar'), ['cc_pasar']),
  },
};

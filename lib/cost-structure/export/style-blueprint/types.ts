import type ExcelJS from 'exceljs';

/**
 * Style roles are intentionally open-ended. The approved template extraction may contain many
 * distinct static styles, while apply.ts validates every referenced role at runtime.
 */
export type StyleRole = string;

export type BlueprintCellStyle = Partial<Pick<ExcelJS.Style,
  'font' | 'alignment' | 'border' | 'fill' | 'numFmt' | 'protection'>>;

export interface ColumnBlueprint {
  key: string | number;
  width?: number;
  hidden?: boolean;
  outlineLevel?: number;
  styleRole?: StyleRole;
}

export interface RowBlueprint {
  index: number;
  height?: number;
  hidden?: boolean;
  outlineLevel?: number;
  styleRole?: StyleRole;
}

export interface RangeStyleBlueprint {
  range: string;
  styleRole: StyleRole;
}

/** A range whose last row can follow DB-generated output size while preserving a template minimum. */
export interface RepeatingRangeBlueprint {
  fromColumn: string;
  toColumn: string;
  fromRow: number;
  toRow?: number;
  minimumToRow?: number;
  styleRole: StyleRole;
}

export interface WorksheetPropertiesBlueprint {
  defaultRowHeight?: number;
  defaultColWidth?: number;
  dyDescent?: number;
  outlineLevelRow?: number;
  outlineLevelCol?: number;
}

export interface SheetStyleBlueprint {
  sourceTemplateName?: string;
  aliases?: readonly string[];
  columns?: readonly ColumnBlueprint[];
  rows?: readonly RowBlueprint[];
  merges?: readonly string[];
  views?: readonly Partial<ExcelJS.WorksheetView>[];
  autoFilter?: ExcelJS.AutoFilter;
  autoFilterMinRowCount?: number;
  pageSetup?: Partial<ExcelJS.PageSetup>;
  headerFooter?: Partial<ExcelJS.HeaderFooter>;
  properties?: WorksheetPropertiesBlueprint;
  state?: ExcelJS.WorksheetState;
  styleCatalog: Readonly<Record<StyleRole, BlueprintCellStyle>>;
  repeatingRanges?: readonly RepeatingRangeBlueprint[];
  ranges?: readonly RangeStyleBlueprint[];
}

export interface WorkbookStyleBlueprint {
  /** Identifies the template/style dataset without changing the exporter architecture. */
  templateVersion: string;
  sourceTemplatePeriod?: string;
  companyCode: '2000' | '7000';
  exactTemplateFidelity: boolean;
  sheets: Readonly<Record<string, SheetStyleBlueprint>>;
}

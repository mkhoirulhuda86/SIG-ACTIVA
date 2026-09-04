import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { decimalString, parseRawAmount, semanticText } from './amount';
import type { RawV2ParsedRow, RawV2ParsedSource, RawV2ParserIssue } from './types';

const YTD = /^FY\s+(\d{4})\s+1\s*-\s*(\d{1,2})$/i;
const COA = /\/(\d{8})\s*$/;

export function findTbHeader(grid: unknown[][]) {
  for (let r=0;r<grid.length;r++) {
    const cells=grid[r].map(semanticText);
    const account=cells.findIndex(v=>v.toLowerCase()==='fs item/account');
    const variance=cells.findIndex(v=>v.toLowerCase()==='variance');
    const periods=cells.map((v,i)=>({match:v.match(YTD),i})).filter(v=>v.match);
    if(account>=0&&variance>=0&&periods.length) return {row:r,account,variance,periods};
  }
}

export function parseTbSheet(sheet: XLSX.WorkSheet, sheetName:string, companyCode:string) {
  const grid=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:null});
  const rows:RawV2ParsedRow[]=[]; const issues:RawV2ParserIssue[]=[];
  const header=findTbHeader(grid);
  const base:RawV2ParsedSource={logicalSourceCode:'TB',originalSheetName:sheetName,presenceStatus:'PRESENT',companyCode,detailRowCount:0,nonZeroDetailRowCount:0};
  if(!header){issues.push({issueCode:'RAW_TB_HEADER_NOT_FOUND',severity:'ERROR',message:'TB semantic header was not found.',logicalSourceCode:'TB',originalSheetName:sheetName});return {source:base,rows,issues};}
  const parsedPeriods=header.periods.map(p=>({column:p.i,year:Number(p.match![1]),period:Number(p.match![2])})).sort((a,b)=>b.period-a.period);
  const current=parsedPeriods[0]; const previous=parsedPeriods.find(p=>p.year===current.year&&p.period===current.period-1);
  base.fiscalYear=current.year;base.fiscalPeriod=current.period;base.headerRowNumber=header.row+1;
  if(current.period<1||current.period>12||(current.period>1&&!previous)) issues.push({issueCode:'RAW_TB_PERIOD_COLUMNS_INVALID',severity:'ERROR',message:'TB current/previous YTD columns are invalid.',logicalSourceCode:'TB',originalSheetName:sheetName});
  const seen=new Set<string>(); let total=new Prisma.Decimal(0);
  for(let r=header.row+1;r<grid.length;r++){
    const label=semanticText(grid[r]?.[header.account]); if(!label&&!grid[r]?.some(v=>v!==null&&v!==''))continue;
    const coa=label.match(COA)?.[1]; const raw={fsItemAccount:grid[r]?.[header.account]??null,currentYtd:grid[r]?.[current.column]??null,previousYtd:previous?grid[r]?.[previous.column]??null:'0',variance:grid[r]?.[header.variance]??null};
    if(!coa){rows.push({logicalSourceCode:'TB',originalSheetName:sheetName,sourceRowNumber:r+1,rawDataJson:raw,descriptionRaw:label,normalizationStatus:'NON_FINANCIAL_LINEAGE'});continue;}
    const currentAmount=parseRawAmount(raw.currentYtd), previousAmount=current.period===1?new Prisma.Decimal(0):parseRawAmount(raw.previousYtd), variance=parseRawAmount(raw.variance);
    if(!currentAmount||!previousAmount||!variance){issues.push({issueCode:'RAW_TB_INVALID_AMOUNT',severity:'ERROR',message:`Invalid TB amount for COA ${coa}.`,logicalSourceCode:'TB',originalSheetName:sheetName,sourceRowNumber:r+1});}
    if(seen.has(coa))issues.push({issueCode:'RAW_TB_DUPLICATE_COA',severity:'ERROR',message:`Duplicate TB COA ${coa}.`,logicalSourceCode:'TB',originalSheetName:sheetName,sourceRowNumber:r+1});
    seen.add(coa);
    const difference=currentAmount&&previousAmount&&variance?currentAmount.minus(previousAmount).minus(variance):null;
    if(difference&&!difference.isZero())issues.push({issueCode:'RAW_TB_VARIANCE_MISMATCH',severity:'ERROR',message:`TB variance control differs for COA ${coa}.`,logicalSourceCode:'TB',originalSheetName:sheetName,sourceRowNumber:r+1});
    if(variance)total=total.plus(variance);
    rows.push({logicalSourceCode:'TB',originalSheetName:sheetName,sourceRowNumber:r+1,rawDataJson:raw,normalizedDataJson:{currentYtd:currentAmount?.toString()??null,previousYtd:previousAmount?.toString()??null,variance:variance?.toString()??null,validationDifference:difference?.toString()??null},coaCodeRaw:coa,descriptionRaw:label.replace(COA,'').trim(),amount:variance?decimalString(variance):undefined,normalizationStatus:currentAmount&&previousAmount&&variance?'FINANCIAL_DETAIL':'INVALID'});
  }
  base.detailRowCount=seen.size;base.nonZeroDetailRowCount=rows.filter(r=>r.coaCodeRaw&&r.amount&&new Prisma.Decimal(r.amount).isZero()===false).length;base.detailTotal=decimalString(total);base.metadataJson={currentYtdColumn:current.column+1,previousYtdColumn:previous?previous.column+1:null,varianceColumn:header.variance+1};
  return {source:base,rows,issues};
}

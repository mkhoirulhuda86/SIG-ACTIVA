import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { decimalString, parseRawAmount, semanticText } from './amount';
import { classifyCostCenterGroup, sheetNameHint } from './source-registry';
import type { RawV2ParsedRow, RawV2ParsedSource, RawV2ParserIssue } from './types';

const COA=/^\s*(\d{8})(?:\s+|$)/;
const META=['Controlling Area','Fiscal Year','From Period','To Period','Cost Center Group','Plan Version'];
const normalizedControl=(value:unknown)=>semanticText(value).replace(/^\*+\s*/,'').toLowerCase();

function normalizeMetadataValue(key:string,value:string){
  const normalized=semanticText(value);
  if(!normalized)return '';
  if(['Fiscal Year','From Period','To Period','Plan Version'].includes(key))return normalized.match(/-?\d+/)?.[0]??normalized;
  if(key==='Cost Center Group'||key==='Controlling Area')return normalized.split(/\s+/)[0]??normalized;
  return normalized;
}

function findMetadata(grid:unknown[][]){
  const result:Record<string,string>={};
  for(const row of grid)for(let c=0;c<row.length;c++){
    const label=semanticText(row[c]);
    if(!label)continue;
    const lower=label.toLowerCase();
    for(const key of META){
      const keyLower=key.toLowerCase();
      let candidate='';
      if(lower===keyLower||lower===`${keyLower}:`){
        candidate=row.slice(c+1).map(semanticText).find(Boolean)??'';
      }else if(lower.startsWith(`${keyLower} `)||lower.startsWith(`${keyLower}:`)){
        candidate=label.slice(key.length).replace(/^\s*:\s*/,'').trim();
      }
      if(candidate){result[key]=normalizeMetadataValue(key,candidate);break;}
    }
  }
  return result;
}

function findHeader(grid:unknown[][]){
  for(let r=0;r<grid.length;r++)for(let c=0;c<grid[r].length;c++)if(semanticText(grid[r][c]).toLowerCase()==='cost elements'){
    for(let a=c+1;a<grid[r].length;a++)if(semanticText(grid[r][a]).toLowerCase()==='act. costs')return {row:r,coaColumn:c,amountColumn:a};
  }
}

/** Input grid is deliberately sliced to Excel B:K before this function sees it. */
export function parseCcSheet(sheet:XLSX.WorkSheet,sheetName:string,companyCode:string){
  const whole=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:null});
  const grid=whole.map(row=>row.slice(1,11));
  const metadata=findMetadata(grid); const issues:RawV2ParserIssue[]=[];const rows:RawV2ParsedRow[]=[];
  const group=metadata['Cost Center Group']; const logical=group?classifyCostCenterGroup(companyCode,group):undefined;
  const sourceCode=logical??`UNCLASSIFIED_${sheetName}`;
  const source:RawV2ParsedSource={logicalSourceCode:sourceCode,originalSheetName:sheetName,presenceStatus:'PRESENT',companyCode,controllingArea:metadata['Controlling Area'],costCenterGroup:group,detailRowCount:0,nonZeroDetailRowCount:0,metadataJson:metadata};
  if(!metadata['Fiscal Year']||!metadata['From Period']||!metadata['To Period']||!group)issues.push({issueCode:'RAW_CC_METADATA_NOT_FOUND',severity:'ERROR',message:'Required CC metadata was not found inside B:K.',logicalSourceCode:sourceCode,originalSheetName:sheetName});
  const year=Number(metadata['Fiscal Year']),from=Number(metadata['From Period']),to=Number(metadata['To Period']);
  if(Number.isInteger(year))source.fiscalYear=year;if(Number.isInteger(to))source.fiscalPeriod=to;
  if(Number.isFinite(from)&&Number.isFinite(to)&&from!==to)issues.push({issueCode:'RAW_CC_PERIOD_RANGE_INVALID',severity:'ERROR',message:'CC From Period must equal To Period.',logicalSourceCode:sourceCode,originalSheetName:sheetName});
  if(group&&!logical)issues.push({issueCode:'RAW_CC_GROUP_UNKNOWN',severity:'ERROR',message:`Unknown Cost Center Group ${group}.`,logicalSourceCode:sourceCode,originalSheetName:sheetName});
  const hint=sheetNameHint(sheetName);if(logical&&hint&&hint!=='TB'&&hint!==logical)issues.push({issueCode:'RAW_SOURCE_CLASSIFICATION_CONFLICT',severity:'ERROR',message:`Sheet hint ${hint} conflicts with group ${group}.`,logicalSourceCode:logical,originalSheetName:sheetName});
  const header=findHeader(grid);if(!header){issues.push({issueCode:'RAW_CC_HEADER_NOT_FOUND',severity:'ERROR',message:'CC financial Cost Elements / Act. Costs header was not found inside B:K.',logicalSourceCode:sourceCode,originalSheetName:sheetName});return {source,rows,issues};}
  source.headerRowNumber=header.row+1;let total=new Prisma.Decimal(0),debit:Prisma.Decimal|null=null,over:Prisma.Decimal|null=null,debitSeen=false;
  for(let r=header.row+1;r<grid.length;r++){
    const label=semanticText(grid[r]?.[header.coaColumn]);const control=normalizedControl(label);
    if(control==='debit'){debitSeen=true;debit=parseRawAmount(grid[r]?.[header.amountColumn]);if(!debit)issues.push({issueCode:'RAW_CC_INVALID_AMOUNT',severity:'ERROR',message:'Debit control amount is invalid.',logicalSourceCode:sourceCode,originalSheetName:sheetName,sourceRowNumber:r+1});continue;}
    if(control==='over/underabsorption'){over=parseRawAmount(grid[r]?.[header.amountColumn]);continue;}
    if(debitSeen)continue;
    if(label.toLowerCase()==='cost elements'&&semanticText(grid[r]?.[header.amountColumn]).toLowerCase()==='act. costs')continue;
    const coa=label.match(COA)?.[1];if(!coa)continue;
    const amount=parseRawAmount(grid[r]?.[header.amountColumn]);
    if(!amount)issues.push({issueCode:'RAW_CC_INVALID_AMOUNT',severity:'ERROR',message:`Invalid Act. Costs for COA ${coa}.`,logicalSourceCode:sourceCode,originalSheetName:sheetName,sourceRowNumber:r+1});
    if(amount)total=total.plus(amount);
    rows.push({logicalSourceCode:sourceCode,originalSheetName:sheetName,sourceRowNumber:r+1,rawDataJson:grid[r].map(value=>value===undefined?null:value) as never,normalizedDataJson:{controllingArea:source.controllingArea??null,costCenterGroup:group??null,fiscalYear:source.fiscalYear??null,fiscalPeriod:source.fiscalPeriod??null},coaCodeRaw:coa,descriptionRaw:label.replace(COA,'').trim(),amount:amount?decimalString(amount):undefined,normalizationStatus:amount?'FINANCIAL_DETAIL':'INVALID'});
  }
  if(!debitSeen)issues.push({issueCode:'RAW_CC_DEBIT_NOT_FOUND',severity:'ERROR',message:'CC Debit control was not found.',logicalSourceCode:sourceCode,originalSheetName:sheetName});
  const difference=debit?total.minus(debit):null;if(difference&&!difference.isZero())issues.push({issueCode:'RAW_CC_DETAIL_DEBIT_MISMATCH',severity:'ERROR',message:'CC detail total does not equal Debit.',logicalSourceCode:sourceCode,originalSheetName:sheetName});
  source.detailRowCount=rows.length;source.nonZeroDetailRowCount=rows.filter(r=>r.amount&&!new Prisma.Decimal(r.amount).isZero()).length;source.detailTotal=decimalString(total);source.debitControl=debit?decimalString(debit):undefined;source.overUnderControl=over?decimalString(over):undefined;source.reconciliationDifference=difference?decimalString(difference):undefined;
  return {source,rows,issues};
}

import * as XLSX from 'xlsx';
import { findTbHeader, parseTbSheet } from './tb';
import { parseCcSheet, readCcAuthoritativeGrid } from './cc';
import { semanticText } from './amount';
import { sheetNameHint } from './source-registry';
import type { RawV2ParsedWorkbook, RawV2ParsedSource, RawV2ParserIssue, RawV2UploadContext } from './types';

const REQUIRED=['TB','CC_ADUM','CC_PASAR'] as const;
const OPTIONAL=['CC_PROD','CC_DERIV'] as const;
const CC_MARKERS=['cost center group','cost elements','controlling area'] as const;

function looksLikeCc(grid:unknown[][]){
  return grid.some(row=>row.some(value=>{
    const text=semanticText(value).replace(/:$/,'').toLowerCase();
    return CC_MARKERS.some(marker=>text===marker||text.startsWith(`${marker} `)||text.startsWith(`${marker}:`));
  }));
}

export async function parseRawV2Workbook(bytes:Uint8Array,context:RawV2UploadContext):Promise<RawV2ParsedWorkbook>{
  const workbook=XLSX.read(bytes,{type:'array',cellDates:false});
  const sources:RawV2ParsedSource[]=[];
  const rows:RawV2ParsedWorkbook['rows']=[];
  const issues:RawV2ParserIssue[]=[];
  const malformedOptionalCandidates=new Set<(typeof OPTIONAL)[number]>();

  for(const name of workbook.SheetNames){
    const sheet=workbook.Sheets[name];
    const grid=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:null});
    const hint=sheetNameHint(name);
    const tbHeader=findTbHeader(grid);
    let result;

    if(tbHeader||hint==='TB'){
      result=parseTbSheet(sheet,name,context.companyCode);
    }else{
      const hintedCc=hint!==undefined;
      const optionalHint=hint==='CC_PROD'||hint==='CC_DERIV'?hint:undefined;
      const authoritativeCcGrid=readCcAuthoritativeGrid(sheet);
      if(!looksLikeCc(authoritativeCcGrid)&&!hintedCc)continue;
      if(optionalHint)malformedOptionalCandidates.add(optionalHint);
      result=parseCcSheet(sheet,name,context.companyCode);
    }

    sources.push(result.source);
    rows.push(...result.rows);
    issues.push(...result.issues);
  }

  for(const code of REQUIRED){
    const matches=sources.filter(s=>s.logicalSourceCode===code);
    if(!matches.length)issues.push({issueCode:'RAW_SOURCE_REQUIRED_MISSING',severity:'ERROR',message:`Required source ${code} is missing.`,logicalSourceCode:code});
    if(matches.length>1)issues.push({issueCode:'RAW_SOURCE_AMBIGUOUS',severity:'ERROR',message:`More than one worksheet resolves to ${code}.`,logicalSourceCode:code});
  }

  for(const code of OPTIONAL){
    const matches=sources.filter(s=>s.logicalSourceCode===code);
    if(matches.length>1)issues.push({issueCode:'RAW_SOURCE_AMBIGUOUS',severity:'ERROR',message:`More than one worksheet resolves to ${code}.`,logicalSourceCode:code});
    if(!matches.length&&!malformedOptionalCandidates.has(code)){
      sources.push({logicalSourceCode:code,presenceStatus:'ABSENT_TREATED_AS_ZERO',companyCode:context.companyCode,detailRowCount:0,nonZeroDetailRowCount:0,detailTotal:'0.00'});
      issues.push({issueCode:'RAW_OPTIONAL_SOURCE_ABSENT_ZERO',severity:'INFO',message:`Optional source ${code} is absent and treated as zero.`,logicalSourceCode:code});
    }
  }

  const present=sources.filter(s=>s.presenceStatus==='PRESENT'&&s.fiscalYear&&s.fiscalPeriod);
  for(const source of present)if(source.fiscalYear!==context.fiscalYear||source.fiscalPeriod!==context.fiscalPeriod)issues.push({issueCode:'RAW_CROSS_SOURCE_PERIOD_MISMATCH',severity:'ERROR',message:`${source.logicalSourceCode} period ${source.fiscalYear}/${source.fiscalPeriod} does not match selected ${context.fiscalYear}/${context.fiscalPeriod}.`,logicalSourceCode:source.logicalSourceCode,originalSheetName:source.originalSheetName});
  const periods=new Set(present.map(s=>`${s.fiscalYear}/${s.fiscalPeriod}`));
  if(periods.size>1&&!issues.some(i=>i.issueCode==='RAW_CROSS_SOURCE_PERIOD_MISMATCH'))issues.push({issueCode:'RAW_CROSS_SOURCE_PERIOD_MISMATCH',severity:'ERROR',message:'Detected source periods do not agree.'});
  const tb=sources.find(s=>s.logicalSourceCode==='TB');
  return {detectedPeriod:tb?.fiscalYear&&tb.fiscalPeriod?{fiscalYear:tb.fiscalYear,fiscalPeriod:tb.fiscalPeriod}:undefined,sources,rows,issues};
}

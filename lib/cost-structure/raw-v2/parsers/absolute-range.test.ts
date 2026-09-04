import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseRawV2Workbook } from '.';

function tb(){
  return XLSX.utils.aoa_to_sheet([
    [null,null,null,'FY 2026 1 - 8','FY 2026 1 - 7','Variance'],
    ['Currency','Currency Type','FS Item/Account','1 IDR','1 IDR','1 IDR'],
    ['IDR','Company currency','Account /11111111',100,90,10],
  ]);
}

function ccStartingAtB(group:string){
  const sheet=XLSX.utils.aoa_to_sheet([
    [null,'Cost Centers: Actual/Plan/Variance'],
    [null,'Fiscal Year 2026'],
    [null,'From Period 8'],
    [null,'To Period 8'],
    [null,`Cost Center Group ${group} Synthetic`],
    [null,'Controlling Area SGG Controlling Area SGG'],
    [null,'Cost Elements','Act. Costs','Plan Costs','Var.(Abs.)','Var.(%)','Cost Elements','Actual Qty','Plan Qty','Var.(Abs.)','Var.(%)'],
    [null,'11111111 Rent',100,0,100,0,'11111111 Rent',0,0,0,0],
    [null,'22222222 Zero',0,0,0,0,'22222222 Zero',0,0,0,0],
    [null,'* Debit',100,0],
    [null,'** Over/Underabsorption',100,0],
  ]);
  sheet['!ref']='B1:K11';
  return sheet;
}

function bytes(sheets:Record<string,XLSX.WorkSheet>){
  const book=XLSX.utils.book_new();
  for(const [name,sheet] of Object.entries(sheets))XLSX.utils.book_append_sheet(book,sheet,name);
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Uint8Array;
}

test('CC B:K remains absolute when worksheet used range begins at B',async()=>{
  const parsed=await parseRawV2Workbook(bytes({
    TB:tb(),
    'cc pasar':ccStartingAtB('SI2000_PSR'),
    'cc_adm':ccStartingAtB('SI2000_ADM'),
    'cc derivatif':ccStartingAtB('SI2000_DRV'),
  }),{companyCode:'2000',fiscalYear:2026,fiscalPeriod:8});

  assert.equal(parsed.issues.filter(issue=>issue.severity==='ERROR').length,0);
  for(const [code,group] of [['CC_PASAR','SI2000_PSR'],['CC_ADUM','SI2000_ADM'],['CC_DERIV','SI2000_DRV']] as const){
    const source=parsed.sources.find(item=>item.logicalSourceCode===code);
    assert.equal(source?.costCenterGroup,group);
    assert.equal(source?.fiscalPeriod,8);
    assert.equal(source?.detailRowCount,2);
    assert.equal(source?.detailTotal,'100.00');
    assert.equal(source?.debitControl,'100.00');
    assert.equal(source?.reconciliationDifference,'0.00');
  }
});

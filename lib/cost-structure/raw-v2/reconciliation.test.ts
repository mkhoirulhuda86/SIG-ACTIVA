import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { rawV2ActivationDecision, reconcileCompany2000, type RawReconciliationRow } from './reconciliation';
const D = (v:string|number) => new Prisma.Decimal(v);
const absent = { presenceStatus:'ABSENT_TREATED_AS_ZERO', detailRowCount:0, nonZeroDetailRowCount:0, detailTotal:D(0), debitControl:null, reconciliationDifference:D(0) };
const row = (logicalSourceCode:string, coaCodeRaw:string, amount:string|number):RawReconciliationRow => ({logicalSourceCode,coaCodeRaw,amount:D(amount)});

test('100% TB coverage and exact nominal equality pass while extra netting TB remains visible',()=>{
  const result=reconcileCompany2000([row('TB','10000001',7),row('TB','99999999',-7),row('CC_ADUM','10000001',5),row('CC_PASAR','10000001',2)],absent);
  assert.equal(result.status,'PASS'); assert.equal(result.foundInTbCount,1); assert.equal(result.tbRowCount,2); assert.equal(result.tbNonZeroCount,2); assert.equal(result.totalDifference.toString(),'0');
});
test('missing TB COA fails',()=>{const r=reconcileCompany2000([row('CC_ADUM','10000001',1)],absent);assert.equal(r.status,'FAIL');assert.equal(r.missingInTbCount,1);});
test('one Rupiah per-COA difference fails with CC minus TB sign',()=>{const r=reconcileCompany2000([row('TB','10000001',2),row('CC_ADUM','10000001',1)],absent);assert.equal(r.status,'FAIL');assert.equal(r.details[0].difference?.toString(),'-1');});
test('multiple rows and same COA in ADUM plus PASAR aggregate before comparison',()=>{const r=reconcileCompany2000([row('TB','10000001',10),row('CC_ADUM','10000001',2),row('CC_ADUM','10000001',3),row('CC_PASAR','10000001',5)],absent);assert.equal(r.status,'PASS');assert.equal(r.details[0].ccAmount.toString(),'10');});
test('DERIV is reported independently and never double-counted',()=>{const deriv={presenceStatus:'PRESENT',detailRowCount:1,nonZeroDetailRowCount:1,detailTotal:D(4),debitControl:D(4),reconciliationDifference:D(0)};const r=reconcileCompany2000([row('TB','10000001',10),row('CC_ADUM','10000001',6),row('CC_PASAR','10000001',4),row('CC_DERIV','10000001',4)],deriv);assert.equal(r.status,'PASS');assert.equal(r.totalBaseCc.toString(),'10');assert.equal(r.deriv.total.toString(),'4');});
test('full-net-zero TB does not mean missing TB',()=>{const r=reconcileCompany2000([row('TB','10000001',5),row('TB','10000002',-5),row('CC_ADUM','10000001',5),row('CC_PASAR','10000002',-5)],absent);assert.equal(r.status,'PASS');assert.equal(r.tbRowCount,2);});
test('failed run preserves active success; successful run is sole activation decision',()=>{assert.deepEqual(rawV2ActivationDecision('FAIL'),{runStatus:'FAILED',activateNew:false,deactivatePrevious:false,periodStatus:null});assert.deepEqual(rawV2ActivationDecision('PASS'),{runStatus:'SUCCESS',activateNew:true,deactivatePrevious:true,periodStatus:'CALCULATED'});});
test('authoritative arithmetic remains Prisma Decimal, not JS float',()=>{const r=reconcileCompany2000([row('TB','10000001','0.3'),row('CC_ADUM','10000001','0.1'),row('CC_PASAR','10000001','0.2')],absent);assert.equal(r.status,'PASS');assert.ok(Prisma.Decimal.isDecimal(r.totalBaseCc));});

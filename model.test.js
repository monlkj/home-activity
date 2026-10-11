import test from 'node:test';
import assert from 'node:assert/strict';
import {balance,transact} from './public/model.js';
const state=()=>({members:[{id:'one'},{id:'two'}],history:[]});
test('activity credits persist in ledger and stay isolated by member',()=>{const original=state();const next=transact(original,'one','정리',20);assert.equal(balance(next,'one'),20);assert.equal(balance(next,'two'),0);assert.equal(original.history.length,0);assert.ok(next.history[0].date);});
test('reward debits and exact-balance redemption work',()=>{let next=transact(state(),'one','활동',50);next=transact(next,'one','간식',-50);assert.equal(balance(next,'one'),0);assert.equal(next.history.length,2);});
test('insufficient funds, unknown members, and invalid points are rejected',()=>{assert.throws(()=>transact(state(),'one','교환',-1),/부족/);assert.throws(()=>transact(state(),'missing','활동',10),/구성원/);for(const points of [0,1.5,NaN,Infinity])assert.throws(()=>transact(state(),'one','활동',points));});

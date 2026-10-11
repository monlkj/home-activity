import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordRecord,verifyPassword,normalizeCode} from './public/auth.js';
test('password records are salted and accept only the correct password',async()=>{const a=await passwordRecord('test-password');const b=await passwordRecord('test-password');assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,b.hash);assert.equal(await verifyPassword('test-password',a),true);assert.equal(await verifyPassword('wrong',a),false);assert.equal(await verifyPassword('test-password',null),false);assert.ok(!JSON.stringify(a).includes('test-password'));});
test('short passwords are rejected and family codes normalize whitespace and case',async()=>{await assert.rejects(passwordRecord('123'),/4~80/);assert.equal(normalizeCode(' home42 '),'HOME42');});

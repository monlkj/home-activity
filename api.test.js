import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './api/family.js';
import { testDatabase } from './test-support/database.js';
import { balance } from './public/model.js';

test('server authenticates separate devices, shares family data, isolates families, and enforces roles',async()=>{
  const {db,sql}=await testDatabase();
  try{
    const handler=createHandler(async()=>sql);
    async function call(body,cookie='',origin='http://localhost'){
      let status,result;const headers={};
      const req={method:body?'POST':'GET',headers:{host:'localhost',origin,cookie},body,socket:{remoteAddress:'test-client'}};
      const res={setHeader:(k,v)=>headers[k]=v,writeHead:s=>{status=s;},end:value=>{result=JSON.parse(value);}};
      await handler(req,res);return {status,result,headers,cookie:headers['Set-Cookie']?.split(';')[0]??cookie};
    }
    const first=await call({action:'register',code:'FAMILY11',name:'엄마',password:'parent-password'});
    assert.equal(first.status,201);const parentCookie=first.cookie;const parentId=first.result.memberId;
    assert.match(first.headers['Set-Cookie'],/HttpOnly/);assert.match(first.headers['Set-Cookie'],/SameSite=Strict/);
    assert.equal(first.result.state.members[0].password,undefined);
    assert.equal((await call({action:'register',code:'FAMILY11',name:'부모',password:'password'})).status,409);
    const add=await call({action:'mutate',operation:'addMember',name:'민지',role:'child',emoji:'👧🏻',password:'child-password'},parentCookie);
    assert.equal(add.status,200);const childId=add.result.state.members[1].id;
    const lookup=await call({action:'lookup',code:' family11 '});assert.equal(lookup.result.members.length,2);assert.equal(lookup.result.state,undefined);assert.equal(lookup.result.members[0].password,undefined);
    assert.equal((await call({action:'login',code:'FAMILY11',memberId:childId,password:'wrong'})).status,401);
    const child=await call({action:'login',code:'FAMILY11',memberId:childId,password:'child-password'});assert.equal(child.status,200);const childCookie=child.cookie;
    assert.equal((await call({action:'mutate',operation:'addMember',name:'위조',role:'parent',password:'password'},childCookie)).status,400);
    assert.equal((await call({action:'mutate',operation:'setPassword',memberId:parentId,password:'password'},childCookie)).status,400);
    const requested=await call({action:'mutate',operation:'requestActivity',activityId:'a1',memberId:parentId,points:999999},childCookie);assert.equal(requested.status,200);assert.equal(balance(requested.result.state,childId),0);const requestId=requested.result.state.requests[0].id;
    assert.equal((await call({action:'mutate',operation:'reviewActivity',requestId,approve:true,actorId:parentId},childCookie)).status,400);
    const parentRead=await call(null,parentCookie);assert.equal(parentRead.result.state.requests.length,1);
    const [a,b]=await Promise.all([call({action:'mutate',operation:'reviewActivity',requestId,approve:true},parentCookie),call({action:'mutate',operation:'reviewActivity',requestId,approve:true},parentCookie)]);
    assert.deepEqual([a.status,b.status].sort(),[200,400]);
    const childRead=await call(null,childCookie);assert.equal(balance(childRead.result.state,childId),20);assert.equal(childRead.result.state.history.length,1);
    assert.equal((await call({action:'mutate',operation:'redeem',rewardId:'r1',points:0},childCookie)).status,400);
    const other=await call({action:'register',code:'FAMILY22',name:'다른 부모',password:'other-password'});assert.equal(other.status,201);assert.equal(other.result.state.members.length,1);
    assert.equal((await call({action:'mutate',operation:'reviewActivity',requestId,approve:true},other.cookie)).status,400);
    assert.equal((await call(null,'home_session=forged')).status,401);
    assert.equal((await call({action:'mutate',operation:'requestActivity',activityId:'a2'},childCookie,'https://evil.example')).status,403);
    const changed=await call({action:'mutate',operation:'setPassword',memberId:childId,password:'new-password'},parentCookie);assert.equal(changed.status,200);
    assert.equal((await call(null,childCookie)).status,401);
    assert.equal((await call({action:'login',code:'FAMILY11',memberId:childId,password:'child-password'})).status,401);
    assert.equal((await call({action:'login',code:'FAMILY11',memberId:childId,password:'new-password'})).status,200);
    await call({action:'logout'},parentCookie);assert.equal((await call(null,parentCookie)).status,401);
    const stored=await db.query('SELECT state FROM home_families');assert.ok(!JSON.stringify(stored.rows).includes('parent-password'));
    for(let i=0;i<11;i++)await call({action:'login',code:'FAMILY11',memberId:parentId,password:'wrong'});
    assert.equal((await call({action:'login',code:'FAMILY11',memberId:parentId,password:'wrong'})).status,429);
  }finally{await db.close();}
});

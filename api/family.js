import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { database } from '../lib/database.js';
import { defaultState } from '../lib/defaults.js';
import { passwordRecord, verifyPassword, normalizeCode } from '../lib/password.js';
import { applyMutation, publicState, text } from '../lib/service.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const COOKIE='home_session';
const duration=7*24*60*60;
function cookie(req){try{return decodeURIComponent((req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)??'');}catch{return '';}}
function cookieHeader(req,token,age){return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${age}${process.env.VERCEL||req.headers['x-forwarded-proto']==='https'?'; Secure':''}`;}
function fail(message,status=400){throw Object.assign(Error(message),{status});}
async function rateLimit(sql,key,max){
  const rows=await sql`INSERT INTO home_rate_limits (key,count,expires_at) VALUES (${key},1,now()+interval '15 minutes') ON CONFLICT (key) DO UPDATE SET count=CASE WHEN home_rate_limits.expires_at<=now() THEN 1 ELSE home_rate_limits.count+1 END, expires_at=CASE WHEN home_rate_limits.expires_at<=now() THEN now()+interval '15 minutes' ELSE home_rate_limits.expires_at END RETURNING count`;
  if(rows[0].count>max)fail('요청이 많습니다. 15분 후 다시 시도해 주세요.',429);
}
async function session(sql,req){
  const token=cookie(req);if(!/^[a-f0-9]{64}$/.test(token))fail('로그인이 필요합니다.',401);
  const rows=await sql`SELECT f.id,f.code,f.state,f.revision,s.member_id FROM home_sessions s JOIN home_families f ON f.id=s.family_id WHERE s.token_hash=${hash(token)} AND s.expires_at>now()`;
  if(!rows.length||!rows[0].state.members.some(m=>m.id===rows[0].member_id))fail('다시 로그인해 주세요.',401);
  return rows[0];
}
async function startSession(sql,req,res,familyId,memberId){
  const token=randomBytes(32).toString('hex');
  await sql`DELETE FROM home_sessions WHERE expires_at<now()`;
  await sql`INSERT INTO home_sessions (token_hash,family_id,member_id,expires_at) VALUES (${hash(token)},${familyId},${memberId},now()+interval '7 days')`;
  res.setHeader('Set-Cookie',cookieHeader(req,token,duration));
}
const response=family=>({state:publicState({...family.state,familyCode:family.code}),memberId:family.member_id});

export function createHandler(getDatabase=database){return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  const send=(status,data)=>res.status?res.status(status).json(data):(res.writeHead(status),res.end(JSON.stringify(data)));
  try{
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');fail('지원하지 않는 요청입니다.',405);}
    if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)fail('허용되지 않는 요청입니다.',403);
    const sql=await getDatabase();
    if(req.method==='GET')return send(200,response(await session(sql,req)));
    const input=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!input||typeof input!=='object')fail('요청 내용을 확인해 주세요.');
    const ip=req.headers['x-vercel-forwarded-for']??req.socket?.remoteAddress??'unknown';
    await rateLimit(sql,'ip:'+hash(String(ip)),200);
    if(input.action==='lookup'){
      const rows=await sql`SELECT state FROM home_families WHERE code=${normalizeCode(input.code)}`;
      if(!rows.length)fail('가족 코드를 찾을 수 없습니다.',404);
      return send(200,{members:rows[0].state.members.map(({id,name,emoji,role})=>({id,name,emoji,role}))});
    }
    if(input.action==='register'){
      await rateLimit(sql,'register:'+hash(String(ip)),5);
      const code=normalizeCode(input.code);if(!/^[A-Z0-9]{6,20}$/.test(code))fail('가족 코드는 영문·숫자 6~20자로 입력해 주세요.');
      const name=text(input.name,'이름'),password=await passwordRecord(input.password);
      const member={id:randomUUID(),name,emoji:'👩🏻',role:'parent',password};
      const state={...defaultState(),members:[member]},id=randomUUID();
      try{await sql`INSERT INTO home_families (id,code,state) VALUES (${id},${code},${JSON.stringify(state)}::jsonb)`;}catch(error){if(error.code==='23505')fail('이미 사용 중인 가족 코드입니다. 다른 코드를 정해 주세요.',409);throw error;}
      await startSession(sql,req,res,id,member.id);
      return send(201,response({code,state,member_id:member.id}));
    }
    if(input.action==='login'){
      const code=normalizeCode(input.code);
      await rateLimit(sql,'login:'+hash(code+':'+String(input.memberId)),10);
      const rows=await sql`SELECT id,code,state FROM home_families WHERE code=${code}`;
      const family=rows[0],member=family?.state.members.find(m=>m.id===input.memberId);
      if(!member||!await verifyPassword(input.password,member.password))fail('프로필 또는 비밀번호가 일치하지 않아요.',401);
      await sql`DELETE FROM home_rate_limits WHERE key=${'login:'+hash(code+':'+String(input.memberId))}`;
      await startSession(sql,req,res,family.id,member.id);
      return send(200,response({...family,member_id:member.id}));
    }
    if(input.action==='logout'){
      const token=cookie(req);if(token)await sql`DELETE FROM home_sessions WHERE token_hash=${hash(token)}`;
      res.setHeader('Set-Cookie',cookieHeader(req,'',0));return send(200,{ok:true});
    }
    if(input.action==='mutate'){
      for(let attempt=0;attempt<5;attempt++){
        const family=await session(sql,req);
        let next;
        try{next=await applyMutation(family.state,family.member_id,input);}catch(error){error.status=400;throw error;}
        if(input.operation==='setPassword'){
          const changed=await sql`WITH changed AS (UPDATE home_families SET state=${JSON.stringify(next)}::jsonb,revision=revision+1 WHERE id=${family.id} AND revision=${family.revision} RETURNING id), revoked AS (DELETE FROM home_sessions WHERE family_id IN (SELECT id FROM changed) AND member_id=${input.memberId} RETURNING token_hash) SELECT id FROM changed`;
          if(!changed.length)continue;
          if(input.memberId===family.member_id){res.setHeader('Set-Cookie',cookieHeader(req,'',0));return send(200,{signedOut:true});}
          return send(200,response({...family,state:next}));
        }
        const rows=await sql`UPDATE home_families SET state=${JSON.stringify(next)}::jsonb,revision=revision+1 WHERE id=${family.id} AND revision=${family.revision} RETURNING revision`;
        if(rows.length)return send(200,response({...family,state:next}));
      }
      fail('다른 가족의 변경과 겹쳤습니다. 다시 시도해 주세요.',409);
    }
    fail('지원하지 않는 요청입니다.');
  }catch(error){
    const status=error.status??(error instanceof SyntaxError?400:500);
    if(status===500)console.error('Family API error',error.code??error.name);
    return send(status,{error:status===500?'서버 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.':error.message});
  }
};}
export default createHandler();

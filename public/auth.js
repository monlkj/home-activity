const encode = value => Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');
async function derive(password,salt,iterations) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return encode(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations},key,256)));
}
export async function passwordRecord(password) {
  if(typeof password!=='string'||password.length<4||password.length>80) throw Error('비밀번호는 4~80자로 입력해 주세요.');
  const salt=encode(crypto.getRandomValues(new Uint8Array(16))),iterations=210000;
  return {salt,iterations,hash:await derive(password,salt,iterations)};
}
export async function verifyPassword(password,record) {
  if(!record?.salt||!record?.hash||record.iterations!==210000)return false;
  return await derive(password,record.salt,record.iterations)===record.hash;
}
export function normalizeCode(value){return String(value).trim().toUpperCase();}

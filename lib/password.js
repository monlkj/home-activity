import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive=promisify(pbkdf2);
export async function passwordRecord(password) {
  if(typeof password!=='string'||password.length<4||password.length>80)throw Error('비밀번호는 4~80자로 입력해 주세요.');
  const salt=randomBytes(16).toString('hex'),iterations=210000;
  return {salt,iterations,hash:(await derive(password,salt,iterations,32,'sha256')).toString('hex')};
}
export async function verifyPassword(password,record){
  if(typeof password!=='string'||password.length>80||!record?.salt||record.iterations!==210000||!record.hash)return false;
  const result=await derive(password,record.salt,record.iterations,32,'sha256');
  const expected=Buffer.from(record.hash,'hex');
  return expected.length===result.length&&timingSafeEqual(expected,result);
}
export const normalizeCode=value=>String(value??'').trim().toUpperCase();

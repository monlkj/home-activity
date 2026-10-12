export function normalizeIdentity(value) {
  const identity = String(value ?? '').trim().toLowerCase();
  const legacy = /^[a-z0-9_]{4,30}$/.test(identity);
  const email = identity.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(identity);
  const local = identity.split('@')[0];
  if (!legacy && (!email || local.startsWith('.') || local.endsWith('.') || local.includes('..'))) {
    throw Object.assign(Error('올바른 이메일 주소를 입력해 주세요. 기존 계정 ID도 사용할 수 있습니다.'), {status: 400});
  }
  return identity;
}

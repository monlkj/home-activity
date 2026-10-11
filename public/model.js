export function balance(state, memberId) { return state.history.filter(h=>h.memberId===memberId).reduce((sum,h)=>sum+h.points,0); }
export function transact(state, memberId, title, points) {
  if (!state.members.some(m=>m.id===memberId)) throw new Error('가족 구성원을 선택해 주세요.');
  if (!Number.isSafeInteger(points) || points===0) throw new Error('포인트는 1 이상의 정수로 입력해 주세요.');
  if (points<0 && balance(state,memberId)+points<0) throw new Error('포인트가 부족해요. 활동을 완료해 포인트를 모아 보세요.');
  return {...state,history:[{id:crypto.randomUUID(),memberId,title,points,date:new Date().toISOString()},...state.history]};
}

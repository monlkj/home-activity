export function balance(state, memberId) { return state.history.filter(h=>h.memberId===memberId).reduce((sum,h)=>sum+h.points,0); }
export function transact(state, memberId, title, points) {
  const member = state.members.find(m=>m.id===memberId);
  if (!member) throw new Error('가족 구성원을 선택해 주세요.');
  if (member.role==='parent') throw new Error('부모님은 포인트를 적립하거나 사용하지 않습니다.');
  if (!Number.isSafeInteger(points) || points===0) throw new Error('포인트는 1 이상의 정수로 입력해 주세요.');
  if (points<0 && balance(state,memberId)+points<0) throw new Error('포인트가 부족해요. 활동을 완료해 포인트를 모아 보세요.');
  return {...state,history:[{id:crypto.randomUUID(),memberId,title,points,date:new Date().toISOString()},...state.history]};
}

export function requestActivity(state, memberId, activityId) {
  if (state.members.find(m=>m.id===memberId)?.role !== 'child') throw new Error('자녀를 선택해 주세요.');
  const activity=state.activities.find(a=>a.id===activityId);
  if (!activity) throw new Error('활동을 찾을 수 없습니다.');
  if (state.requests.some(r=>r.memberId===memberId && r.activityId===activityId && r.status==='pending')) throw new Error('이미 승인 대기 중인 활동입니다.');
  const request={id:crypto.randomUUID(),memberId,activityId,title:activity.title,points:activity.points,status:'pending',date:new Date().toISOString()};
  return {...state,requests:[request,...state.requests]};
}

export function reviewActivity(state, parentId, requestId, approve) {
  if (state.members.find(m=>m.id===parentId)?.role !== 'parent') throw new Error('부모님만 승인할 수 있습니다.');
  const request=state.requests.find(r=>r.id===requestId);
  if (!request || request.status!=='pending') throw new Error('이미 처리되었거나 존재하지 않는 요청입니다.');
  let next=approve?transact(state,request.memberId,request.title,request.points):state;
  if (approve) next={...next,history:next.history.map((h,i)=>i===0?{...h,approvedBy:parentId,requestId}:h)};
  return {...next,requests:state.requests.map(r=>r.id===requestId?{...r,status:approve?'approved':'rejected',reviewedBy:parentId,reviewedAt:new Date().toISOString()}:r)};
}

export function migrateState(state) {
  const demoIds=['dad','mom','child1','child2'];
  const unusedDemo=state.members.length===4 && state.members.every(m=>demoIds.includes(m.id)) && state.history.length===0 && !(state.requests?.length);
  return {...state,members:unusedDemo?[]:state.members.map(m=>({...m,role:['parent','child'].includes(m.role)?m.role:['dad','mom'].includes(m.id)?'parent':'child'})),requests:state.requests??[]};
}

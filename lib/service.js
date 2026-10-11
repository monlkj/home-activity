import { randomUUID } from 'node:crypto';
import { passwordRecord } from './password.js';
import { requestActivity, reviewActivity, transact } from '../public/model.js';

export function text(value,label,max=80){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error(`${label}을(를) 1~${max}자로 입력해 주세요.`);return value.trim();}
export function points(value){if(!Number.isSafeInteger(value)||value<1||value>100000)throw Error('포인트는 1~100,000 사이의 정수로 입력해 주세요.');return value;}
export function publicState(state){return {...state,members:state.members.map(({password,...member})=>member)};}

export async function applyMutation(state,actorId,input){
  const actor=state.members.find(m=>m.id===actorId);
  if(!actor)throw Error('로그인이 필요합니다.');
  const parentActions=['addMember','setPassword','addActivity','addReward','reviewActivity'];
  if(parentActions.includes(input.operation)&&actor.role!=='parent')throw Error('부모님만 사용할 수 있는 기능입니다.');
  switch(input.operation){
    case 'addMember':{
      if(state.members.length>=30)throw Error('가족은 최대 30명까지 등록할 수 있습니다.');
      if(!['parent','child'].includes(input.role))throw Error('가족 역할을 선택해 주세요.');
      const name=text(input.name,'이름');
      const emojis=['🧒🏻','👧🏻','👨🏻','👩🏻','👴🏻','👵🏻','🐱'];
      const member={id:randomUUID(),name,role:input.role,emoji:emojis.includes(input.emoji)?input.emoji:'🧒🏻',password:await passwordRecord(input.password)};
      return {...state,members:[...state.members,member]};
    }
    case 'setPassword':{
      if(!state.members.some(m=>m.id===input.memberId))throw Error('구성원을 찾을 수 없습니다.');
      const password=await passwordRecord(input.password);
      return {...state,members:state.members.map(m=>m.id===input.memberId?{...m,password}:m)};
    }
    case 'addActivity':case 'addReward':{
      const list=input.operation==='addActivity'?'activities':'rewards';
      if(state[list].length>=200)throw Error('항목은 최대 200개까지 등록할 수 있습니다.');
      const item={id:randomUUID(),title:text(input.title,'이름'),description:text(input.description,'설명'),points:points(input.points),emoji:list==='activities'?'✨':'🎁'};
      return {...state,[list]:[...state[list],item]};
    }
    case 'requestActivity':return requestActivity(state,actorId,input.activityId);
    case 'reviewActivity':{
      if(typeof input.approve!=='boolean')throw Error('승인 여부를 선택해 주세요.');
      return reviewActivity(state,actorId,input.requestId,input.approve);
    }
    case 'redeem':{
      const reward=state.rewards.find(r=>r.id===input.rewardId);
      if(!reward)throw Error('보상을 찾을 수 없습니다.');
      return transact(state,actorId,reward.title,-reward.points);
    }
    default:throw Error('지원하지 않는 요청입니다.');
  }
}

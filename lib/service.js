import { randomUUID } from "node:crypto";
import { requestActivity, reviewActivity, transact } from "../public/model.js";

export function text(value, label, max = 80) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw Object.assign(Error(`${label}을(를) 1~${max}자로 입력해 주세요.`), {
      status: 400,
    });
  return value.trim();
}
export function points(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000)
    throw Error("포인트는 1~100,000 사이의 정수로 입력해 주세요.");
  return value;
}
export function publicState(state) {
  return {
    ...state,
    members: state.members.map(({ password, ...member }) => member),
  };
}

export async function applyMutation(state, actorId, input) {
  const actor = state.members.find((m) => m.id === actorId);
  if (!actor) throw Error("로그인이 필요합니다.");
  const parentActions = ["addActivity", "addReward", "reviewActivity"];
  if (parentActions.includes(input.operation) && actor.role !== "parent")
    throw Error("부모님만 사용할 수 있는 기능입니다.");
  switch (input.operation) {
    case "addActivity":
    case "addReward": {
      const list = input.operation === "addActivity" ? "activities" : "rewards";
      if (state[list].length >= 200)
        throw Error("항목은 최대 200개까지 등록할 수 있습니다.");
      const item = {
        id: randomUUID(),
        title: text(input.title, "이름"),
        description: text(input.description, "설명"),
        points: points(input.points),
        emoji: list === "activities" ? "✨" : "🎁",
      };
      return { ...state, [list]: [...state[list], item] };
    }
    case "requestActivity":
      return requestActivity(state, actorId, input.activityId);
    case "reviewActivity": {
      if (typeof input.approve !== "boolean")
        throw Error("승인 여부를 선택해 주세요.");
      return reviewActivity(state, actorId, input.requestId, input.approve);
    }
    case "redeem": {
      const reward = state.rewards.find((r) => r.id === input.rewardId);
      if (!reward) throw Error("보상을 찾을 수 없습니다.");
      return transact(state, actorId, reward.title, -reward.points);
    }
    default:
      throw Error("지원하지 않는 요청입니다.");
  }
}

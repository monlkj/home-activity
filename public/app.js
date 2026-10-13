const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();
import { balance } from "./model.js";
let state = {
    members: [],
    activities: [],
    rewards: [],
    history: [],
    requests: [],
  },
  account = null,
  families = [],
  invitations = [],
  currentFamilyId = null,
  isOwner = false;
let selected = null,
  tab = "home",
  registering = false,
  connectionError = "",
  booting = true;
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const member = () => state.members.find((m) => m.id === selected);
async function api(input, familyId = currentFamilyId) {
  const response = await fetch(
    "/api/family" +
      (!input && familyId ? "?familyId=" + encodeURIComponent(familyId) : ""),
    {
      method: input ? "POST" : "GET",
      headers: input ? { "Content-Type": "application/json" } : {},
      credentials: "same-origin",
      body: input ? JSON.stringify(input) : undefined,
    },
  );
  const result = await response
    .json()
    .catch(() => ({ error: "서버에 연결할 수 없습니다." }));
  if (!response.ok) {
    if (response.status === 401 && account) {
      account = null;
      selected = null;
      currentFamilyId = null;
      state = {
        members: [],
        activities: [],
        rewards: [],
        history: [],
        requests: [],
      };
      render();
    }
    throw Error(result.error || "요청에 실패했습니다.");
  }
  return result;
}
function accept(result) {
  booting = false;
  account = result.account;
  families = result.families;
  invitations = result.invitations;
  currentFamilyId = result.familyId ?? null;
  isOwner = result.isOwner ?? false;
  state = result.state ?? {
    members: [],
    activities: [],
    rewards: [],
    history: [],
    requests: [],
  };
  selected = result.memberId ?? null;
  connectionError = "";
  render();
}
async function mutate(input) {
  accept(await api({ action: "mutate", familyId: currentFamilyId, ...input }));
  return true;
}
let timer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  clearTimeout(timer);
  timer = setTimeout(() => ($("#toast").style.display = "none"), 3500);
}
function members() {
  return `<div class="section-head"><h2>우리 가족 <small>자녀는 실천하고 부모님은 응원해요</small></h2>${isOwner ? '<button class="text-button" data-invite="true">계정 검색 · 가족 초대 ＋</button>' : ""}</div><div class="members">${state.members.map((m) => `<button class="member ${selected === m.id ? "selected" : ""}" data-account="${esc(m.id)}">${selected === m.id ? '<span class="selected-dot">●</span>' : ""}<div class="member-top"><span class="avatar">${esc(m.emoji)}</span><div><strong>${esc(m.name)}</strong><small>${m.role === "parent" ? "승인 담당" : "활동 참여 · 포인트 적립"}</small></div></div><div class="points">${m.role === "parent" ? "승인 담당" : balance(state, m.id).toLocaleString() + "<span>P</span>"}</div></button>`).join("") || '<div class="empty">아직 가족이 없어요. 가족 추가 버튼으로 부모님과 자녀를 등록해 주세요.</div>'}</div>`;
}
function activities() {
  return state.activities.length
    ? state.activities
        .map(
          (a) =>
            `<div class="activity"><span class="icon">${esc(a.emoji)}</span><div class="item-text"><strong>${esc(a.title)}</strong><p>${esc(a.description)}</p></div><span class="badge">+${a.points} P</span><button class="complete" data-complete="${esc(a.id)}" ${member()?.role !== "child" || state.requests.some((r) => r.memberId === selected && r.activityId === a.id && r.status === "pending") ? "disabled" : ""}>${state.requests.some((r) => r.memberId === selected && r.activityId === a.id && r.status === "pending") ? "승인 대기" : "완료 요청"}</button></div>`,
        )
        .join("")
    : '<div class="empty">활동을 추가해 첫 번째 약속을 만들어 보세요.</div>';
}
function rewards(limit) {
  return (
    state.rewards
      .slice(0, limit ?? state.rewards.length)
      .map(
        (r) =>
          `<article class="reward"><div class="reward-art">${esc(r.emoji)}</div><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p><div class="reward-bottom"><strong>${r.points} P</strong><button data-redeem="${esc(r.id)}" ${member()?.role !== "child" ? "disabled" : ""}>교환하기</button></div></article>`,
      )
      .join("") || '<p class="empty">가족이 좋아할 보상을 추가해 보세요.</p>'
  );
}
function history(limit) {
  const list = state.history
    .filter((h) => h.memberId === selected)
    .slice(0, limit ?? state.history.length);
  return list.length
    ? list
        .map(
          (h) =>
            `<div class="history-row"><span class="icon">${h.points > 0 ? "✓" : "🎁"}</span><div class="item-text"><strong>${esc(h.title)}</strong><small>${esc(member()?.name ?? "우리 가족")} · ${new Date(h.date).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div><span class="delta ${h.points < 0 ? "minus" : ""}">${h.points > 0 ? "+" : ""}${h.points} P</span></div>`,
        )
        .join("")
    : '<div class="empty">아직 내역이 없어요. 첫 활동을 완료해 보세요! 🌱</div>';
}
function requests() {
  const parent = member()?.role === "parent";
  const list = state.requests.filter((r) =>
    parent ? r.status === "pending" : r.memberId === selected,
  );
  return `<div class="section-head"><h2>${parent ? "활동 승인함" : "나의 활동 요청"} <small>${parent ? "활동을 확인하고 승인해 주세요" : "승인 후 포인트가 적립돼요"}</small></h2></div><div class="panel">${list.length ? list.map((r) => `<div class="activity"><span class="icon">${r.status === "pending" ? "⏳" : r.status === "approved" ? "✅" : "↩️"}</span><div class="item-text"><strong>${esc(r.title)}</strong><p>${esc(state.members.find((m) => m.id === r.memberId)?.name ?? "가족")} · ${r.points} P · ${{ pending: "승인 대기", approved: "승인 완료", rejected: "반려" }[r.status]}</p></div>${parent ? `<button class="complete" data-review="${esc(r.id)}" data-decision="reject">반려</button><button class="primary" data-review="${esc(r.id)}" data-decision="approve">승인</button>` : ""}</div>`).join("") : '<div class="empty">' + (parent ? "승인 대기 중인 활동이 없어요." : "활동을 완료하고 부모님께 승인을 요청해 보세요.") + "</div>"}</div>`;
}
const labels = {
  home: [
    "대시보드",
    "작은 실천, 큰 행복 🌿",
    "함께 실천하고, 포인트를 모으고, 즐거운 보상을 만나보세요.",
  ],
  activities: [
    "활동 목록",
    "오늘의 작은 실천 ☀️",
    "자녀가 완료를 요청하면 부모님의 승인 후 포인트가 적립돼요.",
  ],
  rewards: [
    "보상 상점",
    "노력 끝에 만나는 즐거움 🎁",
    "차곡차곡 모은 포인트로 우리 가족의 보상을 교환해요.",
  ],
  history: [
    "포인트 내역",
    "차곡차곡 쌓인 우리 이야기 🌱",
    "선택한 가족의 적립과 교환 내역을 확인해 보세요.",
  ],
};
function render() {
  if (!account) {
    document.body.classList.add("locked");
    if (booting) {
      $("#login-screen").innerHTML =
        '<div class="login-card"><div class="login-icon">🏡</div><h1>우리집 포인트</h1><p class="login-description">가족 공간에 연결하고 있어요…</p></div>';
      return;
    }
    loginScreen();
    return;
  }
  if (!member()) {
    document.body.classList.add("locked");
    lobbyScreen();
    return;
  }
  document.body.classList.remove("locked");
  $("#session-name").textContent =
    account.name +
    " · " +
    (member().role === "parent" ? "승인 담당" : "활동 참여");
  $("#add-member").hidden = !isOwner;
  $("#add-member").textContent = "＋ 계정 검색 · 가족 초대";
  const l = labels[tab];
  $("#page-label").textContent = l[0];
  $("#page-title").textContent = l[1];
  $("#page-subtitle").textContent = l[2];
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  let html = "";
  if (tab === "home")
    html += `<div class="hero"><div><small>우리 가족의 행복한 습관 만들기</small><h2>함께하면 더 즐거운 우리 집</h2><p>스스로 하는 작은 일에도 따뜻한 응원을.<br>오늘의 실천이 내일의 좋은 습관이 돼요.</p><span class="chip">🌱 오늘의 작은 실천을 시작해요</span></div><div class="hero-art" aria-hidden="true">🏡</div></div>`;
  html += members();
  html += `<div class="section-head"><span class="notice">${esc(state.familyName)} · @${esc(account.username)}</span>${isOwner ? '<button class="text-button" data-approvers="true">승인 담당자 지정</button>' : ""}</div>`;
  if (member().role === "parent" && !account.approvalConfigured)
    html +=
      '<div class="storage-warning">승인 비밀번호를 설정해야 활동을 승인할 수 있어요. <button class="text-button" data-settings="true">지금 설정하기 →</button></div>';
  html += requests();
  if (tab === "home")
    html += `<div class="columns"><section><div class="section-head"><h2>오늘의 활동 <small>${esc(member()?.name ?? "우리 가족")}의 도전을 응원해요</small></h2><button class="text-button" data-tab="activities">전체 보기 →</button></div><div class="panel">${activities()}</div></section><section><div class="section-head"><h2>기대되는 보상 🎁</h2><button class="text-button" data-tab="rewards">전체 보기 →</button></div><div class="rewards">${rewards(4)}</div></section></div><div class="section-head"><h2>최근 포인트 내역</h2><button class="text-button" data-tab="history">전체 보기 →</button></div><div class="panel">${history(4)}</div>`;
  if (tab === "activities")
    html += `<div class="section-head"><h2>${esc(member()?.name ?? "우리 가족")}의 활동</h2>${member().role === "parent" ? '<button class="primary" data-add="activity">＋ 활동 추가</button>' : ""}</div><p class="notice">자녀가 실제로 완료한 활동을 요청하면 부모님이 확인하고 승인해 주세요. 승인 전에는 포인트가 적립되지 않아요.</p><div class="panel">${activities()}</div>`;
  if (tab === "rewards")
    html += `<div class="section-head"><h2>${member().role === "parent" ? "보상 교환은 자녀 프로필로 로그인해 주세요" : esc(member().name) + "의 사용 가능 포인트 · " + balance(state, selected) + " P"}</h2>${member().role === "parent" ? '<button class="primary" data-add="reward">＋ 보상 추가</button>' : ""}</div><div class="full-grid">${rewards()}</div>`;
  if (tab === "history")
    html += `<div class="section-head"><h2>${esc(member()?.name ?? "우리 가족")}의 포인트 내역</h2><span class="notice">${member().role === "parent" ? "부모님은 포인트 적립 대상이 아닙니다" : "현재 " + balance(state, selected) + " P"}</span></div><div class="panel">${history()}</div>`;
  $("#content").innerHTML = html;
}
function modal(title, fields, onSubmit, button = "저장하기") {
  $("#dialog-title").textContent = title;
  $("#fields").innerHTML = fields;
  $("#form-error").textContent = "";
  $("#form button[type=submit]").textContent = button;
  $("#form button[type=submit]").className = "primary";
  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const submit = $("#form button[type=submit]");
    submit.disabled = true;
    try {
      if ((await onSubmit(new FormData(e.target))) !== false)
        $("#dialog").close();
    } catch (error) {
      $("#form-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  };
  $("#dialog").showModal();
}
const field = (name, label, type = "text", value = "") =>
  `<label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" required maxlength="${["username", "query"].includes(name) ? 254 : 80}" ${type === "number" ? 'min="1" max="100000" step="1"' : ""} value="${esc(value)}">`;
function add(kind) {
  if (member()?.role !== "parent") {
    toast("승인 담당자만 관리할 수 있어요.");
    return;
  }
  if (kind === "member") {
    inviteAccount();
    return;
  }
  modal(
    kind === "activity" ? "새 활동 만들기" : "새 보상 만들기",
    field("title", kind === "activity" ? "활동 이름" : "보상 이름") +
      field("description", "짧은 설명") +
      field("points", "포인트", "number", kind === "activity" ? "20" : "100") +
      approvalField(),
    async (data) => {
      const title = data.get("title").trim(),
        description = data.get("description").trim(),
        points = Number(data.get("points"));
      if (!title || !description) throw Error("이름과 설명을 입력해 주세요.");
      if (!Number.isSafeInteger(points) || points < 1 || points > 100000)
        throw Error("포인트는 1~100,000 사이의 정수로 입력해 주세요.");
      return mutate({
        operation: kind === "activity" ? "addActivity" : "addReward",
        title,
        description,
        points,
        approvalPassword: data.get("approvalPassword"),
      });
    },
  );
}
function approvalField() {
  return field(
    "approvalPassword",
    "승인 비밀번호 (로그인 비밀번호와 다릅니다)",
    "password",
  );
}
function approvalSettings() {
  modal(
    account.approvalConfigured ? "승인 비밀번호 변경" : "승인 비밀번호 설정",
    `<p class="notice">활동 승인과 가족방 관리에만 사용하는 비밀번호입니다. 로그인 비밀번호와 다르게 정하고, 승인하지 않는 가족에게 알려주지 마세요.</p>` +
      (account.approvalConfigured
        ? field("currentApprovalPassword", "기존 승인 비밀번호", "password")
        : "") +
      field("password", "새 승인 비밀번호 (4자 이상)", "password") +
      field("confirm", "새 승인 비밀번호 확인", "password"),
    async (data) => {
      if (data.get("password") !== data.get("confirm"))
        throw Error("새 승인 비밀번호 확인이 일치하지 않습니다.");
      accept(
        await api({
          action: "setApprovalPassword",
          familyId: currentFamilyId,
          password: data.get("password"),
          currentApprovalPassword: data.get("currentApprovalPassword"),
        }),
      );
      toast("승인 비밀번호를 저장했어요.");
      return true;
    },
  );
}
function createRoom() {
  modal(
    "새 가족방 만들기",
    field("name", "가족방 이름"),
    async (data) => {
      accept(await api({ action: "createRoom", name: data.get("name") }));
      return true;
    },
    "가족방 만들기",
  );
}
function inviteAccount() {
  if (!isOwner) {
    toast("가족방을 만든 사람만 초대할 수 있어요.");
    return;
  }
  modal(
    "계정 검색 후 가족 초대",
    field("query", "초대할 사람의 이메일 (기존 계정 ID도 가능)") +
      '<button type="button" id="search-accounts" class="complete">계정 검색</button><div id="account-results"></div><label for="can-approve">초대할 사람의 역할</label><select id="can-approve" name="canApprove"><option value="false">활동 참여 · 포인트 적립</option><option value="true">승인 담당 · 포인트 적립 없음</option></select>' +
      approvalField(),
    async (data) => {
      if (!data.get("accountId")) throw Error("검색한 계정을 선택해 주세요.");
      accept(
        await api({
          action: "invite",
          familyId: currentFamilyId,
          accountId: data.get("accountId"),
          canApprove: data.get("canApprove") === "true",
          approvalPassword: data.get("approvalPassword"),
        }),
      );
      toast("초대를 보냈어요. 상대방이 자신의 계정에서 수락하면 참여합니다.");
      return true;
    },
    "초대 보내기",
  );
  let searchVersion = 0;
  const query = $("#form [name=query]");
  query.oninput = () => {
    $("#account-results").innerHTML = "";
    searchVersion++;
  };
  $("#search-accounts").onclick = async () => {
    const version = ++searchVersion;
    try {
      const result = await api({
        action: "searchAccounts",
        query: query.value,
      });
      if (version !== searchVersion) return;
      $("#account-results").innerHTML = result.accounts.length
        ? result.accounts
            .map(
              (a) =>
                `<label class="search-result"><input type="radio" name="accountId" value="${esc(a.id)}" required checked> ${esc(a.name)} · @${esc(a.username)}</label>`,
            )
            .join("")
        : '<p class="notice">일치하는 계정이 없어요. 상대방이 먼저 회원가입했는지 확인해 주세요.</p>';
    } catch (error) {
      $("#form-error").textContent = error.message;
    }
  };
}
function approvers() {
  if (!isOwner) return;
  modal(
    "승인 담당자 지정",
    `<label for="target">가족방 구성원</label><select id="target" name="memberId">${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} · ${m.role === "parent" ? "승인 담당" : "활동 참여"}</option>`).join("")}</select><label for="role-choice">역할</label><select id="role-choice" name="canApprove"><option value="true">승인 담당 (포인트 적립 없음)</option><option value="false">활동 참여 (포인트 적립)</option></select>` +
      approvalField(),
    async (data) => {
      accept(
        await api({
          action: "setApprover",
          familyId: currentFamilyId,
          memberId: data.get("memberId"),
          canApprove: data.get("canApprove") === "true",
          approvalPassword: data.get("approvalPassword"),
        }),
      );
      return true;
    },
  );
}
function loginScreen() {
  const screen = $("#login-screen");
  screen.innerHTML = `<div class="login-card"><div class="login-icon">🏡</div><p class="eyebrow">HOME, SWEET HOME</p><h1>우리집 포인트</h1><p class="login-description">${registering ? "각자 계정을 만든 뒤 가족방 초대로 함께하세요." : "내 계정으로 로그인해 가족방에 들어오세요."}</p><form id="auth-form">${field("username", registering ? "이메일 주소" : "이메일 주소 (기존 계정 ID도 가능)", registering ? "email" : "text")}${registering ? field("name", "이름") : ""}${field("password", "로그인 비밀번호 (4자 이상)", "password")}${registering ? field("confirm", "로그인 비밀번호 확인", "password") + field("approvalPassword", "개인 승인 비밀번호 (4자 이상)", "password") + field("approvalConfirm", "개인 승인 비밀번호 확인", "password") : ""}<button class="primary" type="submit">${registering ? "회원가입" : "로그인"}</button></form><button class="text-button" id="toggle-auth">${registering ? "이미 계정이 있어요 · 로그인" : "처음이신가요? 개인 회원가입"}</button><button class="text-button danger-text" data-delete-account="true">계정 삭제</button><p id="login-error" role="alert">${esc(connectionError)}</p><p class="login-local">로그인 비밀번호와 승인 비밀번호는 따로 사용합니다.<br>개인 승인 비밀번호는 가입할 때 설정하고, 활동 승인 시 사용합니다.</p></div>`;
  $("#toggle-auth").onclick = () => {
    registering = !registering;
    connectionError = "";
    loginScreen();
  };
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      const data = new FormData(e.target);
      if (registering && data.get("password") !== data.get("confirm"))
        throw Error("로그인 비밀번호 확인이 일치하지 않습니다.");
      if (
        registering &&
        data.get("approvalPassword") !== data.get("approvalConfirm")
      )
        throw Error("개인 승인 비밀번호 확인이 일치하지 않습니다.");
      if (registering && data.get("password") === data.get("approvalPassword"))
        throw Error("승인 비밀번호는 로그인 비밀번호와 다르게 정해 주세요.");
      accept(
        await api({
          action: registering ? "registerAccount" : "loginAccount",
          username: data.get("username"),
          name: data.get("name"),
          password: data.get("password"),
          approvalPassword: data.get("approvalPassword"),
        }),
      );
    } catch (error) {
      $("#login-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
function lobbyScreen() {
  const screen = $("#login-screen");
  screen.innerHTML = `<div class="login-card lobby-card"><div class="login-icon">🏡</div><h1>${esc(account.name)}님의 가족 공간</h1><p class="login-description">@${esc(account.username)} · 내 계정으로 가족방에 참여해요.</p><div class="lobby-actions"><button class="text-button" data-settings="true">${account.approvalConfigured ? "승인 비밀번호 변경" : "승인 비밀번호 설정"}</button><div><button class="text-button" data-logout="true">로그아웃</button><button class="text-button danger-text" data-delete-account="true">계정 삭제</button></div></div><div class="section-head"><h2>내 가족방</h2><button class="primary" data-create-room="true">＋ 가족방 만들기</button></div><div class="room-list">${families.length ? families.map((f) => `<button class="room-button" data-room="${esc(f.id)}">🏡 ${esc(f.name)} <span>들어가기 →</span></button>`).join("") : '<p class="empty">아직 가족방이 없어요. 가족방을 만들거나 다른 가족의 초대를 기다려 주세요.</p>'}</div><div class="section-head"><h2>받은 초대</h2></div>${invitations.length ? invitations.map((i) => `<div class="invitation"><strong>${esc(i.room_name)}</strong><p>${esc(i.inviter_name)}님의 초대 · ${i.can_approve ? "승인 담당" : "활동 참여"}</p><button class="primary" data-respond="${esc(i.id)}" data-accept="true">수락</button><button class="text-button" data-respond="${esc(i.id)}" data-accept="false">거절</button></div>`).join("") : '<p class="notice">받은 초대가 없어요.</p>'}<button class="text-button" data-legacy="true">이전 가족 코드로 등록한 프로필 연결하기</button></div>`;
}
function legacyLink() {
  modal(
    "기존 가족 프로필 연결",
    field("code", "이전에 등록한 가족 코드") +
      '<button type="button" id="legacy-search" class="complete">프로필 찾기</button><div id="legacy-members"></div>' +
      field("password", "기존 프로필 로그인 비밀번호", "password"),
    async (data) => {
      if (!data.get("memberId")) throw Error("기존 프로필을 선택해 주세요.");
      accept(
        await api({
          action: "claimLegacy",
          code: data.get("code"),
          memberId: data.get("memberId"),
          password: data.get("password"),
        }),
      );
      return true;
    },
    "내 계정에 연결",
  );
  $("#legacy-search").onclick = async () => {
    try {
      const result = await api({
        action: "legacyProfiles",
        code: $("#form [name=code]").value,
      });
      $("#legacy-members").innerHTML =
        '<label for="legacy-member">기존 프로필 (부모를 먼저 연결하세요)</label><select id="legacy-member" name="memberId">' +
        result.members
          .map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`)
          .join("") +
        "</select>";
    } catch (error) {
      $("#form-error").textContent = error.message;
    }
  };
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) {
    tab = b.dataset.tab;
    render();
  }
  if (b.dataset.account) {
    toast("다른 계정으로 들어가려면 로그아웃 후 로그인해 주세요.");
  }
  if (b.dataset.add) add(b.dataset.add);
  if (b.dataset.settings) approvalSettings();
  if (b.dataset.invite) inviteAccount();
  if (b.dataset.approvers) approvers();
  if (b.dataset.createRoom) createRoom();
  if (b.dataset.legacy) legacyLink();
  if (b.dataset.logout) logout();
  if (b.dataset.deleteAccount) deleteAccountDialog();
  if (b.dataset.room) openRoom(b.dataset.room);
  if (b.dataset.respond) {
    b.disabled = true;
    api({
      action: "respondInvite",
      invitationId: b.dataset.respond,
      accept: b.dataset.accept === "true",
    })
      .then(accept)
      .catch((error) => {
        toast(error.message);
        b.disabled = false;
      });
  }
  if (b.dataset.review) {
    const id = b.dataset.review,
      approve = b.dataset.decision === "approve";
    const r = state.requests.find((r) => r.id === id);
    modal(
      approve ? "활동 승인" : "활동 반려",
      `<p class="confirm-copy">${esc(state.members.find((m) => m.id === r.memberId)?.name)}님의 <b>${esc(r.title)}</b> 활동을 ${approve ? "승인" : "반려"}할까요?<br>${approve ? r.points + " P가 자녀에게 적립됩니다." : "포인트는 적립되지 않습니다."}</p>` +
        approvalField(),
      async (data) => {
        const result = await mutate({
          operation: "reviewActivity",
          requestId: id,
          approve,
          approvalPassword: data.get("approvalPassword"),
        });
        if (result)
          toast(
            approve
              ? "활동을 승인하고 포인트를 적립했어요."
              : "활동 요청을 반려했어요.",
          );
        return result;
      },
      approve ? "승인하기" : "반려하기",
    );
  }
  if (b.dataset.complete) {
    const a = state.activities.find((a) => a.id === b.dataset.complete);
    modal(
      "활동 완료 요청",
      `<p class="confirm-copy"><b>${esc(member().name)}</b>님이 <b>${esc(a.title)}</b> 활동을 완료했나요?<br>부모님이 승인하면 ${a.points} P가 적립됩니다.</p>`,
      async () => {
        const result = await mutate({
          operation: "requestActivity",
          activityId: a.id,
        });
        if (result) toast("부모님에게 승인을 요청했어요.");
        return result;
      },
      "승인 요청하기",
    );
  }
  if (b.dataset.redeem) {
    const r = state.rewards.find((r) => r.id === b.dataset.redeem),
      id = selected;
    if (balance(state, id) < r.points) {
      toast("포인트가 부족해요. 활동을 완료해 포인트를 모아 보세요.");
      return;
    }
    modal(
      "보상 교환 확인",
      `<p class="confirm-copy"><b>${esc(member()?.name ?? "우리 가족")}</b>님의 <b>${esc(r.title)}</b> 보상을 교환할까요?<br>${r.points} P가 사용되며, ${balance(state, id) - r.points} P가 남아요.<br>실제 보상은 가족에게 요청해 주세요.</p>`,
      async () => {
        const result = await mutate({ operation: "redeem", rewardId: r.id });
        if (result) toast("보상을 교환했어요! 가족과 함께 즐겨요.");
        return result;
      },
      "보상 교환하기",
    );
  }
});
async function deleteAccountDialog() {
  let challenge;
  try {
    challenge = await api({ action: "deleteChallenge" });
  } catch (error) {
    toast(error.message);
    return;
  }
  const questions = () =>
    challenge.questions
      .map((question, i) =>
        field(
          i === 0 ? "answerOne" : "answerTwo",
          `수학 문제 ${i + 1}: ${question} = ?`,
          "number",
        ),
      )
      .join("");
  modal(
    "계정 영구 삭제",
    `<p class="notice">현재 로그인한 계정과 관계없이 아래 이메일의 계정을 삭제합니다. 계정 정보와 개인 포인트 내역은 복구할 수 없습니다. 다른 가족의 포인트는 유지됩니다.</p>` +
      field(
        "username",
        "삭제할 계정 이메일 (기존 계정 ID도 가능)",
        "text",
        account?.username ?? "",
      ) +
      field("password", "삭제할 계정 로그인 비밀번호", "password") +
      field("approvalPassword", "삭제할 계정 개인 승인 비밀번호", "password") +
      `<div id="delete-questions">${questions()}</div>` +
      field("confirmation", "확인 문구: 계정삭제"),
    async (data) => {
      try {
        const result = await api({
          action: "deleteAccount",
          username: data.get("username"),
          password: data.get("password"),
          approvalPassword: data.get("approvalPassword"),
          challenge: challenge.challenge,
          answerOne: Number(data.get("answerOne")),
          answerTwo: Number(data.get("answerTwo")),
          confirmation: data.get("confirmation"),
        });
        if (result.signedOut || !account) {
          account = null;
          selected = null;
          currentFamilyId = null;
          families = [];
          invitations = [];
          state = {
            members: [],
            activities: [],
            rewards: [],
            history: [],
            requests: [],
          };
          booting = false;
          registering = false;
          render();
        } else {
          try {
            accept(await api(undefined, null));
          } catch {
            account = null;
            selected = null;
            render();
          }
        }
        toast("입력한 이메일의 계정이 삭제되었습니다.");
        return true;
      } catch (error) {
        try {
          challenge = await api({ action: "deleteChallenge" });
          $("#delete-questions").innerHTML = questions();
        } catch {
          challenge = { challenge: "", questions: [] };
          $("#delete-questions").textContent =
            "삭제 확인을 다시 시작해 주세요.";
        }
        throw error;
      }
    },
    "계정 영구 삭제",
  );
  $("#form button[type=submit]").classList.add("danger");
}
async function logout() {
  try {
    await api({ action: "logout" });
    account = null;
    selected = null;
    currentFamilyId = null;
    families = [];
    invitations = [];
    state = {
      members: [],
      activities: [],
      rewards: [],
      history: [],
      requests: [],
    };
    tab = "home";
    $("#content").innerHTML = "";
    render();
  } catch (error) {
    toast(error.message);
  }
}
async function openRoom(id) {
  try {
    accept(await api(undefined, id));
    tab = "home";
    render();
  } catch (error) {
    toast(error.message);
  }
}
$("#logout").onclick = logout;
$("#delete-account").onclick = deleteAccountDialog;
$("#account-settings").onclick = approvalSettings;
$("#family-lobby").onclick = async () => {
  try {
    accept(await api(undefined, null));
  } catch (error) {
    toast(error.message);
  }
};
$("#add-member").onclick = inviteAccount;
$("#close-dialog").onclick = () => $("#dialog").close();
$("#today").textContent = new Date().toLocaleDateString("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});
render();

async function refresh() {
  if (document.hidden || $("#dialog").open) return;
  try {
    const result = await api();
    accept(result);
  } catch (error) {
    booting = false;
    if (!account) {
      connectionError =
        error.message === "로그인이 필요합니다." ||
        error.message === "다시 로그인해 주세요."
          ? ""
          : error.message;
      render();
    } else toast("서버 연결을 확인해 주세요. 최신 내역을 불러오지 못했어요.");
  }
}
refresh();
setInterval(() => {
  if (account) refresh();
}, 10000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && account) refresh();
});

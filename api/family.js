import { normalizeIdentity } from '../lib/identity.js';
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { database } from "../lib/database.js";
import { defaultState } from "../lib/defaults.js";
import {
  passwordRecord,
  verifyPassword,
  normalizeCode,
} from "../lib/password.js";
import { applyMutation, publicState, text } from "../lib/service.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const COOKIE = "home_account_session";
function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
function cookie(req) {
  return (
    (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1) ?? ""
  );
}
function cookieHeader(req, value, age) {
  return `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${age}${process.env.VERCEL || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;
}
async function rateLimit(sql, key, max) {
  const rows =
    await sql`INSERT INTO home_rate_limits (key,count,expires_at) VALUES (${key},1,now()+interval '15 minutes') ON CONFLICT (key) DO UPDATE SET count=CASE WHEN home_rate_limits.expires_at<=now() THEN 1 ELSE home_rate_limits.count+1 END, expires_at=CASE WHEN home_rate_limits.expires_at<=now() THEN now()+interval '15 minutes' ELSE home_rate_limits.expires_at END RETURNING count`;
  if (rows[0].count > max)
    fail("요청이 많습니다. 15분 후 다시 시도해 주세요.", 429);
}
async function session(sql, req) {
  const token = cookie(req);
  if (!/^[a-f0-9]{64}$/.test(token)) fail("로그인이 필요합니다.", 401);
  const rows =
    await sql`SELECT a.* FROM home_account_sessions s JOIN home_accounts a ON a.id=s.account_id WHERE s.token_hash=${hash(token)} AND s.expires_at>now()`;
  if (!rows.length) fail("다시 로그인해 주세요.", 401);
  return rows[0];
}
async function startSession(sql, req, res, id) {
  const token = randomBytes(32).toString("hex");
  await sql`DELETE FROM home_account_sessions WHERE expires_at<now()`;
  await sql`INSERT INTO home_account_sessions (token_hash,account_id,expires_at) VALUES (${hash(token)},${id},now()+interval '7 days')`;
  res.setHeader("Set-Cookie", cookieHeader(req, token, 604800));
}
const username = normalizeIdentity;
async function approval(sql, account, password) {
  await rateLimit(sql, "approval:" + account.id, 10);
  if (!account.approval_password)
    fail("내 계정에서 승인 비밀번호를 먼저 설정해 주세요.");
  if (!(await verifyPassword(password, account.approval_password)))
    fail("승인 비밀번호가 일치하지 않습니다.", 403);
  await sql`DELETE FROM home_rate_limits WHERE key=${"approval:" + account.id}`;
}
async function room(sql, account, id) {
  const rows =
    await sql`SELECT f.*,r.name AS room_name,r.owner_id FROM home_families f JOIN home_rooms r ON r.family_id=f.id WHERE f.id=${id}`;
  const family = rows[0];
  if (!family) fail("가족방을 찾을 수 없습니다.", 404);
  const member = family.state.members.find((m) => m.accountId === account.id);
  if (!member) fail("이 가족방의 구성원이 아닙니다.", 403);
  return { ...family, member };
}
async function overview(sql, account, familyId) {
  const families =
    await sql`SELECT f.id,r.name,r.owner_id FROM home_rooms r JOIN home_families f ON f.id=r.family_id WHERE f.state->'members' @> ${JSON.stringify([{ accountId: account.id }])}::jsonb ORDER BY r.name`;
  const invitations =
    await sql`SELECT i.id,i.can_approve,r.name AS room_name,a.name AS inviter_name FROM home_invitations i JOIN home_rooms r ON r.family_id=i.family_id JOIN home_accounts a ON a.id=i.inviter_id WHERE i.account_id=${account.id} AND i.status='pending' ORDER BY i.created_at`;
  const result = {
    account: {
      id: account.id,
      username: account.username,
      name: account.name,
      approvalConfigured: Boolean(account.approval_password),
    },
    families,
    invitations,
  };
  if (familyId) {
    const f = await room(sql, account, familyId);
    result.state = publicState({
      ...f.state,
      familyCode: f.code,
      familyName: f.room_name,
    });
    result.memberId = f.member.id;
    result.familyId = f.id;
    result.isOwner = f.owner_id === account.id;
  }
  return result;
}
async function writeState(sql, f, next) {
  return (
    (
      await sql`UPDATE home_families SET state=${JSON.stringify(next)}::jsonb,revision=revision+1 WHERE id=${f.id} AND revision=${f.revision} RETURNING id`
    ).length > 0
  );
}
export function createHandler(getDatabase = database) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const send = (status, data) =>
      res.status
        ? res.status(status).json(data)
        : (res.writeHead(status), res.end(JSON.stringify(data)));
    try {
      if (!["GET", "POST"].includes(req.method))
        fail("지원하지 않는 요청입니다.", 405);
      if (
        req.method === "POST" &&
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        fail("허용되지 않는 요청입니다.", 403);
      const sql = await getDatabase();
      if (req.method === "GET") {
        const account = await session(sql, req);
        const id = new URL(
          req.url ?? "/api/family",
          "http://localhost",
        ).searchParams.get("familyId");
        return send(200, await overview(sql, account, id));
      }
      const input =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!input || typeof input !== "object")
        fail("요청 내용을 확인해 주세요.");
      const ip = String(
        req.headers["x-vercel-forwarded-for"] ??
          req.socket?.remoteAddress ??
          "unknown",
      );
      await rateLimit(sql, "ip:" + hash(ip), 200);
      if (input.action === "registerAccount") {
        await rateLimit(sql, "register:" + hash(ip), 10);
        const id = randomUUID(),
          user = username(input.username),
          name = text(input.name, "이름"),
          password = await passwordRecord(input.password);
        try {
          await sql`INSERT INTO home_accounts(id,username,name,password) VALUES (${id},${user},${name},${JSON.stringify(password)}::jsonb)`;
        } catch (error) {
          if (error.code === "23505")
            fail("이미 사용 중인 이메일 또는 계정 ID입니다.", 409);
          throw error;
        }
        await startSession(sql, req, res, id);
        return send(201, await overview(sql, { id, username: user, name }));
      }
      if (input.action === "loginAccount") {
        const user = username(input.username);
        await rateLimit(sql, "login:" + hash(user), 10);
        const rows =
          await sql`SELECT * FROM home_accounts WHERE username=${user}`;
        const account = rows[0];
        if (
          !account ||
          !(await verifyPassword(input.password, account.password))
        )
          fail("이메일 또는 로그인 비밀번호가 일치하지 않습니다.", 401);
        await sql`DELETE FROM home_rate_limits WHERE key=${"login:" + hash(user)}`;
        await startSession(sql, req, res, account.id);
        return send(200, await overview(sql, account));
      }
      if (input.action === "logout") {
        const token = cookie(req);
        if (token)
          await sql`DELETE FROM home_account_sessions WHERE token_hash=${hash(token)}`;
        res.setHeader("Set-Cookie", cookieHeader(req, "", 0));
        return send(200, { ok: true });
      }
      const account = await session(sql, req);
      if (input.action === "setApprovalPassword") {
        if (account.approval_password)
          await approval(sql, account, input.currentApprovalPassword);
        if (await verifyPassword(input.password, account.password))
          fail("승인 비밀번호는 로그인 비밀번호와 다르게 정해 주세요.");
        const password = await passwordRecord(input.password);
        const rows =
          await sql`UPDATE home_accounts SET approval_password=${JSON.stringify(password)}::jsonb WHERE id=${account.id} AND approval_password IS NOT DISTINCT FROM ${account.approval_password ? JSON.stringify(account.approval_password) : null}::jsonb RETURNING id`;
        if (!rows.length)
          fail("비밀번호가 변경되었습니다. 다시 시도해 주세요.", 409);
        return send(
          200,
          await overview(
            sql,
            { ...account, approval_password: password },
            input.familyId,
          ),
        );
      }
      if (input.action === "createRoom") {
        const id = randomUUID(),
          code = randomBytes(8).toString("hex").toUpperCase(),
          name = text(input.name, "가족방 이름");
        const state = {
          ...defaultState(),
          members: [
            {
              id: randomUUID(),
              accountId: account.id,
              name: account.name,
              username: account.username,
              emoji: "👩🏻",
              role: "parent",
            },
          ],
        };
        await sql`WITH created AS (INSERT INTO home_families(id,code,state) VALUES (${id},${code},${JSON.stringify(state)}::jsonb) RETURNING id) INSERT INTO home_rooms(family_id,name,owner_id) SELECT id,${name},${account.id} FROM created`;
        return send(201, await overview(sql, account, id));
      }
      if (input.action === "searchAccounts") {
        await rateLimit(sql, "search:" + account.id, 40);
        const query = username(input.query);
        const rows =
          await sql`SELECT id,username,name FROM home_accounts WHERE username=${query} AND id<>${account.id} LIMIT 1`;
        return send(200, { accounts: rows });
      }
      if (input.action === "invite") {
        const f = await room(sql, account, input.familyId);
        if (f.owner_id !== account.id)
          fail("가족방을 만든 사람만 초대할 수 있습니다.", 403);
        await approval(sql, account, input.approvalPassword);
        if (typeof input.canApprove !== "boolean")
          fail("승인 담당 여부를 선택해 주세요.");
        const targets =
          await sql`SELECT id FROM home_accounts WHERE id=${input.accountId}`;
        if (!targets.length) fail("계정을 찾을 수 없습니다.", 404);
        if (f.state.members.some((m) => m.accountId === input.accountId))
          fail("이미 가족방 구성원입니다.");
        try {
          await sql`INSERT INTO home_invitations(id,family_id,account_id,inviter_id,can_approve) VALUES (${randomUUID()},${f.id},${input.accountId},${account.id},${input.canApprove})`;
        } catch (error) {
          if (error.code === "23505") fail("이미 초대 대기 중입니다.", 409);
          throw error;
        }
        return send(200, await overview(sql, account, f.id));
      }
      if (input.action === "respondInvite") {
        if (typeof input.accept !== "boolean")
          fail("초대 수락 여부를 선택해 주세요.");
        for (let attempt = 0; attempt < 5; attempt++) {
          const invitations =
            await sql`SELECT * FROM home_invitations WHERE id=${input.invitationId} AND account_id=${account.id} AND status='pending'`;
          const invitation = invitations[0];
          if (!invitation) fail("처리 가능한 초대가 없습니다.", 404);
          if (!input.accept) {
            await sql`UPDATE home_invitations SET status='declined' WHERE id=${invitation.id} AND account_id=${account.id} AND status='pending'`;
            return send(200, await overview(sql, account));
          }
          const rows =
            await sql`SELECT * FROM home_families WHERE id=${invitation.family_id}`;
          const f = rows[0];
          if (f.state.members.length >= 30)
            fail("가족방은 최대 30명까지 참여할 수 있습니다.");
          if (f.state.members.some((m) => m.accountId === account.id))
            fail("이미 가족방 구성원입니다.");
          const next = {
            ...f.state,
            members: [
              ...f.state.members,
              {
                id: randomUUID(),
                accountId: account.id,
                name: account.name,
                username: account.username,
                emoji: invitation.can_approve ? "👨🏻" : "🧒🏻",
                role: invitation.can_approve ? "parent" : "child",
              },
            ],
          };
          const changed =
            await sql`WITH joined AS (UPDATE home_families SET state=${JSON.stringify(next)}::jsonb,revision=revision+1 WHERE id=${f.id} AND revision=${f.revision} AND EXISTS(SELECT 1 FROM home_invitations WHERE id=${invitation.id} AND status='pending') RETURNING id), accepted AS (UPDATE home_invitations SET status='accepted' WHERE id=${invitation.id} AND status='pending' AND EXISTS(SELECT 1 FROM joined) RETURNING id) SELECT id FROM accepted`;
          if (changed.length)
            return send(200, await overview(sql, account, f.id));
        }
        fail("다른 변경과 겹쳤습니다. 다시 시도해 주세요.", 409);
      }
      if (input.action === "setApprover") {
        await approval(sql, account, input.approvalPassword);
        if (typeof input.canApprove !== "boolean")
          fail("승인 담당 여부를 선택해 주세요.");
        for (let attempt = 0; attempt < 5; attempt++) {
          const f = await room(sql, account, input.familyId);
          if (f.owner_id !== account.id)
            fail("가족방을 만든 사람만 승인 담당자를 지정할 수 있습니다.", 403);
          const target = f.state.members.find((m) => m.id === input.memberId);
          if (!target) fail("구성원을 찾을 수 없습니다.");
          if (
            !input.canApprove &&
            target.role === "parent" &&
            f.state.members.filter((m) => m.role === "parent").length === 1
          )
            fail("가족방에는 승인 담당자가 한 명 이상 있어야 합니다.");
          const next = {
            ...f.state,
            members: f.state.members.map((m) =>
              m.id === target.id
                ? { ...m, role: input.canApprove ? "parent" : "child" }
                : m,
            ),
          };
          if (await writeState(sql, f, next))
            return send(200, await overview(sql, account, f.id));
        }
        fail("다시 시도해 주세요.", 409);
      }
      if (input.action === "mutate") {
        if (["addMember", "setPassword"].includes(input.operation))
          fail("각자 회원가입 후 초대로 참여해 주세요.");
        for (let attempt = 0; attempt < 5; attempt++) {
          const f = await room(sql, account, input.familyId);
          if (f.member.role === "parent")
            await approval(sql, account, input.approvalPassword);
          let next;
          try {
            next = await applyMutation(f.state, f.member.id, input);
          } catch (error) {
            error.status = 400;
            throw error;
          }
          if (await writeState(sql, f, next))
            return send(200, await overview(sql, account, f.id));
        }
        fail("다른 변경과 겹쳤습니다. 다시 시도해 주세요.", 409);
      }
      if (input.action === "claimLegacy") {
        const code = normalizeCode(input.code);
        await rateLimit(sql, "legacy:" + account.id, 10);
        for (let attempt = 0; attempt < 5; attempt++) {
          const rows =
            await sql`SELECT * FROM home_families WHERE code=${code}`;
          const f = rows[0],
            m = f?.state.members.find((m) => m.id === input.memberId);
          if (!m || !(await verifyPassword(input.password, m.password)))
            fail("기존 가족 프로필의 비밀번호가 일치하지 않습니다.", 403);
          if (m.accountId && m.accountId !== account.id)
            fail("이미 다른 계정에 연결된 프로필입니다.");
          const rooms =
            await sql`SELECT * FROM home_rooms WHERE family_id=${f.id}`;
          if (!rooms.length && m.role !== "parent")
            fail("기존 부모 프로필을 먼저 연결해 주세요.");
          if (
            f.state.members.some(
              (member) => member.accountId === account.id && member.id !== m.id,
            )
          )
            fail("이 가족방에 이미 연결된 계정입니다.");
          const next = {
            ...f.state,
            members: f.state.members.map((member) =>
              member.id === m.id
                ? {
                    ...member,
                    accountId: account.id,
                    username: account.username,
                  }
                : member,
            ),
          };
          const changed =
            await sql`WITH claimed AS (UPDATE home_families SET state=${JSON.stringify(next)}::jsonb,revision=revision+1 WHERE id=${f.id} AND revision=${f.revision} RETURNING id), created AS (INSERT INTO home_rooms(family_id,name,owner_id) SELECT id,${"기존 가족방"},${account.id} FROM claimed ON CONFLICT DO NOTHING RETURNING family_id) SELECT id FROM claimed`;
          if (changed.length)
            return send(200, await overview(sql, account, f.id));
        }
        fail("다시 시도해 주세요.", 409);
      }
      if (input.action === "legacyProfiles") {
        const rows =
          await sql`SELECT state FROM home_families WHERE code=${normalizeCode(input.code)}`;
        if (!rows.length) fail("기존 가족 코드를 찾을 수 없습니다.", 404);
        return send(200, {
          members: rows[0].state.members
            .filter((m) => m.password && !m.accountId)
            .map(({ id, name, role }) => ({ id, name, role })),
        });
      }
      fail("지원하지 않는 요청입니다.");
    } catch (error) {
      const status = error.status ?? (error instanceof SyntaxError ? 400 : 500);
      if (status === 500)
        console.error("Family API error", error.code ?? error.name);
      return send(status, {
        error:
          status === 500
            ? "서버 처리에 실패했습니다. 잠시 후 다시 시도해 주세요."
            : error.message,
      });
    }
  };
}
export default createHandler();

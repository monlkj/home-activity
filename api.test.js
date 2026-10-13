import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHandler } from "./api/family.js";
import { testDatabase } from "./test-support/database.js";
import { balance } from "./public/model.js";
import { passwordRecord } from "./lib/password.js";
import { defaultState } from "./lib/defaults.js";

test("personal accounts, family invitations and separate approval passwords", async (t) => {
  const { db, sql } = await testDatabase();
  try {
    const handler = createHandler(async () => sql);
    async function call(
      body,
      cookie = "",
      familyId = null,
      origin = "http://localhost",
    ) {
      if (body?.action === "registerAccount" && !("approvalPassword" in body)) body = {...body, approvalPassword: "initial-approval"};
      let status, result;
      const headers = {};
      const req = {
        url: "/api/family" + (familyId ? "?familyId=" + familyId : ""),
        method: body ? "POST" : "GET",
        headers: { host: "localhost", origin, cookie },
        body,
        socket: { remoteAddress: "test-client" },
      };
      const res = {
        setHeader: (key, value) => (headers[key] = value),
        writeHead: (value) => {
          status = value;
        },
        end: (value) => {
          result = JSON.parse(value);
        },
      };
      await handler(req, res);
      return {
        status,
        result,
        headers,
        cookie: headers["Set-Cookie"]?.split(";")[0] ?? cookie,
      };
    }
    const mom = await call({
        action: "registerAccount",
        username: "mother",
        name: "엄마",
        password: "login-parent",
      }),
      child = await call({
        action: "registerAccount",
        username: "child1@example.com",
        name: "민지",
        password: "login-child",
      }),
      dad = await call({
        action: "registerAccount",
        username: "father",
        name: "아빠",
        password: "login-dad",
      });
    assert.equal(mom.status, 201);
    assert.equal(child.status, 201);
    assert.equal(dad.status, 201);
    const ownerCookie = mom.cookie,
      childCookie = child.cookie,
      dadCookie = dad.cookie;
    let familyId, childMemberId, requestId;
    await t.test(
      "signup precedes rooms and login never exposes password hashes",
      async () => {
        assert.equal(mom.result.families.length, 0);
        assert.equal(mom.result.account.approvalConfigured, true);
        assert.match(mom.headers["Set-Cookie"], /HttpOnly/);
        assert.equal(mom.result.account.password, undefined);
        assert.equal(
          (
            await call({
              action: "registerAccount",
              username: "MOTHER",
              name: "다른 이름",
              password: "login-password",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call({
              action: "loginAccount",
              username: "mother",
              password: "wrong",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await call({
              action: "loginAccount",
              username: "mother",
              password: "login-parent",
            })
          ).status,
          200,
        );
        assert.equal(
          (await call({ action: "searchAccounts", query: "mother" })).status,
          401,
        );
      },
    );
    await t.test("email registration, login and case-insensitive duplicate handling", async () => {
      const signup = await call({action: 'registerAccount', username: ' User@g.cnees.kr ', name: '이메일 사용자', password: 'email-password'});
      assert.equal(signup.status, 201);
      assert.equal(signup.result.account.username, 'user@g.cnees.kr');
      assert.equal((await call({action:'loginAccount', username:'USER@G.CNEES.KR', password:'email-password'})).status, 200);
      assert.equal((await call({action:'registerAccount', username:'user@g.cnees.kr', name:'중복', password:'password'})).status, 409);
      assert.equal((await call({action:'registerAccount', username:'user@@example.com', name:'오류', password:'password'})).status, 400);
    });
    await t.test("signup requires a distinct personal approval password", async () => {
      assert.equal((await call({action:'registerAccount',username:'missing@example.com',name:'가입',password:'password',approvalPassword:undefined})).status,400);
      assert.equal((await call({action:'registerAccount',username:'same@example.com',name:'가입',password:'password',approvalPassword:'password'})).status,400);
      const records=await db.query('SELECT approval_password FROM home_accounts WHERE username=$1',['mother']);
      assert.ok(records.rows[0].approval_password.hash);
      assert.ok(!JSON.stringify(mom.result).includes('initial-approval'));
    });
    await t.test(
      "approval password is separate and cannot be reset with login password",
      async () => {
        assert.equal(
          (
            await call(
              { action: "setApprovalPassword", password: "login-parent", currentApprovalPassword: "initial-approval" },
              ownerCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              { action: "setApprovalPassword", password: "approve-parent", currentApprovalPassword: "initial-approval" },
              ownerCookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              {
                action: "setApprovalPassword",
                password: "new-approval",
                currentApprovalPassword: "login-parent",
              },
              ownerCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              {
                action: "setApprovalPassword",
                password: "approve-new",
                currentApprovalPassword: "approve-parent",
              },
              ownerCookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              {
                action: "setApprovalPassword",
                password: "approve-parent",
                currentApprovalPassword: "approve-new",
              },
              ownerCookie,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "room owner searches accounts and invite requires approval password and recipient consent",
      async () => {
        const room = await call(
          { action: "createRoom", name: "우리 가족" },
          ownerCookie,
        );
        assert.equal(room.status, 201);
        familyId = room.result.familyId;
        assert.equal(room.result.isOwner, true);
        assert.equal((await call(null, childCookie, familyId)).status, 403);
        const search = await call(
          { action: "searchAccounts", query: " CHILD1@EXAMPLE.COM " },
          ownerCookie,
        );
        assert.equal(search.result.accounts[0].id, child.result.account.id);
        assert.equal(search.result.accounts[0].password, undefined);
        const input = {
          action: "invite",
          familyId,
          accountId: child.result.account.id,
          canApprove: false,
        };
        assert.equal(
          (
            await call(
              { ...input, approvalPassword: "login-parent" },
              ownerCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              { ...input, approvalPassword: "approve-parent" },
              ownerCookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              { ...input, approvalPassword: "approve-parent" },
              ownerCookie,
            )
          ).status,
          409,
        );
        const invitations = (await call(null, childCookie)).result.invitations;
        assert.equal(invitations.length, 1);
        assert.equal(
          (
            await call(
              {
                action: "respondInvite",
                invitationId: invitations[0].id,
                accept: true,
              },
              dadCookie,
            )
          ).status,
          404,
        );
        const joined = await call(
          {
            action: "respondInvite",
            invitationId: invitations[0].id,
            accept: true,
          },
          childCookie,
        );
        assert.equal(joined.status, 200);
        childMemberId = joined.result.memberId;
        assert.equal(
          joined.result.state.members.find((m) => m.id === childMemberId).role,
          "child",
        );
        assert.equal(
          (
            await call(
              {
                action: "respondInvite",
                invitationId: invitations[0].id,
                accept: true,
              },
              childCookie,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "shared parent login cannot approve without distinct approval password; concurrent approval credits once",
      async () => {
        const requested = await call(
          {
            action: "mutate",
            familyId,
            operation: "requestActivity",
            activityId: "a1",
            points: 999999,
          },
          childCookie,
        );
        assert.equal(requested.status, 200);
        requestId = requested.result.state.requests[0].id;
        assert.equal(balance(requested.result.state, childMemberId), 0);
        const input = {
          action: "mutate",
          familyId,
          operation: "reviewActivity",
          requestId,
          approve: true,
        };
        assert.equal(
          (
            await call(
              { ...input, approvalPassword: "approve-parent" },
              childCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              { ...input, approvalPassword: "login-parent" },
              ownerCookie,
            )
          ).status,
          403,
        );
        const [a, b] = await Promise.all([
          call({ ...input, approvalPassword: "approve-parent" }, ownerCookie),
          call({ ...input, approvalPassword: "approve-parent" }, ownerCookie),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 400]);
        const shared = await call(null, childCookie, familyId);
        assert.equal(balance(shared.result.state, childMemberId), 20);
        assert.equal(shared.result.state.history.length, 1);
        assert.ok(shared.result.state.members.every((m) => !m.password));
        assert.equal(
          (
            await call(
              {
                action: "mutate",
                familyId,
                operation: "setPassword",
                memberId: mom.result.memberId,
                password: "forged",
              },
              childCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              {
                action: "mutate",
                familyId,
                operation: "redeem",
                rewardId: "r1",
                points: 0,
              },
              childCookie,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "owner appoints approvers; appointees need their own approval password",
      async () => {
        await call(
          {
            action: "invite",
            familyId,
            accountId: dad.result.account.id,
            canApprove: true,
            approvalPassword: "approve-parent",
          },
          ownerCookie,
        );
        const invitation = (await call(null, dadCookie)).result.invitations[0];
        const joined = await call(
          {
            action: "respondInvite",
            invitationId: invitation.id,
            accept: true,
          },
          dadCookie,
        );
        assert.equal(joined.status, 200);
        const dadMemberId = joined.result.memberId;
        assert.equal(
          (
            await call(
              {
                action: "mutate",
                familyId,
                operation: "addActivity",
                title: "화분",
                description: "물주기",
                points: 10,
                approvalPassword: "login-dad",
              },
              dadCookie,
            )
          ).status,
          403,
        );
        await call(
          { action: "setApprovalPassword", password: "approve-dad", currentApprovalPassword: "initial-approval" },
          dadCookie,
        );
        assert.equal(
          (
            await call(
              {
                action: "mutate",
                familyId,
                operation: "addActivity",
                title: "화분",
                description: "물주기",
                points: 10,
                approvalPassword: "approve-dad",
              },
              dadCookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              {
                action: "setApprover",
                familyId,
                memberId: childMemberId,
                canApprove: true,
                approvalPassword: "approve-dad",
              },
              dadCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              {
                action: "setApprover",
                familyId,
                memberId: dadMemberId,
                canApprove: false,
                approvalPassword: "approve-parent",
              },
              ownerCookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              {
                action: "mutate",
                familyId,
                operation: "addActivity",
                title: "위조",
                description: "위조",
                points: 10,
                approvalPassword: "approve-dad",
              },
              dadCookie,
            )
          ).status,
          400,
        );
        const other = await call(
          { action: "createRoom", name: "다른 가족" },
          childCookie,
        );
        assert.equal(
          (await call(null, ownerCookie, other.result.familyId)).status,
          403,
        );
      },
    );
    await t.test(
      "existing families and ledger can be linked only after verifying old profile credentials",
      async () => {
        const id = randomUUID();
        const old = defaultState();
        old.members = [
          {
            id: "old-parent",
            role: "parent",
            name: "기존 부모",
            emoji: "👩🏻",
            password: await passwordRecord("legacy-parent"),
          },
          {
            id: "old-child",
            role: "child",
            name: "기존 자녀",
            emoji: "🧒🏻",
            password: await passwordRecord("legacy-child"),
          },
        ];
        old.history = [
          {
            id: randomUUID(),
            memberId: "old-child",
            points: 25,
            title: "기존 활동",
            date: new Date().toISOString(),
          },
        ];
        await sql`INSERT INTO home_families(id,code,state) VALUES (${id},${"LEGACY42"},${JSON.stringify(old)}::jsonb)`;
        assert.equal(
          (
            await call(
              {
                action: "claimLegacy",
                code: "LEGACY42",
                memberId: "old-child",
                password: "legacy-child",
              },
              childCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              {
                action: "claimLegacy",
                code: "LEGACY42",
                memberId: "old-parent",
                password: "wrong",
              },
              ownerCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              {
                action: "claimLegacy",
                code: "LEGACY42",
                memberId: "old-parent",
                password: "legacy-parent",
              },
              ownerCookie,
            )
          ).status,
          200,
        );
        const linked = await call(
          {
            action: "claimLegacy",
            code: "LEGACY42",
            memberId: "old-child",
            password: "legacy-child",
          },
          childCookie,
        );
        assert.equal(linked.status, 200);
        assert.equal(balance(linked.result.state, "old-child"), 25);
        assert.equal(
          (
            await call(
              {
                action: "claimLegacy",
                code: "LEGACY42",
                memberId: "old-parent",
                password: "legacy-parent",
              },
              dadCookie,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "forged sessions, cross-origin changes and brute force approval are rejected",
      async () => {
        assert.equal(
          (await call(null, "home_account_session=forged")).status,
          401,
        );
        assert.equal(
          (
            await call(
              { action: "createRoom", name: "공격" },
              ownerCookie,
              null,
              "https://evil.example",
            )
          ).status,
          403,
        );
        for (let i = 0; i < 11; i++)
          await call(
            {
              action: "setApprovalPassword",
              currentApprovalPassword: "wrong",
              password: "not-allowed",
            },
            ownerCookie,
          );
        assert.equal(
          (
            await call(
              {
                action: "setApprovalPassword",
                currentApprovalPassword: "wrong",
                password: "not-allowed",
              },
              ownerCookie,
            )
          ).status,
          429,
        );
        await call({ action: "logout" }, ownerCookie);
        assert.equal((await call(null, ownerCookie)).status, 401);
        const accounts = await db.query(
          "SELECT password,approval_password FROM home_accounts",
        );
        assert.ok(!JSON.stringify(accounts.rows).includes("approve-parent"));
        assert.ok(!JSON.stringify(accounts.rows).includes("login-parent"));
      },
    );
  } finally {
    await db.close();
  }
});

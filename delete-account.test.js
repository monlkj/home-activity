import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "./api/family.js";
import { testDatabase } from "./test-support/database.js";
import { balance } from "./public/model.js";

test("account deletion verifies all confirmations and preserves remaining families", async (t) => {
  const { db, sql } = await testDatabase();
  try {
    const handler = createHandler(async () => sql);
    async function call(body, cookie = "", familyId = null) {
      let status, result;
      const headers = {};
      await handler(
        {
          url: "/api/family" + (familyId ? "?familyId=" + familyId : ""),
          method: body ? "POST" : "GET",
          headers: { host: "localhost", cookie, origin: "http://localhost" },
          body,
          socket: { remoteAddress: "deletion-test" },
        },
        {
          setHeader: (key, value) => (headers[key] = value),
          writeHead: (value) => (status = value),
          end: (value) => (result = JSON.parse(value)),
        },
      );
      return {
        status,
        result,
        headers,
        cookie: headers["Set-Cookie"]?.split(";")[0] ?? cookie,
      };
    }
    async function signup(username) {
      const result = await call({
        action: "registerAccount",
        username,
        name: username,
        password: "login-password",
        approvalPassword: "approval-password",
      });
      assert.equal(result.status, 201);
      return result;
    }
    async function payload(username) {
      const result = await call({ action: "deleteChallenge" });
      assert.equal(result.status, 200);
      assert.equal(result.result.answerOne, undefined);
      const answer = (question) =>
        question.split(" + ").reduce((sum, n) => sum + Number(n), 0);
      return {
        action: "deleteAccount",
        username,
        password: "login-password",
        approvalPassword: "approval-password",
        confirmation: "계정삭제",
        challenge: result.result.challenge,
        answerOne: answer(result.result.questions[0]),
        answerTwo: answer(result.result.questions[1]),
      };
    }
    const actor = await signup("actor@example.com"),
      math = await signup("math@example.com"),
      credential = await signup("credential@example.com");
    await t.test(
      "both math answers, exact phrase, expiry and one-time challenge are server enforced",
      async () => {
        const wrong = await payload("math@example.com");
        assert.equal(
          (await call({ ...wrong, answerTwo: 999 }, math.cookie)).status,
          400,
        );
        assert.equal((await call(wrong, math.cookie)).status, 400);
        assert.equal(
          (
            await call(
              {
                ...(await payload("math@example.com")),
                confirmation: "계정 삭제",
              },
              math.cookie,
            )
          ).status,
          400,
        );
        const expired = await payload("math@example.com");
        await db.query(
          "UPDATE home_delete_challenges SET expires_at=now()-interval '1 minute'",
        );
        assert.equal((await call(expired, math.cookie)).status, 400);
        const deleted = await call(
          await payload("math@example.com"),
          math.cookie,
        );
        assert.equal(deleted.status, 200);
        assert.equal(deleted.result.signedOut, true);
        assert.match(deleted.headers["Set-Cookie"], /Max-Age=0/);
        assert.equal((await call(null, math.cookie)).status, 401);
        assert.equal((await signup("math@example.com")).status, 201);
      },
    );
    await t.test(
      "target credentials are checked regardless of which account is logged in",
      async () => {
        assert.equal(
          (
            await call(
              {
                ...(await payload("credential@example.com")),
                password: "wrong",
              },
              actor.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              {
                ...(await payload("credential@example.com")),
                approvalPassword: "wrong",
              },
              actor.cookie,
            )
          ).status,
          403,
        );
        const deleted = await call(
          await payload("credential@example.com"),
          actor.cookie,
        );
        assert.equal(deleted.status, 200);
        assert.equal(deleted.result.signedOut, false);
        assert.equal((await call(null, actor.cookie)).status, 200);
        assert.equal((await call(null, credential.cookie)).status, 401);
        assert.equal(
          (
            await call({
              action: "loginAccount",
              username: "credential@example.com",
              password: "login-password",
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "sole approver cannot abandon a family; owner transfers to an existing approver atomically",
      async () => {
        const parent = await signup("parent@example.com"),
          child = await signup("child@example.com"),
          successor = await signup("successor@example.com");
        const solo = await call(
          { action: "createRoom", name: "나 혼자" },
          parent.cookie,
        );
        const shared = await call(
          { action: "createRoom", name: "함께" },
          parent.cookie,
        );
        const familyId = shared.result.familyId;
        async function join(user, canApprove) {
          assert.equal(
            (
              await call(
                {
                  action: "invite",
                  familyId,
                  accountId: user.result.account.id,
                  canApprove,
                  approvalPassword: "approval-password",
                },
                parent.cookie,
              )
            ).status,
            200,
          );
          const invitations = (await call(null, user.cookie)).result
            .invitations;
          return call(
            {
              action: "respondInvite",
              invitationId: invitations[0].id,
              accept: true,
            },
            user.cookie,
          );
        }
        const joined = await join(child, false);
        const childId = joined.result.memberId;
        const blocked = await call(
          await payload("parent@example.com"),
          parent.cookie,
        );
        assert.equal(blocked.status, 409);
        assert.match(blocked.result.error, /다른 승인 담당자/);
        assert.equal((await call(null, parent.cookie)).status, 200);
        assert.equal(
          (
            await db.query("SELECT id FROM home_families WHERE id=$1", [
              solo.result.familyId,
            ])
          ).rows.length,
          1,
        );
        await join(successor, true);
        const requested = await call(
          {
            action: "mutate",
            familyId,
            operation: "requestActivity",
            activityId: "a1",
          },
          child.cookie,
        );
        const requestId = requested.result.state.requests[0].id;
        assert.equal(
          (
            await call(
              {
                action: "mutate",
                familyId,
                operation: "reviewActivity",
                requestId,
                approve: true,
                approvalPassword: "approval-password",
              },
              parent.cookie,
            )
          ).status,
          200,
        );
        const deleted = await call(
          await payload("parent@example.com"),
          actor.cookie,
        );
        assert.equal(deleted.status, 200);
        const preserved = await call(null, successor.cookie, familyId);
        assert.equal(preserved.status, 200);
        assert.equal(preserved.result.isOwner, true);
        assert.equal(balance(preserved.result.state, childId), 20);
        assert.equal(preserved.result.state.members.length, 2);
        assert.equal(preserved.result.state.history[0].approvedBy, undefined);
        assert.equal(
          (
            await db.query("SELECT id FROM home_families WHERE id=$1", [
              solo.result.familyId,
            ])
          ).rows.length,
          0,
        );
        assert.equal((await call(null, parent.cookie)).status, 401);
        assert.equal((await call(null, child.cookie, familyId)).status, 200);
        const childDeleted = await call(await payload("child@example.com"));
        assert.equal(childDeleted.status, 200);
        const remaining = await call(null, successor.cookie, familyId);
        assert.equal(remaining.result.state.history.length, 0);
        assert.equal(remaining.result.state.requests.length, 0);
        assert.equal(
          (
            await db.query(
              "SELECT id FROM home_invitations WHERE account_id=$1 OR inviter_id=$1",
              [parent.result.account.id],
            )
          ).rows.length,
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});

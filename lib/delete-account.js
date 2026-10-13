export async function initializeDeletion(sql) {
  await sql`CREATE TABLE IF NOT EXISTS home_delete_challenges (token_hash text PRIMARY KEY, answer_one integer NOT NULL, answer_two integer NOT NULL, expires_at timestamptz NOT NULL)`;
  await sql`CREATE OR REPLACE FUNCTION home_delete_account(target uuid, expected_login jsonb, expected_approval jsonb) RETURNS boolean LANGUAGE plpgsql AS $function$
  DECLARE current_account record; family record; remaining jsonb; member_ids text[]; next_state jsonb; successor uuid;
  BEGIN
    SELECT password,approval_password INTO current_account FROM home_accounts WHERE id=target FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF current_account.password IS DISTINCT FROM expected_login OR current_account.approval_password IS DISTINCT FROM expected_approval THEN
      RAISE EXCEPTION '비밀번호가 변경되었습니다. 정보를 다시 확인해 주세요.' USING ERRCODE='P0001';
    END IF;
    FOR family IN SELECT f.id,f.state,r.owner_id FROM home_families f LEFT JOIN home_rooms r ON r.family_id=f.id WHERE f.state->'members' @> jsonb_build_array(jsonb_build_object('accountId',target::text)) ORDER BY f.id FOR UPDATE OF f LOOP
      SELECT array_agg(m->>'id') INTO member_ids FROM jsonb_array_elements(family.state->'members') m WHERE m->>'accountId'=target::text;
      DELETE FROM home_sessions WHERE family_id=family.id AND member_id=ANY(member_ids);
      SELECT coalesce(jsonb_agg(m ORDER BY ordinal),'[]'::jsonb) INTO remaining FROM jsonb_array_elements(family.state->'members') WITH ORDINALITY AS members(m,ordinal) WHERE m->>'accountId' IS DISTINCT FROM target::text;
      IF jsonb_array_length(remaining)=0 THEN DELETE FROM home_families WHERE id=family.id; CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(remaining) m WHERE m->>'role'='parent') THEN
        RAISE EXCEPTION '가족방에 다른 승인 담당자를 지정한 뒤 계정을 삭제해 주세요.' USING ERRCODE='P0001';
      END IF;
      IF family.owner_id=target THEN
        SELECT a.id INTO successor FROM jsonb_array_elements(remaining) m JOIN home_accounts a ON a.id::text=m->>'accountId' WHERE m->>'role'='parent' ORDER BY a.created_at,a.id LIMIT 1 FOR KEY SHARE OF a;
        IF successor IS NULL THEN RAISE EXCEPTION '다른 승인 담당자의 개인 계정 연결을 마친 뒤 삭제해 주세요.' USING ERRCODE='P0001'; END IF;
        UPDATE home_rooms SET owner_id=successor WHERE family_id=family.id;
      END IF;
      next_state=jsonb_set(family.state,'{members}',remaining);
      next_state=jsonb_set(next_state,'{history}',(SELECT coalesce(jsonb_agg(CASE WHEN m->>'approvedBy'=ANY(member_ids) THEN m-'approvedBy' ELSE m END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(family.state->'history') WITH ORDINALITY AS items(m,ordinal) WHERE NOT (m->>'memberId'=ANY(member_ids))));
      next_state=jsonb_set(next_state,'{requests}',(SELECT coalesce(jsonb_agg(CASE WHEN m->>'reviewedBy'=ANY(member_ids) THEN m-'reviewedBy' ELSE m END ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(coalesce(family.state->'requests','[]'::jsonb)) WITH ORDINALITY AS items(m,ordinal) WHERE NOT (m->>'memberId'=ANY(member_ids))));
      UPDATE home_families SET state=next_state,revision=revision+1 WHERE id=family.id;
    END LOOP;
    DELETE FROM home_invitations WHERE account_id=target OR inviter_id=target;
    DELETE FROM home_accounts WHERE id=target;
    RETURN true;
  END;
  $function$`;
}

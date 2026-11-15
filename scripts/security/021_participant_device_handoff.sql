-- Apply after 020. Ordinary participants can enter using ID + assigned group
-- from another browser. Latest login owns the participant mapping; prior browser
-- loses participant access. MASTER and email/password accounts are not bypassed.
begin;

do $$
begin
  if to_regclass('public.duo_chat_session_archive') is null
    or to_regprocedure('public.get_duo_v2_member_room_admin(uuid,uuid,uuid,text)') is null
  then raise exception 'PREFLIGHT_REQUIRED: apply 018 through 020 before device handoff'; end if;
end $$;

create or replace function public.claim_study_participant_admin(
  p_auth_user_id uuid,p_group_id text,p_participant_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row public.study_participants%rowtype;
  v_previous_user uuid;
  v_member record;
  v_lease public.duo_v2_leases%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_auth_user_id is null or p_participant_id is null or p_group_id is null
    or p_participant_id !~ '^[A-Z0-9_-]{1,64}$' or p_group_id not in ('A','B') then
    return jsonb_build_object('status','invalid_input');
  end if;
  if p_participant_id in ('MASTER','USER1') then
    return jsonb_build_object('status','dedicated_sign_in_required');
  end if;
  -- Serialize identity handoffs, including switching IDs on the same browser.
  perform pg_advisory_xact_lock(42021);
  select * into v_row from public.study_participants where participant_id=p_participant_id for update;
  if not found then return jsonb_build_object('status','participant_not_registered'); end if;
  if v_row.status<>'active' then return jsonb_build_object('status','participant_inactive'); end if;
  if v_row.group_id<>p_group_id then return jsonb_build_object('status','group_mismatch'); end if;
  if not exists(select 1 from auth.users where id=p_auth_user_id and is_anonymous=true) then
    return jsonb_build_object('status','dedicated_sign_in_required');
  end if;
  if exists(select 1 from public.study_participants where auth_user_id=p_auth_user_id and participant_id<>p_participant_id) then
    return jsonb_build_object('status','auth_user_already_bound');
  end if;
  v_previous_user:=v_row.auth_user_id;
  if v_previous_user is not null and v_previous_user<>p_auth_user_id
    and not exists(select 1 from auth.users where id=v_previous_user and is_anonymous=true) then
    return jsonb_build_object('status','dedicated_sign_in_required');
  end if;

  -- Original browser binding restriction (disabled for ordinary anonymous users):
  -- if v_row.auth_user_id is not null and v_row.auth_user_id<>p_auth_user_id then
  --   return jsonb_build_object('status','participant_claimed');
  -- end if;
  update public.study_participants set auth_user_id=p_auth_user_id,
    claimed_at=case when v_previous_user is distinct from p_auth_user_id then now() else coalesce(claimed_at,now()) end,
    last_seen_at=now() where participant_id=p_participant_id;

  if v_previous_user is not null and v_previous_user<>p_auth_user_id then
    -- Keep active invitation hashes/session IDs intact. Rebind both host and visitor
    -- membership so the original link still recognizes this participant.
    for v_member in
      select m.* from public.duo_v2_session_members m
      join public.duo_v2_sessions s on s.id=m.session_id
      where m.auth_user_id=v_previous_user and s.status='active' and s.expires_at>now()
      order by s.id for update of s,m
    loop
      select * into v_lease from public.duo_v2_leases
        where session_id=v_member.session_id and auth_user_id=v_previous_user;
      -- The lease FK cascades only this old membership's lease. Historical logs,
      -- messages and gameplay rows are not deleted or reassigned.
      delete from public.duo_v2_session_members
        where session_id=v_member.session_id and auth_user_id=v_previous_user;
      update public.duo_v2_sessions set host_auth_user_id=p_auth_user_id,updated_at=now()
        where id=v_member.session_id and host_auth_user_id=v_previous_user;
      insert into public.duo_v2_session_members(session_id,auth_user_id,role,joined_at,left_at)
        values(v_member.session_id,p_auth_user_id,v_member.role,v_member.joined_at,v_member.left_at);
      if v_lease.client_id is not null then
        insert into public.duo_v2_leases(session_id,auth_user_id,client_id,state,screen,joined_at,heartbeat_at,released_at)
          values(v_member.session_id,p_auth_user_id,v_lease.client_id,'released','waiting',v_lease.joined_at,now(),now());
      end if;
    end loop;
  end if;
  return jsonb_build_object('status','ok','participant_id',v_row.participant_id,'group_id',v_row.group_id);
end $$;
revoke all on function public.claim_study_participant_admin(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_study_participant_admin(uuid,text,text) to service_role;
commit;

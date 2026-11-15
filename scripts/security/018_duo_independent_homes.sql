-- Forward migration after 017: independent own activity and bidirectional read-only visits.
-- No table/data move, no change to chat or invite/session expiry.
begin;

do $$
begin
  if to_regprocedure('public.can_read_duo_chat(uuid)') is null
    or to_regprocedure('public.get_duo_v2_session_status_admin(uuid,uuid,uuid)') is null
    or to_regclass('public.participant_economy_v1_rooms') is null
    or has_table_privilege('authenticated','public.currency_transactions','INSERT')
    or has_table_privilege('authenticated','public.participant_room','UPDATE')
  then raise exception 'PREFLIGHT_REQUIRED: verify existing Duo and own-write security boundaries'; end if;
end $$;

-- This trigger froze ALL legacy currency mutations for a Duo visitor, including
-- their own annotation/vote rewards. Existing authenticated own-write RPCs and
-- RLS remain authoritative; do not grant any additional table writes.
drop trigger duo_v2_visitor_legacy_currency_guard on public.currency_transactions;

create function public.get_duo_v2_member_room_admin(
  p_auth_user_id uuid,p_session_id uuid,p_client_id uuid,p_owner_role text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_status jsonb; v_owner_pid text; v_room_system text; v_room jsonb; v_revision bigint;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if p_owner_role is null or p_owner_role not in ('host','visitor') then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  select public.get_duo_v2_session_status_admin(p_auth_user_id,p_session_id,p_client_id) into v_status;
  if not coalesce((v_status->>'ok')::boolean,false) then return v_status; end if;
  -- Owner is resolved from this session, never a browser-supplied participant ID.
  -- Owner may be offline; caller must have a current active lease.
  select participant.participant_id,session.room_system into v_owner_pid,v_room_system
    from public.duo_v2_sessions session
    join public.duo_v2_session_members member on member.session_id=session.id
    join public.study_participants participant on participant.auth_user_id=member.auth_user_id
    where session.id=p_session_id and member.role=p_owner_role and participant.status='active';
  if v_owner_pid is null then return jsonb_build_object('ok',false,'reason','peer_unavailable'); end if;
  if v_room_system='economy_v1' then
    select room,revision into v_room,v_revision from public.participant_economy_v1_rooms where participant_id=v_owner_pid;
    v_room:=coalesce(v_room,jsonb_build_object('wallpaper','starter_wall_neutral','floor','starter_floor_beige','items','[]'::jsonb));
  else
    select room,1::bigint into v_room,v_revision from public.participant_room where participant_id=v_owner_pid;
    v_room:=coalesce(v_room,jsonb_build_object('wallpaper','wp_clover','floor','fl_brown','items','[]'::jsonb));
  end if;
  return jsonb_build_object('ok',true,'sessionId',p_session_id,'ownerRole',p_owner_role,
    'room',v_room,'revision',coalesce(v_revision,0));
end $$;
revoke all on function public.get_duo_v2_member_room_admin(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_duo_v2_member_room_admin(uuid,uuid,uuid,text) to service_role;
commit;

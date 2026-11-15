-- LOCAL DISPOSABLE DATABASE ONLY, postgres after 021; fixtures roll back.
begin;
do $$
declare
  host_user uuid:=gen_random_uuid(); old_user uuid:=gen_random_uuid(); new_user uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid(); new_client uuid:=gen_random_uuid(); v_session uuid:=gen_random_uuid(); result jsonb;
  prefix text:='DEVICE_'||substr(gen_random_uuid()::text,1,8); host_pid text; guest_pid text;
begin
  host_pid:=prefix||'_HOST'; guest_pid:=prefix||'_GUEST';
  insert into auth.users(id,is_anonymous) values(host_user,true),(old_user,true),(new_user,true);
  insert into public.study_participants(participant_id,auth_user_id,group_id)
    values(host_pid,host_user,'A'),(guest_pid,old_user,'B');
  insert into public.participant_currency(participant_id,balance) values(guest_pid,25);
  insert into public.duo_v2_sessions(id,host_auth_user_id,room_system,expires_at)
    values(v_session,host_user,'legacy',now()+interval '1 hour');
  insert into public.duo_v2_session_members(session_id,auth_user_id,role)
    values(v_session,host_user,'host'),(session,old_user,'visitor');
  insert into public.duo_v2_leases(session_id,auth_user_id,client_id,state,heartbeat_at)
    values(v_session,old_user,client,'active',now());
  insert into public.duo_v2_invites(token_hash,session_id,status,expires_at)
    values(repeat('a',64),v_session,'active',now()+interval '1 hour');
  insert into public.chat_messages(session_id,sender_auth_user_id,sender_role,client_message_id,body)
    values(v_session,old_user,'visitor',gen_random_uuid(),'old device history');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  result:=public.claim_study_participant_admin(new_user,'A',guest_pid);
  if (result->>'status') is distinct from 'group_mismatch' then raise exception 'wrong group accepted'; end if;
  result:=public.claim_study_participant_admin(new_user,'B',guest_pid);
  if (result->>'status') is distinct from 'ok' then raise exception 'handoff failed: %',result; end if;
  if (select auth_user_id from public.study_participants where participant_id=guest_pid) is distinct from new_user then raise exception 'identity not handed off'; end if;
  if exists(select 1 from public.study_participants where auth_user_id=old_user) then raise exception 'old browser retained account'; end if;
  if not exists(select 1 from public.duo_v2_session_members where session_id=v_session and auth_user_id=new_user and role='visitor') then raise exception 'duo membership lost'; end if;
  if (select state from public.duo_v2_leases where session_id=v_session and auth_user_id=new_user) is distinct from 'released' then raise exception 'old tab lease still active'; end if;
  result:=public.join_duo_v2_session_admin(new_user,new_client,repeat('a',64),gen_random_uuid(),repeat('b',64));
  if (result->>'ok') is distinct from 'true' then raise exception 'original invite cannot rejoin: %',result; end if;
  if (result->>'sessionId') is distinct from v_session::text then raise exception 'rejoin created another session'; end if;
  if (select balance from public.participant_currency where participant_id=guest_pid) is distinct from 25 then raise exception 'balance changed'; end if;
  if not exists(select 1 from public.duo_chat_message_history where session_id=v_session and sender_participant_id=guest_pid) then raise exception 'chat identity/history lost'; end if;
  result:=public.claim_study_participant_admin(new_user,'A',host_pid);
  if (result->>'status') is distinct from 'auth_user_already_bound' then raise exception 'one auth account claimed two IDs'; end if;
  result:=public.claim_study_participant_admin(new_user,'A','MASTER');
  if (result->>'status') is distinct from 'dedicated_sign_in_required' then raise exception 'MASTER bypass allowed'; end if;
end $$;
rollback;

-- LOCAL DISPOSABLE DATABASE ONLY, postgres after 020. Entire test rolls back.
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid();
  s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid();
  prefix text:='HISTORY_'||substr(gen_random_uuid()::text,1,8);
  pa text; pb text; n integer;
begin
  pa:=prefix||'_A'; pb:=prefix||'_B';
  insert into auth.users(id) values(a),(b),(replacement);
  insert into public.study_participants(participant_id,auth_user_id,group_id) values(pa,a,'A'),(pb,b,'B');
  if private.duo_v2_host_room_eligible(a,'legacy') is distinct from true
    or private.duo_v2_host_room_eligible(a,'economy_v1') is distinct from true then raise exception 'empty home cannot invite'; end if;
  if private.duo_v2_host_room_eligible(replacement,'legacy') is distinct from false
    or private.duo_v2_host_room_eligible(a,'unknown') is distinct from false then raise exception 'identity/mode gate lost'; end if;
  insert into public.duo_v2_sessions(id,host_auth_user_id,room_system,created_at,expires_at)
    values(s1,a,'legacy',now()-interval '2 hours',now()+interval '1 hour'),
          (s2,b,'legacy',now(),now()+interval '2 hours');
  insert into public.duo_v2_session_members(session_id,auth_user_id,role)
    values(s1,a,'host'),(s1,b,'visitor'),(s2,b,'host'),(s2,a,'visitor');
  insert into public.chat_messages(session_id,sender_auth_user_id,sender_role,client_message_id,body)
    values(s1,a,'host',gen_random_uuid(),'first session'),(s2,b,'host',gen_random_uuid(),'second session');
  select count(*) into n from public.duo_chat_session_history
    where session_id in (s1,s2) and pair_participant_1=least(pa,pb) and pair_participant_2=greatest(pa,pb);
  if n<>2 then raise exception 'same pair not grouped across reversed host roles'; end if;
  update public.duo_v2_sessions set expires_at=now()-interval '1 hour',status='expired',closed_at=now() where id=s1;
  perform public.delete_expired_duo_chat_messages();
  if (select count(*) from public.chat_messages where session_id=s1)<>1 then raise exception 'expiry deleted history'; end if;
  if exists(select 1 from cron.job where jobname='delete-expired-duo-chat-messages') then raise exception 'expiry job remains'; end if;
  update public.study_participants set auth_user_id=replacement where participant_id=pb;
  -- Later session updates must not replace already captured participant labels.
  update public.duo_v2_sessions set updated_at=now() where id=s2;
  if (select host_participant_id from public.duo_chat_session_archive where session_id=s2) is distinct from pb then raise exception 'auth rebind lost snapshot'; end if;
  delete from public.duo_v2_sessions where id=s1;
  delete from auth.users where id=b;
  if (select count(*) from public.duo_chat_message_history where session_id in (s1,s2))<>2 then raise exception 'session/auth delete lost history'; end if;
  if not exists(select 1 from public.duo_chat_message_history where session_id=s2 and sender_participant_id=pb) then raise exception 'sender label lost'; end if;
  if has_table_privilege('authenticated','public.duo_chat_session_archive','SELECT')
    or has_table_privilege('authenticated','public.duo_chat_session_history','SELECT')
    or has_table_privilege('anon','public.duo_chat_message_history','SELECT') then raise exception 'history exposed to players'; end if;
end $$;
rollback;

-- LOCAL DISPOSABLE SUPABASE ONLY. Run as postgres after 019; all fixtures roll back.
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
  expired uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid();
  result jsonb; first_id text; prefix text:='CHAT_QA_'||substr(gen_random_uuid()::text,1,8);
begin
  insert into auth.users(id) values(a),(b),(outsider);
  insert into public.study_participants(participant_id,auth_user_id,group_id)
    values(prefix||'_A',a,'A'),(prefix||'_B',b,'B'),(prefix||'_X',outsider,'A');
  insert into public.duo_v2_sessions(id,host_auth_user_id,room_system,expires_at)
    values(s,a,'legacy',now()+interval '1 hour');
  insert into public.duo_v2_sessions(id,host_auth_user_id,room_system,status,created_at,expires_at)
    values(expired,a,'legacy','expired',now()-interval '3 hours',now()-interval '1 hour');
  insert into public.duo_v2_session_members(session_id,auth_user_id,role)
    values(s,a,'host'),(s,b,'visitor');
  insert into public.duo_v2_leases(session_id,auth_user_id,client_id,state,heartbeat_at)
    values(s,a,c,'active',now()),(s,b,cb,'active',now());
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  result:=public.send_duo_chat_admin(a,s,c,mid,'hello');
  if result->>'ok'<>'true' then raise exception 'host send failed: %',result; end if;
  first_id:=result->'message'->>'id';
  result:=public.send_duo_chat_admin(a,s,c,mid,'hello');
  if result->'message'->>'id'<>first_id then raise exception 'retry duplicated message'; end if;
  result:=public.send_duo_chat_admin(a,s,c,mid,'changed');
  if result->>'reason'<>'idempotency_key_reused' then raise exception 'changed retry accepted'; end if;
  result:=public.send_duo_chat_admin(outsider,s,c,gen_random_uuid(),'forged');
  if result->>'ok'='true' then raise exception 'outsider send accepted'; end if;
  result:=public.read_duo_chat_admin(b,s,cb,0);
  if jsonb_array_length(result->'messages')<>1 then raise exception 'visitor cannot read'; end if;
  result:=public.read_duo_chat_admin(a,s,cb,0);
  if result->>'ok'='true' then raise exception 'wrong client accepted'; end if;
  if has_table_privilege('authenticated','public.chat_messages','INSERT')
    or has_table_privilege('authenticated','public.chat_messages','DELETE')
    or has_function_privilege('authenticated','public.send_duo_chat_admin(uuid,uuid,uuid,uuid,text)','EXECUTE')
    then raise exception 'browser write bypass'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b)::text,true);
  if not public.can_read_duo_chat(s) then raise exception 'member RLS denied'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',outsider)::text,true);
  if public.can_read_duo_chat(s) then raise exception 'outsider RLS accepted'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  insert into public.chat_messages(session_id,sender_auth_user_id,sender_role,client_message_id,body)
    values(expired,a,'host',gen_random_uuid(),'expired fixture');
  perform public.delete_expired_duo_chat_messages();
  if not exists(select 1 from public.chat_messages where session_id=expired)
    then raise exception 'expired chat history was deleted'; end if;
  if not exists(select 1 from public.chat_messages where session_id=s)
    or not exists(select 1 from public.duo_v2_sessions where id=expired)
    or not exists(select 1 from public.study_participants where auth_user_id=a)
    then raise exception 'cleanup changed unrelated data'; end if;
  update public.duo_v2_sessions set status='closed',closed_at=now() where id=s;
  result:=public.send_duo_chat_admin(a,s,c,gen_random_uuid(),'after close');
  if result->>'ok'='true' then raise exception 'closed session send accepted'; end if;
  insert into public.duo_v2_sessions(id,host_auth_user_id,room_system,expires_at)
    values(fresh,a,'legacy',now()+interval '1 hour');
  insert into public.duo_v2_session_members(session_id,auth_user_id,role) values(fresh,a,'host'),(fresh,b,'visitor');
  insert into public.duo_v2_leases(session_id,auth_user_id,client_id,state,heartbeat_at)
    values(fresh,a,c,'active',now()),(fresh,b,cb,'active',now());
  result:=public.read_duo_chat_admin(a,fresh,c,0);
  if result->>'ok'<>'true' or jsonb_array_length(result->'messages')<>0 then raise exception 'new session inherited old chat'; end if;
  perform public.delete_expired_duo_chat_messages();
  if not exists(select 1 from public.chat_messages where session_id=s)
    then raise exception 'non-expired closed session messages deleted early'; end if;
end $$;
rollback;

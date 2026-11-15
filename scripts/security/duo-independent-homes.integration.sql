-- LOCAL DISPOSABLE DATABASE ONLY, as postgres after 018. All fixtures roll back.
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); x uuid:=gen_random_uuid();
  ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
  prefix text:='DUOHOME_'||substr(gen_random_uuid()::text,1,8);
  pa text; pb text; result jsonb;
  room_a jsonb:='{"wallpaper":"wp_clover","floor":"fl_brown","items":[]}';
  room_b jsonb:='{"wallpaper":"wp_hearts","floor":"fl_brown","items":[]}';
begin
  pa:=prefix||'_A'; pb:=prefix||'_B';
  insert into auth.users(id) values(a),(b),(x);
  insert into public.study_participants(participant_id,auth_user_id,group_id)
    values(pa,a,'A'),(pb,b,'B'),(prefix||'_X',x,'A');
  insert into public.participant_room(participant_id,room) values(pa,room_a),(pb,room_b);
  insert into public.duo_v2_sessions(id,host_auth_user_id,room_system,expires_at)
    values(s,a,'legacy',now()+interval '1 hour');
  insert into public.duo_v2_session_members(session_id,auth_user_id,role) values(s,a,'host'),(s,b,'visitor');
  insert into public.duo_v2_leases(session_id,auth_user_id,client_id,state,heartbeat_at)
    values(s,a,ca,'active',now()),(s,b,cb,'active',now());
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  result:=public.get_duo_v2_member_room_admin(a,s,ca,'visitor');
  if (result->>'ok') is distinct from 'true' or (result->'room') is distinct from room_b then raise exception 'host cannot visit peer'; end if;
  result:=public.get_duo_v2_member_room_admin(b,s,cb,'host');
  if (result->>'ok') is distinct from 'true' or (result->'room') is distinct from room_a then raise exception 'visitor cannot visit host'; end if;
  result:=public.get_duo_v2_member_room_admin(x,s,ca,'host');
  if (result->>'ok') is not distinct from 'true' then raise exception 'outsider read succeeded'; end if;
  result:=public.get_duo_v2_member_room_admin(b,s,ca,'host');
  if (result->>'ok') is not distinct from 'true' then raise exception 'wrong client read succeeded'; end if;
  result:=public.get_duo_v2_member_room_admin(b,s,cb,'outsider');
  if (result->>'reason') is distinct from 'invalid_request' then raise exception 'unknown owner accepted'; end if;
  if has_function_privilege('authenticated','public.get_duo_v2_member_room_admin(uuid,uuid,uuid,text)','EXECUTE')
    or has_table_privilege('authenticated','public.participant_room','UPDATE')
    or has_table_privilege('authenticated','public.currency_transactions','INSERT') then raise exception 'browser write boundary widened'; end if;
  -- Regression for the exact ledger insertion blocked by the old visitor trigger.
  perform private.credit_currency_v3(pb,'earn_annotation',5,gen_random_uuid()::text,gen_random_uuid());
  if (select balance from public.participant_currency where participant_id=pb) is distinct from 5 then raise exception 'visitor own reward failed'; end if;
  if exists(select 1 from public.currency_transactions where participant_id=pa) then raise exception 'visitor reward credited host'; end if;
  -- Host can leave; the visitor can still read/stay in the saved host home.
  update public.duo_v2_leases set state='released' where session_id=s and auth_user_id=a;
  update public.duo_v2_session_members set left_at=now() where session_id=s and auth_user_id=a;
  result:=public.get_duo_v2_member_room_admin(b,s,cb,'host');
  if (result->>'ok') is distinct from 'true' then raise exception 'host leaving forced visitor out'; end if;
  update public.duo_v2_sessions set status='closed',closed_at=now() where id=s;
  result:=public.get_duo_v2_member_room_admin(b,s,cb,'host');
  if (result->>'ok') is not distinct from 'true' then raise exception 'closed session read accepted'; end if;
  if (select room from public.participant_room where participant_id=pa) is distinct from room_a then raise exception 'host room changed'; end if;
  if (select room from public.participant_room where participant_id=pb) is distinct from room_b then raise exception 'visitor room changed'; end if;
end $$;
rollback;

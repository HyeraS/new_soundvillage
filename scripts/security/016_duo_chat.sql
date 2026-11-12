-- Session-scoped chat only. Does not change Duo lifecycle or delete other data.
-- Apply to the intended Supabase project after 001–015. Requires pg_cron.
begin;

do $$
begin
  if to_regclass('public.duo_v2_sessions') is null
    or to_regprocedure('public.get_duo_v2_session_status_admin(uuid,uuid,uuid)') is null
    or not exists(select 1 from pg_publication where pubname='supabase_realtime')
  then raise exception 'PREFLIGHT_REQUIRED: verify Duo migrations and Realtime publication'; end if;
end $$;

create extension if not exists pg_cron;

create table public.chat_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.duo_v2_sessions(id) on delete cascade,
  sender_auth_user_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('host','visitor')),
  client_message_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique(session_id,sender_auth_user_id,client_message_id)
);
create index chat_messages_session_order on public.chat_messages(session_id,id);
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from public,anon,authenticated;
grant select on public.chat_messages to authenticated;

-- Shared by SELECT RLS and server-only RPCs. Never accepts a participant ID from the browser.
create function public.can_read_duo_chat(p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.duo_v2_sessions s
    join public.duo_v2_session_members m on m.session_id=s.id
    join public.duo_v2_leases l on l.session_id=m.session_id and l.auth_user_id=m.auth_user_id
    join public.study_participants p on p.auth_user_id=m.auth_user_id
    where s.id=p_session_id and m.auth_user_id=auth.uid()
      and s.status='active' and s.expires_at>now() and m.left_at is null
      and p.status='active' and l.state='active' and l.heartbeat_at>now()-interval '45 seconds'
  )
$$;
revoke all on function public.can_read_duo_chat(uuid) from public,anon;
grant execute on function public.can_read_duo_chat(uuid) to authenticated;
create policy chat_messages_member_read on public.chat_messages for select to authenticated
  using (public.can_read_duo_chat(session_id));

create function public.read_duo_chat_admin(p_auth_user_id uuid,p_session_id uuid,p_client_id uuid,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_status jsonb; v_messages jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  select public.get_duo_v2_session_status_admin(p_auth_user_id,p_session_id,p_client_id) into v_status;
  if not coalesce((v_status->>'ok')::boolean,false) then return v_status; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id::text,'session_id',q.session_id,
    'sender_role',q.sender_role,'client_message_id',q.client_message_id,'body',q.body,'created_at',q.created_at)
    order by q.id),'[]'::jsonb) into v_messages
  from (select * from public.chat_messages where session_id=p_session_id and id>p_after order by id limit 100) q;
  return jsonb_build_object('ok',true,'messages',v_messages);
end $$;

create function public.send_duo_chat_admin(p_auth_user_id uuid,p_session_id uuid,p_client_id uuid,p_message_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_status jsonb; v_message public.chat_messages%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  -- Serialize with session close/rotation and with sends from this session.
  perform 1 from public.duo_v2_sessions where id=p_session_id for update;
  select public.get_duo_v2_session_status_admin(p_auth_user_id,p_session_id,p_client_id) into v_status;
  if not coalesce((v_status->>'ok')::boolean,false) then return v_status; end if;
  if p_message_id is null or p_body is null or char_length(btrim(p_body)) not between 1 and 1000
    then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  select * into v_message from public.chat_messages where session_id=p_session_id
    and sender_auth_user_id=p_auth_user_id and client_message_id=p_message_id;
  if found and v_message.body<>btrim(p_body) then
    return jsonb_build_object('ok',false,'reason','idempotency_key_reused');
  end if;
  if not found then
    if exists(select 1 from public.chat_messages where session_id=p_session_id
      and sender_auth_user_id=p_auth_user_id and created_at>now()-interval '1 second') then
      return jsonb_build_object('ok',false,'reason','chat_rate_limited');
    end if;
    insert into public.chat_messages(session_id,sender_auth_user_id,sender_role,client_message_id,body)
      values(p_session_id,p_auth_user_id,v_status->>'role',p_message_id,btrim(p_body)) returning * into v_message;
  end if;
  return jsonb_build_object('ok',true,'message',jsonb_build_object('id',v_message.id::text,
    'session_id',v_message.session_id,'sender_role',v_message.sender_role,
    'client_message_id',v_message.client_message_id,'body',v_message.body,'created_at',v_message.created_at));
end $$;
revoke all on function public.read_duo_chat_admin(uuid,uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.send_duo_chat_admin(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_duo_chat_admin(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.send_duo_chat_admin(uuid,uuid,uuid,uuid,text) to service_role;

-- Only messages of expired sessions are removed. No session/log/game rows are changed.
create function public.delete_expired_duo_chat_messages()
returns void language sql security definer set search_path='' as $$
  delete from public.chat_messages c using public.duo_v2_sessions s
    where c.session_id=s.id and s.expires_at<=now()
$$;
revoke all on function public.delete_expired_duo_chat_messages() from public,anon,authenticated;
select cron.schedule('delete-expired-duo-chat-messages','* * * * *',
  'select public.delete_expired_duo_chat_messages()');

-- INSERT notifications use SELECT RLS; no browser INSERT/UPDATE/DELETE permission.
alter publication supabase_realtime add table public.chat_messages;
commit;

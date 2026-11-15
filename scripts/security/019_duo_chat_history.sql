-- Apply after 018. Retain chat indefinitely; admin-only pair/session history.
-- No changes to player chat access, authentication, session lifetime or gameplay.
begin;

-- Stop only the chat expiry job introduced by 016.
do $$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname='delete-expired-duo-chat-messages' loop
    perform cron.unschedule(v_job);
  end loop;
end $$;

-- Also neutralize the old entry point: manual calls cannot erase chat on expiry.
create or replace function public.delete_expired_duo_chat_messages()
returns void language plpgsql security definer set search_path='' as $$
begin
  return;
end $$;
revoke all on function public.delete_expired_duo_chat_messages() from public,anon,authenticated;

-- Snapshots have no FK to live sessions/users. Historical labels survive deletes
-- and operator-assisted auth rebinding. Unrecoverable older labels remain NULL.
create table public.duo_chat_session_archive (
  session_id uuid primary key,
  host_participant_id text,
  visitor_participant_id text,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  closed_at timestamptz,
  session_status text not null,
  deleted_at timestamptz
);
alter table public.duo_chat_session_archive enable row level security;
revoke all on public.duo_chat_session_archive from public,anon,authenticated;
grant select on public.duo_chat_session_archive to service_role;

create function private.snapshot_duo_chat_session(p_session_id uuid)
returns void language sql security definer set search_path='' as $$
  insert into public.duo_chat_session_archive(
    session_id,host_participant_id,visitor_participant_id,started_at,expires_at,closed_at,session_status
  )
  select s.id,h.participant_id,v.participant_id,s.created_at,s.expires_at,s.closed_at,s.status
    from public.duo_v2_sessions s
    left join public.study_participants h on h.auth_user_id=s.host_auth_user_id
    left join public.duo_v2_session_members vm on vm.session_id=s.id and vm.role='visitor'
    left join public.study_participants v on v.auth_user_id=vm.auth_user_id
    where s.id=p_session_id
  on conflict(session_id) do update set
    host_participant_id=coalesce(public.duo_chat_session_archive.host_participant_id,excluded.host_participant_id),
    visitor_participant_id=coalesce(public.duo_chat_session_archive.visitor_participant_id,excluded.visitor_participant_id),
    expires_at=excluded.expires_at,closed_at=excluded.closed_at,session_status=excluded.session_status
$$;
revoke all on function private.snapshot_duo_chat_session(uuid) from public,anon,authenticated;

create function private.capture_duo_chat_session()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then
    update public.duo_chat_session_archive set deleted_at=now() where session_id=OLD.id;
    return OLD;
  end if;
  perform private.snapshot_duo_chat_session(NEW.id);
  return NEW;
end $$;
revoke all on function private.capture_duo_chat_session() from public,anon,authenticated;
create trigger duo_chat_archive_session after insert or update or delete on public.duo_v2_sessions
  for each row execute function private.capture_duo_chat_session();

create function private.capture_duo_chat_member()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.snapshot_duo_chat_session(NEW.session_id);
  return NEW;
end $$;
revoke all on function private.capture_duo_chat_member() from public,anon,authenticated;
create trigger duo_chat_archive_member after insert on public.duo_v2_session_members
  for each row execute function private.capture_duo_chat_member();

-- Best-effort backfill for surviving sessions. Already deleted messages cannot be recovered.
select private.snapshot_duo_chat_session(id) from public.duo_v2_sessions;

-- Preserve the original UUIDs as historical identifiers. Deleting a live auth user
-- or session must not cascade into the retained chat; no other FK is changed.
alter table public.chat_messages drop constraint chat_messages_session_id_fkey;
alter table public.chat_messages drop constraint chat_messages_sender_auth_user_id_fkey;

-- Invoker views do not bypass table permissions/RLS. No browser grants.
create view public.duo_chat_session_history with (security_invoker=true) as
select a.*,
  case when a.host_participant_id is not null and a.visitor_participant_id is not null
    then least(a.host_participant_id,a.visitor_participant_id) end as pair_participant_1,
  case when a.host_participant_id is not null and a.visitor_participant_id is not null
    then greatest(a.host_participant_id,a.visitor_participant_id) end as pair_participant_2,
  case when a.deleted_at is not null then 'deleted'
    when a.session_status='active' and a.expires_at<=now() then 'expired'
    else a.session_status end as effective_status,
  (select count(*) from public.chat_messages c where c.session_id=a.session_id) as message_count
from public.duo_chat_session_archive a;

create view public.duo_chat_message_history with (security_invoker=true) as
select s.pair_participant_1,s.pair_participant_2,s.host_participant_id,s.visitor_participant_id,
  s.session_id,s.started_at,s.expires_at,s.closed_at,s.effective_status,
  c.id as message_id,c.sender_role,
  case c.sender_role when 'host' then s.host_participant_id else s.visitor_participant_id end as sender_participant_id,
  c.body,c.created_at
from public.duo_chat_session_history s join public.chat_messages c on c.session_id=s.session_id;

revoke all on public.duo_chat_session_history,public.duo_chat_message_history from public,anon,authenticated;
grant select on public.chat_messages,public.duo_chat_session_history,public.duo_chat_message_history to service_role;
commit;

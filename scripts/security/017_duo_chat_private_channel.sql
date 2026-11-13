-- Apply after 016. Keep Allow public access disabled.
-- Only permits joining a chat channel for the caller's active session/client.
-- Message rows remain protected by chat_messages SELECT RLS from 016.
begin;

create function public.can_join_duo_chat_topic(p_topic text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.duo_v2_leases lease
    where lease.auth_user_id=auth.uid()
      and p_topic='duo-chat:'||lease.session_id::text||':'||lease.client_id::text
      and public.can_read_duo_chat(lease.session_id)
  )
$$;
revoke all on function public.can_join_duo_chat_topic(text) from public,anon,authenticated;
grant execute on function public.can_join_duo_chat_topic(text) to authenticated;

-- Private-channel joins require a read policy even for Postgres Changes.
-- No Broadcast send or Presence permission is added.
create policy duo_chat_private_read on realtime.messages
  for select to authenticated
  using (extension='broadcast' and public.can_join_duo_chat_topic(realtime.topic()));

commit;

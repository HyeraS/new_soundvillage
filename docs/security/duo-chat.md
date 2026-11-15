# Session-scoped Duo chat

Apply `scripts/security/016_duo_chat.sql` in the intended Supabase SQL Editor after migrations 001–015 for the initial install, then apply forward migrations 017–020 in order before deploying the current app changes. This requires Supabase Cron (`pg_cron`) and the existing `supabase_realtime` publication. No remote migration was executed by this implementation.

- One `public.chat_messages` table; each row belongs to a `duo_v2_sessions.id`.
- Same session recovery retains history. A genuinely new session starts empty, even for the same participants. Existing invite rotation/session creation behavior is unchanged.
- The page owns the chat hook above screen branches. The collapsible UI stays mounted across map/room/activity screens; folding it does not disconnect it.
- Writes go through the authenticated Next route and service-only RPCs. Sender role comes from the validated session; client IDs, membership, active participant, lease, expiry, and idempotency are validated. Browser access is SELECT-only under session/member RLS. Message bodies are rendered as text and are not added to `user_events`.
- Postgres Changes delivers INSERT events; initial load, subscription/reconnection, and window focus reconcile history. Failed sends retain the draft and retry key. Messages are limited to 1,000 characters, with one new send per sender/second.
- Migration 019 unschedules only `delete-expired-duo-chat-messages` and makes its old cleanup function a no-op. Messages remain indefinitely after expiry/closure. Player chat access still stops on expiry, and new sessions still start with empty chat. Messages already deleted before 019 cannot be recovered.
- No existing session, invite, participant, gameplay, user-event cleanup, or position throttle is modified. Migration 019 removes only the two chat-message foreign keys that cascaded deletes from live sessions/auth users, keeping their UUID values as historical identifiers. Other data deletion behavior is unchanged.

Validation: `scripts/security/duo-chat.integration.sql` is a rollback-only test for a disposable local Supabase after migration 019. It checks membership, client binding, retry idempotency, closed-session rejection, isolation for the same pair in a new session, and retained expired messages. Do not execute test fixtures in production. Build and live database/browser checks require Node/npm and a local Supabase, which were unavailable in the implementation environment.

After applying the migration, verify the named Cron job is active in Supabase Cron, then test two independently authenticated browser profiles: same/different screens, folded unread count, refresh recovery, failed-send retry, expiry, and a fresh session for the same pair.

## Admin pair/session history (019)

`duo_chat_session_archive` snapshots the participant IDs at session creation/join without foreign keys to live identity rows. Existing surviving sessions are backfilled using their current mappings; already lost/rebound historical identities may be unknown. Participant relinking afterward does not overwrite captured names.

Use the admin-only `duo_chat_session_history` view to filter `pair_participant_1`/`pair_participant_2` and sort by `started_at`. Host/visitor order is normalized for pair grouping, so A inviting B and B inviting A share a pair. Select a `session_id` in `duo_chat_message_history` and sort by `message_id` to see that session's conversation. These are flat database views, not folders. They are denied to anon/authenticated and available to the SQL Editor's postgres role and server service role; player chat RLS is unchanged.

```sql
select * from public.duo_chat_session_history
where pair_participant_1='P03' and pair_participant_2='P04'
order by started_at;

select * from public.duo_chat_message_history
where session_id='replace-with-session-uuid'::uuid
order by message_id;
```

## Immediate invitations (020)

The original four-furniture eligibility gate is retained in comments in the frontend and 020 SQL. Only that gate is disabled. Authentication, active participant checks, supported economy modes, duplicate-tab handling, two-person membership and the two-hour session lifetime remain unchanged. The first room visit can use the empty saved-room fallback introduced by 018.

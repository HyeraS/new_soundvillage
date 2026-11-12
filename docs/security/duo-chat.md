# Session-scoped Duo chat

Apply `scripts/security/016_duo_chat.sql` in the intended Supabase SQL Editor after migrations 001–015, before deploying the app changes. This requires Supabase Cron (`pg_cron`) and the existing `supabase_realtime` publication. No remote migration was executed by this implementation.

- One `public.chat_messages` table; each row belongs to a `duo_v2_sessions.id`.
- Same session recovery retains history. A genuinely new session starts empty, even for the same participants. Existing invite rotation/session creation behavior is unchanged.
- The page owns the chat hook above screen branches. The collapsible UI stays mounted across map/room/activity screens; folding it does not disconnect it.
- Writes go through the authenticated Next route and service-only RPCs. Sender role comes from the validated session; client IDs, membership, active participant, lease, expiry, and idempotency are validated. Browser access is SELECT-only under session/member RLS. Message bodies are rendered as text and are not added to `user_events`.
- Postgres Changes delivers INSERT events; initial load, subscription/reconnection, and window focus reconcile history. Failed sends retain the draft and retry key. Messages are limited to 1,000 characters, with one new send per sender/second.
- The Cron job `delete-expired-duo-chat-messages` runs every minute and deletes **only chat_messages rows whose parent session expires_at <= now()**. Physical deletion is typically within one minute when Cron is running; UI/API access stops on expiry. Closing a session early prevents further chat but its stored messages remain until its original expiry. Closing the chat panel or browser does not delete messages.
- No existing session, invite, participant, gameplay, user-event cleanup, or position throttle is modified. The new foreign key only removes child chat rows if an existing process actually deletes a parent session.

Validation: `scripts/security/duo-chat.integration.sql` is a rollback-only test for a disposable local Supabase after migration 016. It checks membership, client binding, retry idempotency, closed-session rejection, isolation for the same pair in a new session, and expiry-only deletion. Do not execute test fixtures in production. Build and live database/browser checks require Node/npm and a local Supabase, which were unavailable in the implementation environment.

After applying the migration, verify the named Cron job is active in Supabase Cron, then test two independently authenticated browser profiles: same/different screens, folded unread count, refresh recovery, failed-send retry, expiry, and a fresh session for the same pair.

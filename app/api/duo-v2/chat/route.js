import { requireDuoUser, requireDuoUuids, readDuoBody, duoResponse, duoStorageFailure } from '@/lib/duoApi.server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

async function execute(request, sending) {
  const auth = await requireDuoUser(request)
  if (auth.response) return auth.response
  let body
  if (sending) {
    const parsed = await readDuoBody(request, ['sessionId', 'clientId', 'clientMessageId', 'body'])
    if (parsed.response) return parsed.response
    body = parsed.body
  } else {
    const params = new URL(request.url).searchParams
    if ([...params.keys()].length !== 3 || ['sessionId','clientId','after'].some(key => params.getAll(key).length !== 1)) {
      return duoResponse({ ok:false, code:'invalid_request' })
    }
    body = Object.fromEntries(params)
  }
  const invalid = requireDuoUuids(body, sending ? ['sessionId','clientId','clientMessageId'] : ['sessionId','clientId'])
  if (invalid) return invalid
  if (sending ? typeof body.body !== 'string' || !body.body.trim() || body.body.length > 1000 : !/^\d{1,18}$/.test(body.after)) {
    return duoResponse({ ok:false, code:'invalid_request' })
  }
  const { data, error } = await getSupabaseAdmin().rpc(sending ? 'send_duo_chat_admin' : 'read_duo_chat_admin', {
    p_auth_user_id:auth.user.id, p_session_id:body.sessionId, p_client_id:body.clientId,
    ...(sending ? { p_message_id:body.clientMessageId, p_body:body.body.trim() } : { p_after:body.after }),
  })
  if (error) return duoStorageFailure('chat', error)
  if (data?.reason === 'chat_rate_limited') return Response.json({ ok:false, code:'chat_rate_limited' }, { status:429, headers:{ 'Cache-Control':'private, no-store' } })
  if (!data?.ok) return duoResponse(data)
  return Response.json(data, { headers:{ 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer' } })
}

export const GET = request => execute(request, false)
export const POST = request => execute(request, true)

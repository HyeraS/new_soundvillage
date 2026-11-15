import { duoResponse, duoStorageFailure, requireDuoUuids, requireDuoUser } from '@/lib/duoApi.server'
import { getDuoSharedRoom, getDuoMemberRoom } from '@/lib/duoSession.server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const auth = await requireDuoUser(request)
  if (auth.response) return auth.response
  const url = new URL(request.url)
  if ([...url.searchParams.keys()].some((key) => !['sessionId', 'clientId', 'ownerRole'].includes(key))) {
    return duoResponse({ ok:false, code:'invalid_request' })
  }
  const body = { sessionId:url.searchParams.get('sessionId'), clientId:url.searchParams.get('clientId') }
  const invalid = requireDuoUuids(body, ['sessionId', 'clientId'])
  if (invalid) return invalid
  const ownerRole = url.searchParams.get('ownerRole')
  if (url.searchParams.getAll('sessionId').length !== 1 || url.searchParams.getAll('clientId').length !== 1
    || url.searchParams.getAll('ownerRole').length > 1
    || (ownerRole !== null && !['host','visitor'].includes(ownerRole))) {
    return duoResponse({ ok:false, code:'invalid_request' })
  }
  const { data, error } = ownerRole === null
    ? await getDuoSharedRoom(auth.user.id, body.sessionId, body.clientId)
    : await getDuoMemberRoom(auth.user.id, body.sessionId, body.clientId, ownerRole)
  if (error) return duoStorageFailure('room', error)
  if (!data?.ok) return duoResponse(data)
  return Response.json({ ok:true, code:'success', room:data.room, revision:data.revision, ownerRole:data.ownerRole || 'host' }, {
    headers:{ 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer' },
  })
}

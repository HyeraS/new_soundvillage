import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveDuoRoomOwnerRole, isSameDuoInterior, readDuoHomeLocation, resolveDuoVisitorFollowAction } from './duoNavigation.mjs'
import { validateDuoPositionPayload } from './duoSessionContract.mjs'

const pose = { senderRole:'host', x:10, y:20, facing:'down', screen:'interior', moving:false }

test('both own homes and reciprocal visits resolve the correct room owner', () => {
  for (const role of ['host','visitor']) {
    const peer = role === 'host' ? 'visitor' : 'host'
    assert.equal(resolveDuoRoomOwnerRole({ screen:'house', role }), role)
    assert.equal(resolveDuoRoomOwnerRole({ screen:'house', role, visiting:{ ownerRole:peer } }), peer)
    assert.equal(resolveDuoRoomOwnerRole({ screen:'world', role }), null)
    assert.equal(resolveDuoRoomOwnerRole({ screen:'house', role, visiting:{ token:'saved-room' } }), null)
  }
})

test('avatars meet only inside the same owner home, never when homes are swapped', () => {
  assert.equal(isSameDuoInterior('host', { ...pose, roomOwnerRole:'host' }), true)
  assert.equal(isSameDuoInterior('visitor', { ...pose, roomOwnerRole:'visitor' }), true)
  assert.equal(isSameDuoInterior('host', { ...pose, roomOwnerRole:'visitor' }), false)
  assert.equal(isSameDuoInterior('visitor', { ...pose, roomOwnerRole:'host' }), false)
  assert.equal(isSameDuoInterior('host', pose), false, 'old clients without an owner cannot appear in the wrong room')
  assert.equal(isSameDuoInterior('host', { ...pose, screen:'worldmap', roomOwnerRole:'host' }), false)
})

test('peer entering or leaving any screen never moves the local participant', () => {
  for (const role of ['host','visitor']) for (const peerScreen of ['interior','worldmap','waiting']) {
    for (const visiting of [true,false]) assert.equal(resolveDuoVisitorFollowAction({ role, peerScreen, visiting, hasSharedRoom:true }), 'stay')
  }
})

test('home location recovery is tied to the session and tolerates malformed storage', () => {
  for (const location of [{ kind:'house' }, { kind:'friend', ownerRole:'visitor' }, { kind:'world' }]) {
    const stored = { sessionId:'one', ...location }
    const storage = { getItem:() => JSON.stringify(stored) }
    assert.deepEqual(readDuoHomeLocation(storage, 'one'), stored)
    assert.equal(readDuoHomeLocation(storage, 'two'), null)
  }
  for (const value of ['broken', 'null', '{"sessionId":"one","kind":"friend","ownerRole":"outsider"}']) {
    assert.equal(readDuoHomeLocation({ getItem:() => value }, 'one'), null)
  }
})

test('position wire format validates room owners and omits them outside interiors', () => {
  assert.equal(validateDuoPositionPayload({ ...pose, roomOwnerRole:'host' }).roomOwnerRole, 'host')
  assert.equal(validateDuoPositionPayload({ ...pose, roomOwnerRole:'visitor' }).roomOwnerRole, 'visitor')
  assert.equal(validateDuoPositionPayload({ ...pose, roomOwnerRole:'outsider' }), null)
  assert.equal(validateDuoPositionPayload({ ...pose, roomOwnerRole:'host', screen:'worldmap' }).roomOwnerRole, undefined)
})

test('new home endpoints retain caller identity binding and never accept an owner participant ID', () => {
  const sql = readFileSync(new URL('../scripts/security/018_duo_independent_homes.sql', import.meta.url), 'utf8')
  assert.match(sql, /get_duo_v2_session_status_admin\(p_auth_user_id,p_session_id,p_client_id\)/)
  assert.match(sql, /session.id=p_session_id and member.role=p_owner_role/)
  assert.match(sql, /revoke all on function[\s\S]*from public,anon,authenticated/)
  assert.doesNotMatch(sql, /grant (?:update|insert|delete)|delete from|drop table/i)
  for (const file of ['room','purchase']) {
    const route = readFileSync(new URL(`../app/api/economy-v1/${file}/route.js`, import.meta.url), 'utf8')
    assert.match(route, /requireEnabledEconomyUser\(request\)/)
    assert.match(route, /auth.user.id/)
    assert.doesNotMatch(route, /isDuoVisitorMutationBlocked/)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createDuoPraise, DUO_PRAISE_EVENT, DUO_PRAISE_ACK_EVENT, DUO_PRAISE_COOLDOWN_MS } from './duoPraise.mjs'

const sessionId = '12345678-1234-4234-9234-123456789abc'
function fixture({ dropAck = false, transportFailure = false } = {}) {
  let clock = 10000, sequence = 0, timerId = 0
  const timers = new Map(), received = { a:[], b:[] }, packets = []
  const context = {
    a:{ sessionId, role:'visitor', peerRole:'host', online:true, screen:'interior', roomOwnerRole:'host' },
    b:{ sessionId, role:'host', peerRole:'visitor', online:true, screen:'waiting', roomOwnerRole:null },
  }
  const controllers = {}
  for (const [name, peer] of [['a','b'],['b','a']]) controllers[name] = createDuoPraise({
    getContext:() => context[name],
    now:() => clock,
    makeId:() => `00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,
    setTimer:fn => { timers.set(++timerId, fn); return timerId },
    clearTimer:id => timers.delete(id),
    onPraise:payload => received[name].push(payload),
    send:async (event, payload) => {
      packets.push({ from:name, event, payload })
      if (transportFailure) return 'error'
      if (event === DUO_PRAISE_EVENT) controllers[peer].receivePraise(payload)
      if (event === DUO_PRAISE_ACK_EVENT && !dropAck) controllers[peer].receiveAck(payload)
      return 'ok'
    },
  })
  return { controllers, context, received, packets, advance:() => { clock += DUO_PRAISE_COOLDOWN_MS },
    expire:() => { [...timers.values()].forEach(fn => fn()); timers.clear() } }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

test('praise displays on the owner in another screen and succeeds only after their acknowledgement', async () => {
  const f = fixture()
  assert.deepEqual(await f.controllers.a.sendPraise(), { ok:true })
  assert.equal(f.received.b.length, 1)
  assert.equal(f.received.a.length, 0)
  assert.equal(f.packets[1].event, DUO_PRAISE_ACK_EVENT)
})

test('both roles can praise the other home', async () => {
  const f = fixture()
  Object.assign(f.context.b, { screen:'interior', roomOwnerRole:'visitor' })
  assert.equal((await f.controllers.b.sendPraise()).ok, true)
  assert.equal(f.received.a.length, 1)
})

test('offline or own-home attempts do not send or show success', async () => {
  const f = fixture()
  f.context.a.online = false
  assert.equal((await f.controllers.a.sendPraise()).ok, false)
  f.context.a.online = true
  f.context.a.roomOwnerRole = 'visitor'
  assert.equal((await f.controllers.a.sendPraise()).code, 'not_visiting_peer')
  assert.equal(f.packets.length, 0)
})

test('rapid clicks are blocked while sending and during the cooldown', async () => {
  const f = fixture()
  const first = f.controllers.a.sendPraise()
  assert.equal((await f.controllers.a.sendPraise()).code, 'cooldown')
  await first
  assert.equal((await f.controllers.a.sendPraise()).code, 'cooldown')
  f.advance()
  assert.equal((await f.controllers.a.sendPraise()).ok, true)
  assert.equal(f.received.b.length, 2)
})

test('transport acceptance without peer receipt confirmation is not reported as success', async () => {
  const f = fixture({ dropAck:true })
  const sending = f.controllers.a.sendPraise()
  await flush()
  f.expire()
  assert.deepEqual(await sending, { ok:false, code:'not_confirmed' })
})

test('transport failure reports failure', async () => {
  const f = fixture({ transportFailure:true })
  assert.deepEqual(await f.controllers.a.sendPraise(), { ok:false, code:'not_confirmed' })
  assert.equal(f.received.b.length, 0)
})

test('duplicate events do not show duplicate hearts; wrong roles/sessions are ignored', async () => {
  const f = fixture()
  await f.controllers.a.sendPraise()
  const payload = f.packets[0].payload
  f.controllers.b.receivePraise(payload)
  f.controllers.b.receivePraise({ ...payload, sessionId:'another-session' })
  f.controllers.b.receivePraise({ ...payload, senderRole:'host' })
  f.controllers.b.receivePraise({ ...payload, nonce:'invalid' })
  f.controllers.b.receivePraise({ ...payload, recipientRole:'visitor' })
  assert.equal(f.received.b.length, 1)
})

test('disposal cancels pending work and prevents late notices and sends', async () => {
  const f = fixture()
  const sending = f.controllers.a.sendPraise()
  f.controllers.a.dispose()
  assert.deepEqual(await sending, { ok:false, code:'connection_lost' })
  await flush()
  assert.equal(f.packets.length, 0)
  f.controllers.b.dispose()
  f.controllers.b.receivePraise({ sessionId, senderRole:'visitor', recipientRole:'host', nonce:sessionId })
  assert.equal(f.received.b.length, 0)
})

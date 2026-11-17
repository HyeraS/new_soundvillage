import { isUuid } from './duoSessionContract.mjs'

export const DUO_PRAISE_EVENT = 'home-praise'
export const DUO_PRAISE_ACK_EVENT = 'home-praise-received'
export const DUO_PRAISE_COOLDOWN_MS = 3000
export const DUO_PRAISE_TIMEOUT_MS = 4000

// Ephemeral acknowledgements confirm receipt by the peer client, not persistence.
export function createDuoPraise({ getContext, send, onPraise, now = Date.now,
  makeId = () => crypto.randomUUID(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null, lastSent = -Infinity, lastReceived = -Infinity, disposed = false
  const seen = new Set()
  const valid = payload => {
    const context = getContext()
    return !disposed && context.online && payload && typeof payload === 'object'
      && Object.keys(payload).every(key => ['sessionId','senderRole','recipientRole','nonce'].includes(key))
      && payload.sessionId === context.sessionId && payload.senderRole === context.peerRole
      && payload.recipientRole === context.role && isUuid(payload.nonce)
  }
  const finish = result => {
    if (!pending) return
    const request = pending
    pending = null
    clearTimer(request.timer)
    request.resolve(result)
  }
  return {
    sendPraise() {
      const context = getContext()
      if (disposed || !context.online) return Promise.resolve({ ok:false, code:'peer_unavailable' })
      if (context.screen !== 'interior' || context.roomOwnerRole !== context.peerRole) {
        return Promise.resolve({ ok:false, code:'not_visiting_peer' })
      }
      if (pending || now() - lastSent < DUO_PRAISE_COOLDOWN_MS) return Promise.resolve({ ok:false, code:'cooldown' })
      lastSent = now()
      const payload = { sessionId:context.sessionId, senderRole:context.role, recipientRole:context.peerRole, nonce:makeId() }
      return new Promise(resolve => {
        pending = { nonce:payload.nonce, resolve,
          timer:setTimer(() => finish({ ok:false, code:'not_confirmed' }), DUO_PRAISE_TIMEOUT_MS) }
        Promise.resolve().then(() => disposed || pending?.nonce !== payload.nonce ? 'error' : send(DUO_PRAISE_EVENT, payload)).then(result => {
          if (result !== 'ok' && pending?.nonce === payload.nonce) finish({ ok:false, code:'not_confirmed' })
        }).catch(() => {
          if (pending?.nonce === payload.nonce) finish({ ok:false, code:'not_confirmed' })
        })
      })
    },
    receivePraise(payload) {
      if (!valid(payload)) return
      if (!seen.has(payload.nonce)) {
        if (now() - lastReceived < DUO_PRAISE_COOLDOWN_MS) return
        lastReceived = now()
        seen.add(payload.nonce)
        if (seen.size > 32) seen.delete(seen.values().next().value)
        onPraise(payload)
      }
      // Duplicates may be acknowledged again, but never display a second heart.
      const context = getContext()
      void Promise.resolve().then(() => send(DUO_PRAISE_ACK_EVENT, {
        sessionId:context.sessionId, senderRole:context.role, recipientRole:context.peerRole, nonce:payload.nonce,
      })).catch(() => {})
    },
    receiveAck(payload) {
      if (valid(payload) && pending?.nonce === payload.nonce) finish({ ok:true })
    },
    cancelPending() { finish({ ok:false, code:'connection_lost' }) },
    dispose() { disposed = true; finish({ ok:false, code:'connection_lost' }); seen.clear() },
  }
}

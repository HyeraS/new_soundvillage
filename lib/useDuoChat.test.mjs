import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./useDuoChat.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace('export function useDuoChat', 'function useDuoChat')

function harness() {
  const slots = [], effects = [], channels = [], removed = []
  let cursor = 0, reads = 0
  let response = { ok:false, code:'storage_retryable' }
  const session = { sessionId:'session-a', role:'host', expiresAt:'2099-01-01T00:00:00Z' }
  const client = {
    auth:{ getSession:async () => ({ data:{ session:{ access_token:'test-only' } } }) },
    realtime:{ setAuth:async () => {} },
    channel(topic, options) {
      const channel = {
        topic, options,
        on(event, filter, handler) { Object.assign(this, { event, filter, handler }); return this },
        subscribe(handler) {
          this.status = handler
          // Model a Supabase project with public access disabled.
          queueMicrotask(() => handler(options?.config?.private === true ? 'SUBSCRIBED' : 'CHANNEL_ERROR'))
          return this
        },
      }
      channels.push(channel)
      return channel
    },
    removeChannel:async channel => { removed.push(channel) },
  }
  const useState = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  }
  const useRef = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = { current:initial }
    return slots[index]
  }
  const useEffect = (fn, deps) => {
    const index = cursor++, previous = slots[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      previous?.cleanup?.()
      slots[index] = { deps }
      effects.push(() => { slots[index].cleanup = fn() })
    }
  }
  const window = { addEventListener() {}, removeEventListener() {}, setTimeout() { return 1 }, clearTimeout() {} }
  const hook = new Function('useState','useRef','useEffect','useCallback','getClient','requestDuoChat','window','queueMicrotask','crypto', `${source}\nreturn useDuoChat`)(
    useState, useRef, useEffect, fn => fn, () => client,
    async (_session, _client, message) => { if (message) return response; reads++; return { ok:true, messages:[] } },
    window, queueMicrotask, { randomUUID:() => 'test-message-key' },
  )
  return {
    channels, removed, session,
    render() { cursor = 0; const chat = hook(session, 'client-a'); effects.splice(0).forEach(fn => fn()); return chat },
    async flush() { for (let i = 0; i < 30; i++) await Promise.resolve() },
    get reads() { return reads },
    set response(value) { response = value },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

test('private-only project accepts chat and delivers INSERT without manual reconnect', async () => {
  const h = harness()
  h.render(); await h.flush()
  assert.equal(h.render().connected, true)
  const channel = h.channels[0]
  assert.equal(channel.topic, 'duo-chat:session-a:client-a')
  assert.deepEqual(channel.options, { config:{ private:true } })
  assert.equal(channel.filter.filter, 'session_id=eq.session-a')
  const reads = h.reads
  channel.handler({ new:{ id:1, session_id:'session-a', sender_role:'visitor', body:'hello' } })
  const chat = h.render()
  assert.equal(chat.messages[0].body, 'hello')
  assert.equal(chat.unread, 1)
  assert.equal(h.reads, reads, 'INSERT displays without fetching history')
  h.unmount()
  assert.deepEqual(h.removed, [channel])
})

test('reconnect remains private and does not erase failed-send warning', async () => {
  const h = harness()
  h.render(); await h.flush()
  await h.render().send('unsent')
  h.render().reconnect(); h.render(); await h.flush()
  assert.equal(h.channels.at(-1).options.config.private, true)
  assert.equal(h.render().sendError, 'storage_retryable')
  h.unmount()
})

test('old session notifications are ignored after switching to a new session', async () => {
  const h = harness()
  h.render(); await h.flush()
  const old = h.channels[0]
  h.session.sessionId = 'session-b'
  h.render(); await h.flush()
  old.handler({ new:{ id:1, session_id:'session-a', sender_role:'visitor', body:'old' } })
  assert.deepEqual(h.render().messages, [])
  assert.equal(h.channels.at(-1).topic, 'duo-chat:session-b:client-a')
  h.unmount()
})

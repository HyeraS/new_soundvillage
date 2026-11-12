'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getClient } from '@/lib/supabase'
import { requestDuoChat } from '@/lib/duoChat.client'

const EMPTY = { messages:[], open:false, unread:0, connectionError:'', sendError:'', connected:false, sending:false, expired:false }
const TERMINAL = new Set(['session_closed','session_expired','session_left','participant_inactive','membership_required'])

export function useDuoChat(session, clientId) {
  const sessionId = session?.sessionId
  const role = session?.role
  const expiresAt = session?.expiresAt
  const scope = sessionId && clientId ? `${sessionId}:${clientId}` : null
  const [state, setState] = useState({ ...EMPTY, scope:null })
  const generation = useRef(null)
  const pending = useRef(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!scope) return
    const token = { scope }
    generation.current = token
    if (pending.current?.scope !== scope) pending.current = null
    else pending.current.sending = false
    let active = true
    let syncing = false
    let queued = false
    let channel
    const client = getClient()
    const update = fn => { if (active) setState(previous => fn(previous.scope === scope ? previous : { ...EMPTY, scope })) }
    const fail = code => update(previous => ({ ...previous, connectionError:code, ...(TERMINAL.has(code) ? { expired:true, messages:[], unread:0 } : {}) }))
    const merge = rows => update(previous => {
      if (previous.expired) return previous
      const known = new Set(previous.messages.map(message => String(message.id)))
      const incoming = rows.filter(message => message.session_id === sessionId && !known.has(String(message.id)))
      const messages = [...previous.messages, ...incoming].sort((a,b) => BigInt(a.id)<BigInt(b.id) ? -1 : BigInt(a.id)>BigInt(b.id) ? 1 : 0)
      return { ...previous, messages, unread:previous.unread + (previous.open ? 0 : incoming.filter(message => message.sender_role !== role).length), connectionError:'' }
    })
    const sync = async () => {
      if (!active) return
      if (syncing) { queued = true; return }
      syncing = true
      try {
        // Re-read on reconnect to recover missed events, including delayed commits.
        let after = '0'
        while (active) {
          const result = await requestDuoChat(sessionId, clientId, null, after)
          if (!active) return
          if (!result.ok) { fail(result.code); break }
          merge(result.messages)
          if (result.messages.length < 100) break
          after = result.messages.at(-1).id
        }
      } finally {
        syncing = false
        if (queued && active) { queued = false; void sync() }
      }
    }
    const start = async () => {
      const { data, error } = await client.auth.getSession()
      if (!active) return
      if (error || !data.session) { fail('auth_required'); return }
      await client.realtime.setAuth(data.session.access_token)
      if (!active) return
      channel = client.channel(`duo-chat:${sessionId}:${clientId}`)
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`session_id=eq.${sessionId}` }, ({ new:message }) => merge([{ ...message, id:String(message.id) }]))
        .subscribe(status => {
          if (!active) return
          update(previous => ({ ...previous, connected:status === 'SUBSCRIBED' }))
          if (status === 'SUBSCRIBED') void sync()
          else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) fail('connection_lost')
        })
      void sync()
    }
    queueMicrotask(() => {
      if (!active) return
      setState(previous => previous.scope === scope ? { ...previous, sending:false, connectionError:'' } : { ...EMPTY, scope })
      void start().catch(() => fail('connection_lost'))
    })
    const onFocus = () => { void sync() }
    window.addEventListener('focus', onFocus)
    const remaining = Date.parse(expiresAt) - Date.now()
    const timer = Number.isFinite(remaining) ? window.setTimeout(() => {
      update(previous => ({ ...previous, expired:true, messages:[], unread:0, connected:false }))
      if (channel) void client.removeChannel(channel)
    }, Math.max(0, remaining)) : null
    return () => {
      active = false
      if (generation.current === token) generation.current = null
      window.removeEventListener('focus', onFocus)
      window.clearTimeout(timer)
      if (channel) void client.removeChannel(channel)
    }
  }, [scope, sessionId, clientId, role, expiresAt, retry])

  const send = useCallback(async body => {
    const token = generation.current
    const text = body.trim()
    if (!token || token.scope !== scope || !text || text.length > 1000 || pending.current?.sending) return false
    const message = pending.current?.body === text ? pending.current : { scope, body:text, clientMessageId:crypto.randomUUID() }
    message.sending = true
    pending.current = message
    setState(previous => ({ ...previous, sending:true }))
    const result = await requestDuoChat(sessionId, clientId, { body:text, clientMessageId:message.clientMessageId })
    if (generation.current !== token) return false
    message.sending = false
    setState(previous => {
      if (previous.scope !== scope) return previous
      if (!result.ok) return { ...previous, sending:false, sendError:result.code, ...(TERMINAL.has(result.code) ? { expired:true, messages:[], unread:0 } : {}) }
      if (previous.expired) return { ...previous, sending:false }
      const messages = previous.messages.some(row => row.id === result.message.id) ? previous.messages : [...previous.messages, result.message]
      return { ...previous, messages:messages.sort((a,b) => BigInt(a.id)<BigInt(b.id) ? -1 : BigInt(a.id)>BigInt(b.id) ? 1 : 0), sending:false, sendError:'' }
    })
    if (result.ok) pending.current = null
    return result.ok
  }, [scope, sessionId, clientId])

  return {
    ...(state.scope === scope ? state : EMPTY), send,
    toggle:() => setState(previous => ({ ...previous, open:!previous.open, unread:0 })),
    reconnect:() => setRetry(value => value + 1),
  }
}

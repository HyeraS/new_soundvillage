'use client'

import { getClient } from '@/lib/supabase'

export async function requestDuoChat(sessionId, clientId, message = null, after = '0') {
  try {
    const { data, error } = await getClient().auth.getSession()
    if (error || !data.session) return { ok:false, code:'auth_required' }
    const response = await fetch(message ? '/api/duo-v2/chat' : `/api/duo-v2/chat?${new URLSearchParams({ sessionId, clientId, after })}`, {
      method:message ? 'POST' : 'GET', cache:'no-store', referrerPolicy:'no-referrer',
      headers:{ Authorization:`Bearer ${data.session.access_token}`, ...(message ? { 'Content-Type':'application/json' } : {}) },
      ...(message ? { body:JSON.stringify({ sessionId, clientId, ...message }) } : {}),
    })
    const result = await response.json()
    return { ...result, ok:response.ok && result.ok === true }
  } catch {
    return { ok:false, code:'storage_retryable' }
  }
}

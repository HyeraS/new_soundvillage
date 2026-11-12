'use client'

import { useEffect, useRef, useState } from 'react'

export default function DuoChat({ chat, role }) {
  const [draft, setDraft] = useState('')
  const bottom = useRef(null)
  useEffect(() => { if (chat.open) bottom.current?.scrollIntoView({ block:'nearest' }) }, [chat.messages.length, chat.open])
  async function submit(event) {
    event.preventDefault()
    const text = draft
    if (await chat.send(text)) setDraft(current => current === text ? '' : current)
  }
  return <aside aria-label="동행 채팅" onKeyDown={event => event.stopPropagation()}
    style={{ position:'fixed', right:16, bottom:16, zIndex:250, width:chat.open ? 'min(340px, calc(100vw - 32px))' : 'auto', fontFamily:'Nunito, sans-serif', color:'#3A2A14' }}>
    <button type="button" aria-expanded={chat.open} aria-controls="duo-chat-panel" onClick={chat.toggle}
      style={{ background:'#F5EDD8', border:'2px solid #C8A96E', borderRadius:12, padding:'10px 16px', cursor:'pointer' }}>
      동행 채팅 {chat.open ? '접기' : '열기'}{chat.unread > 0 ? ` (${chat.unread})` : ''}
    </button>
    {chat.open && <section id="duo-chat-panel" style={{ marginTop:8, background:'#F5EDD8', border:'2px solid #C8A96E', borderRadius:12, padding:12, boxShadow:'0 4px 24px #0003' }}>
      <p role="status" style={{ margin:'0 0 8px', fontSize:12 }}>{chat.expired ? '세션이 종료되어 채팅을 사용할 수 없어요.' : chat.connected ? '현재 초대 세션의 대화' : '채팅 연결 중…'}</p>
      <div role="log" aria-label="대화 내용" aria-live="polite" style={{ height:'min(260px, 35dvh)', overflowY:'auto', overflowWrap:'anywhere' }}>
        {!chat.messages.length && !chat.expired && <p style={{ fontSize:13 }}>동행 친구에게 메시지를 보내보세요.</p>}
        {chat.messages.map(message => <div key={message.id} style={{ margin:'8px 0', textAlign:message.sender_role === role ? 'right' : 'left' }}>
          <small>{message.sender_role === role ? '나' : '친구'}</small>
          <p style={{ margin:'3px 0', whiteSpace:'pre-wrap', padding:8, borderRadius:8, background:message.sender_role === role ? '#E0E8CB' : '#fff9ed' }}>{message.body}</p>
        </div>)}
        <div ref={bottom} />
      </div>
      {chat.connectionError && !chat.expired && <p role="alert" style={{ fontSize:12 }}>
        채팅 연결 또는 대화 조회에 실패했어요.
        <button type="button" onClick={chat.reconnect}>다시 연결</button>
      </p>}
      {chat.sendError && !chat.expired && <p role="alert" style={{ fontSize:12 }}>
        {chat.sendError === 'chat_rate_limited' ? '전송되지 않았어요. 잠시 후 다시 전송해주세요.' : '메시지 전송에 실패했어요. 입력한 내용은 유지됩니다. 다시 전송해주세요.'}
      </p>}
      <form onSubmit={submit} style={{ display:'flex', gap:6, marginTop:8 }}>
        <input onFocus={() => {
          // Release any movement key held while focus moved into the chat.
          for (const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d']) window.dispatchEvent(new KeyboardEvent('keyup', { key }))
        }} aria-label="채팅 메시지" value={draft} onChange={event => setDraft(event.target.value)} maxLength={1000} disabled={chat.expired || chat.sending}
          placeholder="메시지 입력" style={{ minWidth:0, flex:1, padding:8, border:'1px solid #C8A96E', borderRadius:6 }} />
        <button type="submit" disabled={chat.expired || chat.sending || !draft.trim()}>{chat.sending ? '전송 중' : '전송'}</button>
      </form>
    </section>}
  </aside>
}

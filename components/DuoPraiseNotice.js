'use client'

import { useEffect, useState } from 'react'

export default function DuoPraiseNotice({ notice }) {
  const [dismissedId, setDismissedId] = useState(null)
  useEffect(() => {
    if (!notice?.id) return
    const timer = window.setTimeout(() => setDismissedId(notice.id), 4500)
    return () => window.clearTimeout(timer)
  }, [notice?.id])
  if (!notice || notice.id === dismissedId) return null
  return <div role="status" aria-live="polite" aria-atomic="true" data-testid="duo-praise-notice"
    style={{ position:'fixed', top:80, left:'50%', transform:'translateX(-50%)', zIndex:260, pointerEvents:'none',
      maxWidth:'calc(100vw - 32px)', padding:'14px 20px', borderRadius:18, border:'2px solid #D58B9A',
      background:'#FFF1F4', color:'#793447', boxShadow:'0 6px 24px #0002', textAlign:'center', fontFamily:'Nunito, sans-serif' }}>
    <span aria-hidden="true" style={{ display:'block', fontSize:38, color:'#D95679', lineHeight:1.2 }}>♥</span>
    친구가 집을 칭찬했어요!
  </div>
}

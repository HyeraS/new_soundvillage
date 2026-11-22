'use client'

import { ZONE_META } from '@/components/GameEngine'
import { DUO_PROGRESS_MILESTONE, DUO_PROGRESS_ZONES, rankDuoVillageProgress } from '@/lib/duoProgress.mjs'
import styles from './DuoLeaderboard.module.css'

const formatPercent = new Intl.NumberFormat('ko-KR', { maximumFractionDigits:1 })

export default function DuoLeaderboard({ self, peer, notices, open, worldMap, onToggle }) {
  return <aside className={`${styles.leaderboard} ${worldMap ? styles.worldMap : ''}`} aria-label="동행 리더보드">
    <div className={styles.notices} role="status" aria-live="polite" aria-atomic="false">
      {notices.map(notice => <div className={styles.notice} key={notice.zone}>
        <span aria-hidden="true">{ZONE_META[notice.zone].emoji}</span>
        <span><strong>{notice.participantId}</strong> · {ZONE_META[notice.zone].label} 전사 {DUO_PROGRESS_MILESTONE}개 달성!</span>
      </div>)}
    </div>
    <button type="button" className={styles.toggle} aria-expanded={open} aria-controls="duo-leaderboard-panel" onClick={onToggle}>
      <span aria-hidden="true">🏆</span>
      동행 리더보드 {open ? '접기' : '열기'}
    </button>
    {open && <section id="duo-leaderboard-panel" className={styles.panel} aria-label="마을별 전사 진도">
      <h2 className={styles.heading}>마을별 전사 진도</h2>
      {!peer && <p className={styles.status}>상대의 진도를 기다리는 중이에요.</p>}
      <div className={styles.villages}>
        {DUO_PROGRESS_ZONES.map(zone => {
          const { label, emoji, color } = ZONE_META[zone]
          const rows = rankDuoVillageProgress(zone, self, peer)
          const hasLeader = rows.every(row => row.percent !== null) && rows[0].percent > rows[1].percent

          return <div key={zone} className={styles.village} style={{ '--village-color':color }}>
            <h3><span className={styles.icon} aria-hidden="true">{emoji}</span>{label}</h3>
            <ol>
              {rows.map((row, index) => {
                const isLeader = hasLeader && index === 0
                const name = row.participantId || (row.isSelf ? '나' : '상대')

                return <li key={row.isSelf ? 'self' : 'peer'} className={isLeader ? styles.leader : undefined}>
                  <div className={styles.row}>
                    <span className={styles.identity}>
                      {isLeader && <span role="img" aria-label="1위" className={styles.crown}>👑</span>}
                      <span className={styles.name} title={name}>{name}</span>
                      {row.isSelf && row.participantId && <small>나</small>}
                    </span>
                    <strong>{row.percent === null ? '—' : `${formatPercent.format(row.percent)}%`}</strong>
                  </div>
                  {row.percent !== null && <div className={styles.track} aria-hidden="true">
                    <span style={{ width:`${row.percent}%` }} />
                  </div>}
                </li>
              })}
            </ol>
          </div>
        })}
      </div>
    </section>}
  </aside>
}

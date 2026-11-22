'use client'

import { ZONE_META } from '@/components/GameEngine'
import { DUO_PROGRESS_MILESTONE, DUO_PROGRESS_ZONES, rankDuoVillageProgress } from '@/lib/duoProgress.mjs'
import styles from './DuoLeaderboard.module.css'

const formatPercent = new Intl.NumberFormat('ko-KR', { maximumFractionDigits:1 })

export default function DuoLeaderboard({ self, peer, notices, open, worldMap, onToggle }) {
  return <aside className={`${styles.leaderboard} ${worldMap ? styles.worldMap : ''}`} aria-label="동행 리더보드">
    <div role="status" aria-live="polite" aria-atomic="false">
      {notices.map(notice => <div className={styles.notice} key={notice.zone}>
        <strong>{notice.participantId}</strong> · {ZONE_META[notice.zone].label} 전사 {DUO_PROGRESS_MILESTONE}개 달성!
      </div>)}
    </div>
    <button type="button" className={styles.toggle} aria-expanded={open} aria-controls="duo-leaderboard-panel"
      onClick={onToggle}>
      동행 리더보드 {open ? '접기' : '열기'}
    </button>
    {open && <section id="duo-leaderboard-panel" className={styles.panel} aria-label="마을별 전사 진도">
      {!peer && <p className={styles.status}>상대의 진도를 기다리는 중이에요.</p>}
      <div className={styles.villages}>
        {DUO_PROGRESS_ZONES.map(zone => <div key={zone} className={styles.village}>
          <h3>{ZONE_META[zone].label}</h3>
          <ol>
            {rankDuoVillageProgress(zone, self, peer).map(row => <li key={row.isSelf ? 'self' : 'peer'}>
              <span className={styles.name}>
                {row.participantId || (row.isSelf ? '나' : '상대')}{row.isSelf && row.participantId ? ' (나)' : ''}
              </span>
              <strong>{row.percent === null ? '—' : `${formatPercent.format(row.percent)}%`}</strong>
            </li>)}
          </ol>
        </div>)}
      </div>
    </section>}
  </aside>
}

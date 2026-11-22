export const DUO_PROGRESS_ZONES = Object.freeze(['Animal', 'Human', 'Nature', 'Urban', 'Music', 'Lab'])
export const DUO_PROGRESS_MILESTONE_EVENT = 'progress-milestone'
export const DUO_PROGRESS_MILESTONE = 10
export const DUO_PROGRESS_NOTICE_MS = 10000

export function normalizeDuoProgress(participantId, progress) {
  if (typeof participantId !== 'string' || !participantId.trim() || participantId.length > 128
    || !progress?.zoneCounts || typeof progress.zoneCounts !== 'object') return null

  const zoneCounts = {}
  for (const zone of DUO_PROGRESS_ZONES) {
    const count = progress.zoneCounts[zone]
    if (!count) continue
    const { assigned, completed } = count
    if (!Number.isSafeInteger(assigned) || !Number.isSafeInteger(completed)
      || completed < 0 || completed > assigned) return null
    zoneCounts[zone] = { completed, assigned }
  }

  return { participantId, zoneCounts }
}

export function duoProgressMilestoneZone(zone, persistence) {
  if (!DUO_PROGRESS_ZONES.includes(zone) || !persistence?.annotationId
    || persistence.skipped || persistence.alreadyCompleted) return null
  const count = persistence.progress?.zoneCounts?.[zone]
  return count?.completed === DUO_PROGRESS_MILESTONE ? zone : null
}

export function rankDuoVillageProgress(zone, self, peer) {
  return [{ progress:self, isSelf:true }, { progress:peer, isSelf:false }]
    .map(({ progress, isSelf }) => {
      const { assigned, completed } = progress?.zoneCounts[zone] || {}
      return {
        isSelf,
        participantId: progress?.participantId,
        percent: assigned > 0 ? completed / assigned * 100 : null,
      }
    })
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))
}

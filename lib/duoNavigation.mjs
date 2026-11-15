export const DUO_VISITOR_FOLLOW_ACTIONS = Object.freeze({
  STAY:'stay',
  ENTER_SHARED_INTERIOR:'enter-shared-interior',
  LEAVE_SHARED_INTERIOR:'leave-shared-interior',
})

export const DUO_HOME_LOCATION_KEY = 'soundvillage-duo-v2-home-location'

export function resolveDuoPresenceScreen({ screen, visiting = false } = {}) {
  if (visiting || screen === 'house') return 'interior'
  if (screen === 'world') return 'worldmap'
  return 'waiting'
}

// Only explicit navigation changes a participant's screen, never peer movement.
export function resolveDuoVisitorFollowAction() {
  return DUO_VISITOR_FOLLOW_ACTIONS.STAY
}

export function resolveDuoRoomOwnerRole({ screen, visiting, role } = {}) {
  if (visiting) return ['host','visitor'].includes(visiting.ownerRole) ? visiting.ownerRole : null
  return screen === 'house' && ['host','visitor'].includes(role) ? role : null
}

export function isSameDuoInterior(roomOwnerRole, partnerPos) {
  return ['host','visitor'].includes(roomOwnerRole)
    && partnerPos?.screen === 'interior' && partnerPos.roomOwnerRole === roomOwnerRole
}

export function readDuoHomeLocation(storage, sessionId) {
  try {
    const value = JSON.parse(storage.getItem(DUO_HOME_LOCATION_KEY))
    if (value?.sessionId !== sessionId || !['world','house','friend'].includes(value.kind)) return null
    if (value.kind === 'friend' && !['host','visitor'].includes(value.ownerRole)) return null
    return value
  } catch { return null }
}

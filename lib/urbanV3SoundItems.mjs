import {
  EXIT_TRIGGER,
  PLAYER_FOOT_BOX,
  SPAWN_POINTS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  collidesPlacementAt,
  overlapsExitTrigger,
  reachablePlacementGridKeys,
} from './urbanV3WorldConfig.mjs'

export const URBAN_V3_SOUND_INTERACTION_RADIUS = 34

function overlapsExitInteraction({ x, y }) {
  // Avatar coordinates refer to the centre of the bottom edge of its foot box.
  const left = EXIT_TRIGGER.x - PLAYER_FOOT_BOX.w / 2
  const right = EXIT_TRIGGER.x + EXIT_TRIGGER.w + PLAYER_FOOT_BOX.w / 2
  const top = EXIT_TRIGGER.y
  const bottom = EXIT_TRIGGER.y + EXIT_TRIGGER.h + PLAYER_FOOT_BOX.h
  const nearestX = Math.max(left, Math.min(x, right))
  const nearestY = Math.max(top, Math.min(y, bottom))
  return Math.hypot(x - nearestX, y - nearestY) <= URBAN_V3_SOUND_INTERACTION_RADIUS
}

function hash32(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function buildCandidateSlots() {
  const reachable = reachablePlacementGridKeys(SPAWN_POINTS.entrance, 8)
  const spawns = Object.values(SPAWN_POINTS)
  const slots = []
  for (let y = 224; y <= WORLD_HEIGHT - 24; y += 16) {
    for (let x = 24; x <= WORLD_WIDTH - 24; x += 16) {
      if (!reachable.has(`${x},${y}`) || collidesPlacementAt(x, y) || overlapsExitTrigger({ x, y })) continue
      if (spawns.some((spawn) => Math.hypot(x - spawn.x, y - spawn.y) < 44)) continue
      slots.push(Object.freeze({ x, y }))
    }
  }
  return slots
}

const CANDIDATE_SLOTS = Object.freeze(buildCandidateSlots())
const SAFE_SLOTS = CANDIDATE_SLOTS.filter((slot) => !overlapsExitInteraction(slot))
export const URBAN_V3_SAFE_SOUND_SLOT_COUNT = SAFE_SLOTS.length

function spreadSlots(count, seed) {
  if (count > URBAN_V3_SAFE_SOUND_SLOT_COUNT) {
    throw new Error(`Urban V3 sound capacity exceeded (${URBAN_V3_SAFE_SOUND_SLOT_COUNT} safe slots for ${count} sounds)`)
  }
  const pool = CANDIDATE_SLOTS.map((slot) => ({
    ...slot,
    nearestDistanceSquared: Infinity,
    tie: hash32(`${seed}|${slot.x},${slot.y}`),
  }))
  const selected = []
  while (selected.length < count) {
    let bestIndex = 0
    for (let index = 1; index < pool.length; index += 1) {
      const candidate = pool[index]
      const best = pool[bestIndex]
      if (candidate.nearestDistanceSquared > best.nearestDistanceSquared
        || (candidate.nearestDistanceSquared === best.nearestDistanceSquared && candidate.tie < best.tie)) {
        bestIndex = index
      }
    }
    const chosen = pool.splice(bestIndex, 1)[0]
    selected.push(chosen)
    for (const candidate of pool) {
      const distanceSquared = (candidate.x - chosen.x) ** 2 + (candidate.y - chosen.y) ** 2
      candidate.nearestDistanceSquared = Math.min(candidate.nearestDistanceSquared, distanceSquared)
    }
  }
  // Keep the established layout and replace only placements that conflict with the exit.
  const occupied = new Set(selected.map(({ x, y }) => `${x},${y}`))
  return selected.map((slot) => {
    if (!overlapsExitInteraction(slot)) return slot
    let replacement
    let nearestDistance = Infinity
    for (const candidate of SAFE_SLOTS) {
      if (occupied.has(`${candidate.x},${candidate.y}`)) continue
      const distance = (candidate.x - slot.x) ** 2 + (candidate.y - slot.y) ** 2
      if (distance < nearestDistance) {
        replacement = candidate
        nearestDistance = distance
      }
    }
    occupied.add(`${replacement.x},${replacement.y}`)
    return replacement
  })
}

export function spawnUrbanV3SoundItems(sounds) {
  const sortedSounds = (sounds || []).slice().sort((left, right) => (
    (Number(left.block) || 1) - (Number(right.block) || 1)
      || String(left.sound_id).localeCompare(String(right.sound_id))
  ))
  const seed = sortedSounds.map((sound) => `${sound.sound_id}:${Number(sound.block) || 1}`).join('|')
  const slots = spreadSlots(sortedSounds.length, seed)
  return Object.freeze(sortedSounds.map((sound, index) => Object.freeze({
    id: sound.sound_id,
    sound,
    block: Number(sound.block) || 1,
    x: slots[index].x,
    y: slots[index].y,
    phase: (index * 2.399963229728653) % (Math.PI * 2),
  })))
}

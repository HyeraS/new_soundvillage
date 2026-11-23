// Display policy; authoritative reward calculation lives in migration 022.
// Total reward is 50, not the ordinary 5 plus 50. Keep SQL and this list in sync.
export const BONUS_ANNOTATION_POINTS = 50
export const BONUS_ANNOTATION_CATEGORIES = Object.freeze([
  "Bus",
  "Truck",
  "Tick",
  "Toilet flush",
  "Hi-hat",
  "Sink (filling or washing)",
  "Hiss",
  "Cowbell",
  "Squeak",
  "Typing",
  "Raindrop",
  "Chime",
  "Fireworks",
  "Insect",
  "Motor vehicle (road)",
  "Run",
  "Footstep",
  "Rain",
  "Applause",
  "Waves and surf"
])
const bonusCategories = new Set(BONUS_ANNOTATION_CATEGORIES.map(value => value.toLowerCase()))

export function isBonusAnnotationCategory(category) {
  return typeof category === 'string' && bonusCategories.has(category.trim().toLowerCase())
}

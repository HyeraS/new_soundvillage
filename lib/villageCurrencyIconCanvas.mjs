import { isBonusAnnotationCategory } from './annotationBonus.mjs'

export const VILLAGE_CURRENCY_ICON_SRC = Object.freeze({
  Animal: '/assets/economy/village-currencies/animal.png',
  Human: '/assets/economy/village-currencies/human.png',
  Nature: '/assets/economy/village-currencies/nature.png',
  Urban: '/assets/economy/village-currencies/urban.png',
  Music: '/assets/economy/village-currencies/music.png',
  Lab: '/assets/economy/village-currencies/lab.png',
})

// Preserve the original silhouette, shading and transparency; tint only its color.
export const GOLD_ANNOTATION_ICON_FILTER = 'grayscale(1) sepia(1) saturate(8) brightness(1.15)'

const imageCache = new Map()
const goldImageCache = new WeakMap()

// Recolor at runtime instead of relying on CanvasRenderingContext2D.filter,
// which is not supported in every browser. Preserve alpha and pixel geometry.
export function tintAnnotationIconGold(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue
    const light = (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255
    pixels[i] = Math.round(45 + 210 * Math.min(1, light / .7))
    pixels[i + 1] = Math.round(24 + 217 * light)
    pixels[i + 2] = Math.round(3 + 90 * Math.max(0, (light - .8) / .2))
  }
  return pixels
}

function getGoldIconImage(image) {
  if (goldImageCache.has(image)) return goldImageCache.get(image)
  if (typeof document === 'undefined') return image
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return image
  context.drawImage(image, 0, 0)
  const bitmap = context.getImageData(0, 0, canvas.width, canvas.height)
  tintAnnotationIconGold(bitmap.data)
  context.putImageData(bitmap, 0, 0)
  goldImageCache.set(image, canvas)
  return canvas
}

export function getVillageCurrencyIconImage(village) {
  const src = VILLAGE_CURRENCY_ICON_SRC[village]
  if (!src || typeof window === 'undefined') return null
  if (!imageCache.has(village)) {
    const image = new window.Image()
    image.decoding = 'async'
    image.src = src
    imageCache.set(village, image)
  }
  const image = imageCache.get(village)
  return image.complete && image.naturalWidth > 0 ? image : null
}

export function drawVillageCurrencyIcon(ctx, village, x, y, { size = 32, alpha = 1, gold = false } = {}) {
  const image = getVillageCurrencyIconImage(village)
  if (!image) return false
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(gold ? getGoldIconImage(image) : image, Math.round(x - size / 2), Math.round(y - size / 2), size, size)
  ctx.restore()
  return true
}

// Only collectible markers use this wrapper; wallet/currency art stays unchanged.
export function drawAnnotationMarkerIcon(ctx, village, item, x, y, { size = 32, alpha = 1 } = {}) {
  const gold = isBonusAnnotationCategory(item?.sound?.sub_category)
  const phase = Number(item?.phase) || 0
  const time = typeof performance === 'undefined' ? 0 : performance.now()
  const shimmer = .5 + .5 * Math.sin(time / 650 + phase)
  // Completed and locked icons stay subdued, following their existing opacity.
  const sparkling = gold && ctx.globalAlpha * alpha > .6
  if (sparkling) {
    ctx.save()
    ctx.globalAlpha *= alpha
    const radius = size * (.68 + shimmer * .08)
    const glow = ctx.createRadialGradient(x, y, size * .2, x, y, radius)
    glow.addColorStop(0, 'rgba(255,225,100,.34)')
    glow.addColorStop(.6, 'rgba(255,195,35,.16)')
    glow.addColorStop(1, 'rgba(255,195,35,0)')
    ctx.fillStyle = glow
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    ctx.restore()
  }
  const drawn = drawVillageCurrencyIcon(ctx, village, x, y, { size, alpha, gold })
  if (drawn && sparkling) {
    ctx.save()
    const baseAlpha = ctx.globalAlpha
    for (const [index, dx, dy] of [[0, -.36, -.35], [1, .4, -.12], [2, .05, .43]]) {
      const strength = Math.max(0, Math.sin(time / 420 + phase + index * 2.1)) ** 2
      const length = size * (.035 + strength * .085)
      const sx = Math.round(x + dx * size)
      const sy = Math.round(y + dy * size)
      ctx.globalAlpha = baseAlpha * alpha * strength * .9
      ctx.fillStyle = '#fff9d6'
      ctx.beginPath()
      ctx.moveTo(sx, sy - length)
      ctx.lineTo(sx + length * .25, sy - length * .25)
      ctx.lineTo(sx + length, sy)
      ctx.lineTo(sx + length * .25, sy + length * .25)
      ctx.lineTo(sx, sy + length)
      ctx.lineTo(sx - length * .25, sy + length * .25)
      ctx.lineTo(sx - length, sy)
      ctx.lineTo(sx - length * .25, sy - length * .25)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }
  return drawn
}

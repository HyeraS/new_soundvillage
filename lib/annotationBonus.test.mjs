import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BONUS_ANNOTATION_CATEGORIES, isBonusAnnotationCategory } from './annotationBonus.mjs'
import { drawAnnotationMarkerIcon, tintAnnotationIconGold, VILLAGE_CURRENCY_ICON_SRC } from './villageCurrencyIconCanvas.mjs'

test('all 20 bonus categories exist in metadata and match the DB policy', () => {
  const metadata = JSON.parse(readFileSync(new URL('../data/sound_metadata.json', import.meta.url)))
  const actual = new Set(metadata.sounds.map(sound => sound.sub_category))
  assert.equal(BONUS_ANNOTATION_CATEGORIES.length, 20)
  for (const category of BONUS_ANNOTATION_CATEGORIES) assert.ok(actual.has(category), category)
  const sql = readFileSync(new URL('../scripts/security/022_annotation_category_bonus.sql', import.meta.url), 'utf8')
  const sqlCategories = [...sql.split(']::text[]')[0].matchAll(/^    '([^']+)'/gm)].map(match => match[1])
  assert.deepEqual(sqlCategories, BONUS_ANNOTATION_CATEGORIES.map(value => value.toLowerCase()))
})

test('category matching handles case and spaces without granting related categories a bonus', () => {
  for (const category of BONUS_ANNOTATION_CATEGORIES) {
    assert.equal(isBonusAnnotationCategory(` ${category.toUpperCase()} `), true)
  }
  for (const category of [null, undefined, '', 'Wind chime', 'Truck_Bus', 'Walk and footsteps', 'Rainfall', 'Chme']) {
    assert.equal(isBonusAnnotationCategory(category), false, String(category))
  }
})

test('gold recoloring preserves transparency and shading while increasing gold saturation', () => {
  const pixels = new Uint8ClampedArray([100, 90, 80, 0, 40, 30, 20, 255, 190, 130, 70, 128, 255, 255, 255, 255])
  tintAnnotationIconGold(pixels)
  assert.deepEqual([...pixels.slice(0, 4)], [100, 90, 80, 0])
  assert.deepEqual([pixels[3], pixels[7], pixels[11], pixels[15]], [0, 255, 128, 255])
  assert.ok(pixels[4] < pixels[8] && pixels[8] <= pixels[12])
  assert.ok(pixels[9] > pixels[10] + 80)
  assert.ok(pixels[13] > pixels[14] + 100)
})

test('every village uses its own image; gold is cached and works without canvas filter', () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  let conversions = 0
  globalThis.window = { Image: class { complete = true; naturalWidth = 32; naturalHeight = 32 } }
  globalThis.document = { createElement() {
    const canvas = { getContext() { return {
      drawImage(image) { canvas.original = image },
      getImageData() { return { data: new Uint8ClampedArray([200, 160, 90, 255]) } },
      putImageData() { conversions++ },
    } } }
    return canvas
  } }
  try {
    for (const village of Object.keys(VILLAGE_CURRENCY_ICON_SRC)) {
      const draws = []
      const stack = []
      const ctx = {
        globalAlpha: .4, imageSmoothingEnabled: true,
        save() { stack.push([this.globalAlpha, this.imageSmoothingEnabled]) },
        restore() { [this.globalAlpha, this.imageSmoothingEnabled] = stack.pop() },
        drawImage(image) { draws.push(image) },
      }
      const bonus = { sound: { sub_category: 'Bus' } }
      assert.equal(drawAnnotationMarkerIcon(ctx, village, bonus, 10, 20), true)
      assert.equal(draws[0].original.src, VILLAGE_CURRENCY_ICON_SRC[village])
      drawAnnotationMarkerIcon(ctx, village, bonus, 10, 20)
      assert.equal(draws[1], draws[0])
      drawAnnotationMarkerIcon(ctx, village, { sound: { sub_category: 'Wind' } }, 10, 20)
      assert.equal(draws[2], draws[0].original)
      assert.equal(ctx.globalAlpha, .4)
    }
    assert.equal(conversions, 6)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BONUS_ANNOTATION_CATEGORIES, isBonusAnnotationCategory } from './annotationBonus.mjs'
import { drawAnnotationMarkerIcon, GOLD_ANNOTATION_ICON_FILTER, VILLAGE_CURRENCY_ICON_SRC } from './villageCurrencyIconCanvas.mjs'

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

test('bonus markers tint the original village image and restore canvas state', () => {
  const previousWindow = globalThis.window
  globalThis.window = { Image: class {
    complete = true
    naturalWidth = 32
  } }
  try {
    for (const village of Object.keys(VILLAGE_CURRENCY_ICON_SRC)) {
      const draws = []
      const stack = []
      const ctx = {
        globalAlpha: .4, filter: 'none', imageSmoothingEnabled: true,
        save() { stack.push([this.globalAlpha, this.filter, this.imageSmoothingEnabled]) },
        restore() { [this.globalAlpha, this.filter, this.imageSmoothingEnabled] = stack.pop() },
        drawImage(image) { draws.push({ src: image.src, filter: this.filter, alpha: this.globalAlpha }) },
      }
      assert.equal(drawAnnotationMarkerIcon(ctx, village, { sound: { sub_category: 'Bus' } }, 10, 20), true)
      assert.deepEqual(draws[0], { src: VILLAGE_CURRENCY_ICON_SRC[village], filter: GOLD_ANNOTATION_ICON_FILTER, alpha: .4 })
      assert.equal(ctx.filter, 'none')
      assert.equal(ctx.globalAlpha, .4)
      assert.equal(drawAnnotationMarkerIcon(ctx, village, { sound: { sub_category: 'Wind' } }, 10, 20), true)
      assert.equal(draws[1].src, draws[0].src)
      assert.equal(draws[1].filter, 'none')
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

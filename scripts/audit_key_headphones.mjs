import { readFileSync } from 'node:fs'

const iemsData = JSON.parse(readFileSync('app/public/data/iems.json', 'utf8')).iems
const hpData = JSON.parse(readFileSync('app/public/data/headphones.json', 'utf8')).iems

const jsonFiles = [
  'images.json',
  'images_search.json',
  'images_archive.json',
  'images_brand_a.json',
  'images_brand_b.json',
  'images_brand_c.json'
]

const mergedImages = {}
for (const j of jsonFiles) {
  try {
    const data = JSON.parse(readFileSync(`app/public/data/${j}`, 'utf8'))
    Object.assign(mergedImages, data)
  } catch {}
}

const reviewsData = JSON.parse(readFileSync('app/public/data/reviews.json', 'utf8'))
const allReviewedIds = new Set([
  ...Object.keys(reviewsData.reviews || {}),
  ...Object.keys(reviewsData.videos || {}),
  ...Object.keys(reviewsData.comments || {})
])

const KEY_HEADPHONES = [
  'sennheiser', 'hifiman', 'beyerdynamic', 'audio-technica', 'akg', 'focal', 'audeze',
  'sony', 'meze', 'dan clark', 'koss', 'grado', 'bose', 'apple', 'shure'
]

const missingHpByKey = []
for (const h of hpData) {
  const low = h.name.toLowerCase()
  const isKey = KEY_HEADPHONES.some(k => low.includes(k))
  if (isKey) {
    const hasImg = !!mergedImages[h.id]
    const hasRev = allReviewedIds.has(h.id)
    if (!hasImg || !hasRev) {
      missingHpByKey.push({ id: h.id, name: h.name, hasImg, hasRev })
    }
  }
}

console.log(`Key brand headphones with missing image or review: ${missingHpByKey.length}`)
const missingBoth = missingHpByKey.filter(h => !h.hasImg && !h.hasRev)
console.log(`Key brand headphones missing BOTH image and review: ${missingBoth.length}`)

// Group by brand
const byBrand = {}
for (const h of missingBoth) {
  const brand = KEY_HEADPHONES.find(k => h.name.toLowerCase().includes(k)) || 'other'
  byBrand[brand] = (byBrand[brand] || 0) + 1
}
console.log('Breakdown of missing both by brand:', byBrand)

console.log('\nTop 25 famous headphones missing BOTH image and review:')
for (const h of missingBoth.slice(0, 25)) {
  console.log(`- ${h.name} (id: ${h.id})`)
}


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

console.log('Total merged image entries:', Object.keys(mergedImages).length)

// Check IEMs
const iemWithImg = iemsData.filter(i => !!mergedImages[i.id])
const iemWithoutImg = iemsData.filter(i => !mergedImages[i.id])
const iemWithRev = iemsData.filter(i => allReviewedIds.has(i.id))
const iemWithoutRev = iemsData.filter(i => !allReviewedIds.has(i.id))

console.log(`\nIEMs (total ${iemsData.length}):`)
console.log(`  With image: ${iemWithImg.length} (${(iemWithImg.length / iemsData.length * 100).toFixed(1)}%)`)
console.log(`  Missing image: ${iemWithoutImg.length}`)
console.log(`  With reviews: ${iemWithRev.length}`)
console.log(`  Missing reviews: ${iemWithoutRev.length}`)

// Check Headphones
const hpWithImg = hpData.filter(i => !!mergedImages[i.id])
const hpWithoutImg = hpData.filter(i => !mergedImages[i.id])
const hpWithRev = hpData.filter(i => allReviewedIds.has(i.id))
const hpWithoutRev = hpData.filter(i => !allReviewedIds.has(i.id))

console.log(`\nHeadphones (total ${hpData.length}):`)
console.log(`  With image: ${hpWithImg.length} (${(hpWithImg.length / hpData.length * 100).toFixed(1)}%)`)
console.log(`  Missing image: ${hpWithoutImg.length}`)
console.log(`  With reviews: ${hpWithRev.length}`)
console.log(`  Missing reviews: ${hpWithoutRev.length}`)


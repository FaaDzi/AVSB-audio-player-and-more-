import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const iems = JSON.parse(readFileSync('app/public/data/iems.json', 'utf8')).iems
const hp = JSON.parse(readFileSync('app/public/data/headphones.json', 'utf8')).iems
const images = JSON.parse(readFileSync('app/public/data/images.json', 'utf8'))
const reviews = JSON.parse(readFileSync('app/public/data/reviews.json', 'utf8'))

const allImgFiles = new Set(readdirSync('app/public/img/iem').filter(f => f.endsWith('.webp')))
console.log('Total webp files on disk:', allImgFiles.size)

// Check which files on disk are referenced in images.json
const referencedFiles = new Set()
for (const [id, entry] of Object.entries(images)) {
  if (entry.src) {
    const filename = entry.src.split('/').pop()
    referencedFiles.add(filename)
  }
}

const unreferenced = [...allImgFiles].filter(f => !referencedFiles.has(f))
console.log('Images on disk NOT referenced in images.json:', unreferenced.length)
if (unreferenced.length > 0) {
  console.log('Sample unreferenced images on disk:', unreferenced.slice(0, 20))
}

// Now let's check how many Headphones in headphones.json have images vs missing
const hpWithImg = hp.filter(h => !!images[h.id])
const hpWithoutImg = hp.filter(h => !images[h.id])
console.log(`\nHeadphones in catalog: ${hp.length}`)
console.log(`Headphones with image: ${hpWithImg.length}`)
console.log(`Headphones missing image: ${hpWithoutImg.length}`)

// How many Headphones have reviews?
const allReviewedIds = new Set([
  ...Object.keys(reviews.reviews || {}),
  ...Object.keys(reviews.videos || {}),
  ...Object.keys(reviews.comments || {})
])
const hpWithRev = hp.filter(h => allReviewedIds.has(h.id))
const hpWithoutRev = hp.filter(h => !allReviewedIds.has(h.id))
console.log(`Headphones with reviews: ${hpWithRev.length}`)
console.log(`Headphones missing reviews: ${hpWithoutRev.length}`)


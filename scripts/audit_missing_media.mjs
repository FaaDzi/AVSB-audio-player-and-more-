import { readFileSync } from 'node:fs'

const iemsData = JSON.parse(readFileSync('app/public/data/iems.json', 'utf8'))
const hpData = JSON.parse(readFileSync('app/public/data/headphones.json', 'utf8'))
const images = JSON.parse(readFileSync('app/public/data/images.json', 'utf8'))
const reviewsData = JSON.parse(readFileSync('app/public/data/reviews.json', 'utf8')).reviews || {}

console.log('--- DATA COUNTS ---')
console.log('Total in iems.json:', iemsData.iems.length)
console.log('Total in headphones.json:', hpData.iems.length)
console.log('Total entries in images.json:', Object.keys(images).length)
console.log('Total entries in reviews.json:', Object.keys(reviewsData).length)

// Classify
const all = [
  ...iemsData.iems.map(i => ({ ...i, category: i.name.toLowerCase().includes('tws') || i.name.toLowerCase().includes('wireless') || i.name.toLowerCase().includes('buds') || i.name.toLowerCase().includes('airpods') ? 'tws' : 'iem' })),
  ...hpData.iems.map(i => ({ ...i, category: 'headphone' }))
]

let missingImg = 0
let missingRev = 0
let missingBoth = 0

const missingImgList = []
const missingRevList = []

for (const item of all) {
  const hasImg = !!images[item.id]
  const hasRev = !!reviewsData[item.id] && reviewsData[item.id].length > 0
  if (!hasImg) {
    missingImg++
    missingImgList.push(item)
  }
  if (!hasRev) {
    missingRev++
    missingRevList.push(item)
  }
  if (!hasImg && !hasRev) {
    missingBoth++
  }
}

console.log('\n--- COVERAGE SUMMARY ---')
console.log('Total catalog models:', all.length)
console.log('Missing Images:', missingImg, `(${(missingImg / all.length * 100).toFixed(1)}%)`)
console.log('Missing Reviews:', missingRev, `(${(missingRev / all.length * 100).toFixed(1)}%)`)
console.log('Missing Both:', missingBoth, `(${(missingBoth / all.length * 100).toFixed(1)}%)`)

// Let's filter out mods, prototypes, ciem, etc.
const POPULAR_BRANDS = [
  'sennheiser', 'sony', 'bose', 'apple', 'hifiman', 'beyerdynamic', 'audio-technica', 'akg', 'focal', 'audeze',
  'meze', 'dan clark', 'shure', 'koss', 'grado', 'moondrop', 'tangzu', 'truthear', '7hz', 'kiwi ears', 'thieaudio',
  'letshuoer', 'dunu', 'tanchjim', 'fiio', 'tin hifi', 'qdc', 'campfire', '64 audio', 'symphonium', 'subtonic',
  'elysian', 'westone', 'noble', 'final', 'etymotic', 'blon', 'kz', 'cca', 'soundpeats', 'samsung', 'anker',
  'nothing', 'jabra', 'jbl', 'beats'
]

function getBrand(name) {
  const lower = name.toLowerCase()
  for (const b of POPULAR_BRANDS) {
    if (lower.startsWith(b) || lower.includes(b)) return b
  }
  return null
}

const popularMissingImg = missingImgList.filter(i => {
  const brand = getBrand(i.name)
  const isMod = i.name.toLowerCase().includes('mod') || i.name.toLowerCase().includes('sample') || i.name.toLowerCase().includes('serial')
  return brand && !isMod
})

console.log('\nPopular brand models missing images:', popularMissingImg.length)

// Print top 30 popular models missing image
console.log('\nSample popular models missing image:')
for (const item of popularMissingImg.slice(0, 30)) {
  console.log(`- [${item.category.toUpperCase()}] ${item.name} (id: ${item.id})`)
}


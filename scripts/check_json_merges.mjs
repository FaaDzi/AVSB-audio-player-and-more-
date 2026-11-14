import { readFileSync, readdirSync } from 'node:fs'

const allImgFiles = new Set(readdirSync('app/public/img/iem').filter(f => f.endsWith('.webp')))

const jsonFiles = [
  'images.json',
  'images_search.json',
  'images_archive.json',
  'images_brand_a.json',
  'images_brand_b.json',
  'images_brand_c.json'
]

const maps = {}
for (const j of jsonFiles) {
  try {
    maps[j] = JSON.parse(readFileSync(`app/public/data/${j}`, 'utf8'))
    console.log(`${j}: ${Object.keys(maps[j]).length} entries`)
  } catch (e) {
    console.log(`Could not read ${j}:`, e.message)
  }
}

// Check which of the 702 unreferenced images are in images_search or other jsons
const inSearch = {}
const inBrand = {}
const inNone = []

for (const img of allImgFiles) {
  const rel = `img/iem/${img}`
  let foundIn = []
  for (const [j, data] of Object.entries(maps)) {
    for (const [id, entry] of Object.entries(data)) {
      if (entry.src === rel || entry.src === `/${rel}`) {
        foundIn.push(j)
        break
      }
    }
  }
  if (foundIn.length === 0) {
    inNone.push(img)
  }
}

console.log(`\nFiles on disk not referenced in ANY json file: ${inNone.length}`)
if (inNone.length > 0) {
  console.log('Sample files in none:', inNone.slice(0, 20))
}


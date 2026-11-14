import { readFileSync } from 'node:fs'

const rev = JSON.parse(readFileSync('app/public/data/reviews.json', 'utf8'))
console.log('Keys in reviews.json:', Object.keys(rev))
console.log('Count in rev.reviews (Jay):', Object.keys(rev.reviews || {}).length)
console.log('Count in rev.videos:', Object.keys(rev.videos || {}).length)
console.log('Count in rev.comments (other reviewers):', Object.keys(rev.comments || {}).length)

const allReviewed = new Set([
  ...Object.keys(rev.reviews || {}),
  ...Object.keys(rev.videos || {}),
  ...Object.keys(rev.comments || {})
])
console.log('Total unique models with ANY reviewer data:', allReviewed.size)

// Let's see who the reviewers are in rev.comments
const reviewerCounts = {}
for (const [id, list] of Object.entries(rev.comments || {})) {
  for (const c of list) {
    const name = c.reviewer || 'Unknown'
    reviewerCounts[name] = (reviewerCounts[name] || 0) + 1
  }
}
console.log('\nBreakdown of reviewers in rev.comments:', reviewerCounts)


// Run with: node --test utils/local/__tests__/matchLibrary.test.js
const test = require('node:test')
const assert = require('node:assert/strict')

const { needsMatch, matchLocalItems } = require('../matchLibrary')

function item(id, title, extra = {}) {
  return {
    id,
    isScanned: true,
    mediaType: 'book',
    coverContentUrl: extra.cover || null,
    media: { metadata: { title, authorName: extra.author || null, authors: extra.author ? [{ name: extra.author }] : [], description: extra.description || null, narrators: [], genres: [], series: null } }
  }
}

/** A fake provider that "knows" a few books. */
function fakeProvider(known) {
  return {
    name: 'fake',
    search: async (q) => known.filter((k) => k.title.toLowerCase() === q.title.toLowerCase())
  }
}

test('needsMatch: scanned books without a description only', () => {
  assert.equal(needsMatch(item('1', 'A')), true)
  assert.equal(needsMatch(item('2', 'B', { description: 'already' })), false)
  assert.equal(needsMatch({ ...item('3', 'C'), isScanned: false }), false) // downloaded from a server
  assert.equal(needsMatch({ ...item('4', 'D'), mediaType: 'podcast' }), false)
})

test('matches books, applies only the fields that are missing, and reports totals', async () => {
  const applied = []
  const res = await matchLocalItems([item('1', 'Dune', { author: 'Frank Herbert' }), item('2', 'Unknown Book'), item('3', 'Emma', { author: 'Jane Austen' })], {
    providers: [
      fakeProvider([
        { title: 'Dune', author: 'Frank Herbert', description: 'Spice.', publisher: 'Ace', cover: 'https://x/dune.jpg' },
        { title: 'Emma', author: 'Jane Austen', description: 'Matchmaking.' }
      ])
    ],
    apply: async (id, metadata) => applied.push({ id, metadata })
  })

  assert.deepEqual(res, { matched: 2, unmatched: 1, failed: 0, total: 3 })
  assert.equal(applied.length, 2)
  const dune = applied.find((a) => a.id === '1').metadata
  assert.equal(dune.description, 'Spice.')
  assert.equal(dune.coverUrl, 'https://x/dune.jpg')
  assert.equal(dune.title, undefined) // never replaces the folder-derived title
})

test('adds authorNameLF when authors are filled in', async () => {
  const applied = []
  await matchLocalItems([item('1', 'Dune')], {
    providers: [fakeProvider([{ title: 'Dune', author: 'Frank Herbert', description: 'Spice.' }])],
    apply: async (id, metadata) => applied.push(metadata)
  })
  assert.deepEqual(applied[0].authors, ['Frank Herbert'])
  assert.equal(applied[0].authorNameLF, 'Herbert, Frank')
})

test('one failing book does not stop the rest, and progress is reported', async () => {
  const progress = []
  let calls = 0
  const res = await matchLocalItems([item('1', 'Dune'), item('2', 'Emma'), item('3', 'Dune')], {
    providers: [fakeProvider([{ title: 'Dune', description: 'd' }, { title: 'Emma', description: 'e' }])],
    apply: async (id) => {
      calls++
      if (id === '2') throw new Error('disk full')
    },
    onProgress: (done, total) => progress.push([done, total]),
    concurrency: 1
  })
  assert.equal(res.failed, 1)
  assert.equal(res.matched, 2)
  assert.equal(calls, 3)
  assert.deepEqual(progress[progress.length - 1], [3, 3])
})

test('can be cancelled part-way', async () => {
  const seen = []
  let cancel = false
  await matchLocalItems([item('1', 'Dune'), item('2', 'Dune'), item('3', 'Dune')], {
    providers: [fakeProvider([{ title: 'Dune', description: 'd' }])],
    apply: async (id) => {
      seen.push(id)
      cancel = true
    },
    isCancelled: () => cancel,
    concurrency: 1
  })
  assert.deepEqual(seen, ['1'])
})

test('searches without a "Vol 1 -" prefix so numbered titles still match', async () => {
  const applied = []
  const res = await matchLocalItems([item('1', 'Vol 1 - Dune', { author: 'Frank Herbert' })], {
    providers: [fakeProvider([{ title: 'Dune', author: 'Frank Herbert', description: 'Spice.' }])],
    apply: async (id, metadata) => applied.push(metadata)
  })
  assert.equal(res.matched, 1)
  assert.equal(applied[0].description, 'Spice.')
})

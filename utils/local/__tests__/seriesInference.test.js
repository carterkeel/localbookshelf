// Run with: node --test utils/local/__tests__/seriesInference.test.js
const test = require('node:test')
const assert = require('node:assert/strict')

const { parseLeadingSequence, cleanTitleForSearch, inferSeriesFromAlbums } = require('../seriesInference')

function item(id, title, series) {
  return { id, media: { metadata: { title, series: series || null } } }
}

test('parseLeadingSequence: volume labels and numbered prefixes', () => {
  assert.deepEqual(parseLeadingSequence('Vol 1 - Thank You For Volunteering'), { sequence: '1', title: 'Thank You For Volunteering' })
  assert.deepEqual(parseLeadingSequence('Volume 2: Ayúdame'), { sequence: '2', title: 'Ayúdame' })
  assert.deepEqual(parseLeadingSequence('Book 3. The Third One'), { sequence: '3', title: 'The Third One' })
  assert.deepEqual(parseLeadingSequence('Episode 10 - Finale'), { sequence: '10', title: 'Finale' })
  assert.deepEqual(parseLeadingSequence('Vol. 0.5 - Prequel'), { sequence: '0.5', title: 'Prequel' })
  assert.deepEqual(parseLeadingSequence('12 - Twelve'), { sequence: '12', title: 'Twelve' })
})

test('parseLeadingSequence: titles that merely start with a number or word are left alone', () => {
  assert.deepEqual(parseLeadingSequence('101 Dalmatians'), { sequence: null, title: '101 Dalmatians' })
  assert.deepEqual(parseLeadingSequence('Bookends'), { sequence: null, title: 'Bookends' })
  assert.deepEqual(parseLeadingSequence('Volunteers'), { sequence: null, title: 'Volunteers' })
  assert.deepEqual(parseLeadingSequence(''), { sequence: null, title: '' })
  assert.deepEqual(parseLeadingSequence('Vol 4 -'), { sequence: null, title: 'Vol 4 -' }) // nothing after the label
})

test('cleanTitleForSearch strips only the volume prefix', () => {
  assert.equal(cleanTitleForSearch('Vol 7 - Luck Goes Both Ways'), 'Luck Goes Both Ways')
  assert.equal(cleanTitleForSearch('Dune'), 'Dune')
})

test('books sharing an album that is not their title become a series, in volume order', () => {
  const items = [item('a', 'Vol 1 - Thank You'), item('b', 'Vol 2 - Ayúdame'), item('c', 'Unrelated Book')]
  const updates = inferSeriesFromAlbums(items, { a: 'Dungeon Crawler Carl', b: 'Dungeon Crawler Carl', c: 'Something Else' })
  assert.deepEqual(updates, [
    { id: 'a', series: [{ name: 'Dungeon Crawler Carl', sequence: '1' }], title: 'Thank You' },
    { id: 'b', series: [{ name: 'Dungeon Crawler Carl', sequence: '2' }], title: 'Ayúdame' }
  ])
})

test('books without a volume number still join the series (no sequence, title untouched)', () => {
  const updates = inferSeriesFromAlbums([item('a', 'Alpha'), item('b', 'Beta')], { a: 'The Saga', b: 'The Saga' })
  assert.deepEqual(updates, [
    { id: 'a', series: [{ name: 'The Saga' }] },
    { id: 'b', series: [{ name: 'The Saga' }] }
  ])
})

test('a lone book, or a shared album that is the title of a member, is not a series', () => {
  assert.deepEqual(inferSeriesFromAlbums([item('a', 'Solo')], { a: 'Some Album' }), [])
  // two parts of one book whose album is the book title
  assert.deepEqual(inferSeriesFromAlbums([item('a', 'The Hobbit'), item('b', 'The Hobbit Part 2')], { a: 'The Hobbit', b: 'The Hobbit' }), [])
})

test('generic albums and books that already have a series are skipped', () => {
  const items = [item('a', 'A'), item('b', 'B'), item('c', 'C', [{ name: 'Existing', sequence: '1' }]), item('d', 'D')]
  assert.deepEqual(inferSeriesFromAlbums(items, { a: 'Audiobook', b: 'Audiobook', c: 'X', d: 'X' }), [])
})

test('album matching ignores case and "(Unabridged)"; missing albums are ignored', () => {
  const items = [item('a', 'One'), item('b', 'Two'), item('c', 'Three')]
  const updates = inferSeriesFromAlbums(items, { a: 'Big Saga (Unabridged)', b: 'big saga', c: undefined })
  assert.deepEqual(updates.map((u) => u.id), ['a', 'b'])
  assert.equal(updates[0].series[0].name, 'Big Saga')
})

// Run with: node --test utils/local/__tests__/organize.test.js
const test = require('node:test')
const assert = require('node:assert/strict')

const { organizeBySeries, organizeByAuthor } = require('../organize')

function book(title, { authors = [], authorName, series } = {}) {
  return {
    id: `local_${title}`,
    media: {
      metadata: {
        title,
        authors: authors.map((name) => ({ name })),
        authorName: authorName || authors.join(', ') || null,
        series: series ? [{ name: series[0], sequence: series[1] }] : null
      }
    }
  }
}

const library = [
  book('Words of Radiance', { authors: ['Brandon Sanderson'], series: ['Stormlight Archive', '2'] }),
  book('The Way of Kings', { authors: ['Brandon Sanderson'], series: ['Stormlight Archive', '1'] }),
  book('Oathbringer', { authors: ['Brandon Sanderson'], series: ['stormlight archive', '3'] }), // different casing, same series
  book('Edgedancer', { authors: ['Brandon Sanderson'], series: ['Stormlight Archive', '10'] }),
  book('Dune', { authors: ['Frank Herbert'] }),
  book('Good Omens', { authors: ['Terry Pratchett', 'Neil Gaiman'] }),
  book('Anonymous Tales')
]

test('series: grouped case-insensitively and in reading order (2 before 10)', () => {
  const { series } = organizeBySeries(library)
  assert.equal(series.length, 1)
  assert.equal(series[0].name, 'Stormlight Archive')
  assert.deepEqual(
    series[0].books.map((b) => b.media.metadata.title),
    ['The Way of Kings', 'Words of Radiance', 'Oathbringer', 'Edgedancer']
  )
})

test('series: books without a series are standalone, sorted by title', () => {
  const { standalone } = organizeBySeries(library)
  assert.deepEqual(
    standalone.map((b) => b.media.metadata.title),
    ['Anonymous Tales', 'Dune', 'Good Omens']
  )
})

test('series: fractional and missing sequences sort sensibly', () => {
  const items = [book('Book Two', { series: ['S', '2'] }), book('Prequel', { series: ['S', '0.5'] }), book('No Number', { series: ['S', ''] }), book('Book One', { series: ['S', '1'] })]
  const { series } = organizeBySeries(items)
  assert.deepEqual(
    series[0].books.map((b) => b.media.metadata.title),
    ['Prequel', 'Book One', 'Book Two', 'No Number']
  )
})

test('authors: sorted by last name, multi-author books appear under each author', () => {
  const authors = organizeByAuthor(library)
  assert.deepEqual(
    authors.map((a) => a.name),
    ['Neil Gaiman', 'Frank Herbert', 'Terry Pratchett', 'Brandon Sanderson', null]
  )
  assert.ok(authors.find((a) => a.name === 'Neil Gaiman').books.some((b) => b.media.metadata.title === 'Good Omens'))
  assert.ok(authors.find((a) => a.name === 'Terry Pratchett').books.some((b) => b.media.metadata.title === 'Good Omens'))
})

test('authors: a series is kept together in reading order, standalone books after it', () => {
  const sanderson = organizeByAuthor([...library, book('Elantris', { authors: ['Brandon Sanderson'] })]).find((a) => a.name === 'Brandon Sanderson')
  assert.deepEqual(
    sanderson.books.map((b) => b.media.metadata.title),
    ['The Way of Kings', 'Words of Radiance', 'Oathbringer', 'Edgedancer', 'Elantris']
  )
})

test('authors: books without an author are listed last under a null name', () => {
  const authors = organizeByAuthor(library)
  const last = authors[authors.length - 1]
  assert.equal(last.name, null)
  assert.deepEqual(
    last.books.map((b) => b.media.metadata.title),
    ['Anonymous Tales']
  )
})

test('falls back to authorName when there is no authors list, and handles empty input', () => {
  const authors = organizeByAuthor([book('Solo', { authorName: 'Jane Doe' })])
  assert.equal(authors[0].name, 'Jane Doe')
  assert.deepEqual(organizeByAuthor([]), [])
  assert.deepEqual(organizeBySeries([]), { series: [], standalone: [] })
})

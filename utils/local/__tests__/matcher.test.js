// Run with: node --test utils/local/__tests__/matcher.test.js
const test = require('node:test')
const assert = require('node:assert/strict')

const { createProviders, findBestMatch, buildMetadataUpdate, scoreResult, normalizeForCompare } = require('../matcher')
const { createHttp } = require('../http')

// ---- fixtures shaped like the Audnexus book response (https://api.audnex.us/books/{asin}) ----
const wayOfKings = {
  asin: 'B003ZWFO7E',
  title: 'The Way of Kings',
  subtitle: 'Book One of the Stormlight Archive',
  authors: [{ asin: 'B001IGFHW6', name: 'Brandon Sanderson' }],
  narrators: [{ name: 'Michael Kramer' }, { name: 'Kate Reading' }],
  publisherName: 'Macmillan Audio',
  summary: '<p>Roshar is a world of stone and storms.</p>',
  releaseDate: '2010-08-31T00:00:00.000Z',
  image: 'https://m.media-amazon.com/images/I/way-of-kings.jpg',
  genres: [
    { asin: '1', name: 'Science Fiction & Fantasy', type: 'genre' },
    { asin: '2', name: 'Epic', type: 'tag' }
  ],
  seriesPrimary: { asin: 'B0S1', name: 'The Stormlight Archive', position: 'Book 1' },
  language: 'english',
  runtimeLengthMin: 2727,
  formatType: 'unabridged',
  isbn: '9781427209238',
  region: 'us',
  isAdult: false
}
const wordsOfRadiance = { ...wayOfKings, asin: 'B00D1EKK2U', title: 'Words of Radiance', subtitle: 'Book Two of the Stormlight Archive', seriesPrimary: { asin: 'B0S1', name: 'The Stormlight Archive', position: '2' }, image: 'https://m.media-amazon.com/images/I/words.jpg' }
const unrelated = { ...wayOfKings, asin: 'B00UNRELAT', title: 'A Cookbook of Soups', authors: [{ name: 'Some Chef' }], seriesPrimary: undefined }

/** Mock http: routes the URLs the real providers build to fixtures, records every request. */
function mockHttp({ audibleProducts = [], audnexus = {}, google = [], failAll = false } = {}) {
  const calls = []
  return {
    calls,
    async get(url) {
      calls.push(url)
      if (failAll) throw new Error('network down')
      if (url.startsWith('https://api.audible.com/1.0/catalog/products')) return { data: { products: audibleProducts.map((asin) => ({ asin })) } }
      const m = url.match(/^https:\/\/api\.audnex\.us\/books\/([A-Z0-9]+)/)
      if (m) {
        if (!audnexus[m[1]]) throw new Error('404')
        return { data: audnexus[m[1]] }
      }
      if (url.startsWith('https://www.googleapis.com/books/v1/volumes')) return { data: { items: google } }
      throw new Error(`unexpected url ${url}`)
    }
  }
}

test('audible: search maps the Audnexus record to the app metadata shape', async () => {
  const http = mockHttp({ audibleProducts: ['B003ZWFO7E'], audnexus: { B003ZWFO7E: wayOfKings } })
  const [audible] = createProviders({ http })
  const [result] = await audible.search({ title: 'The Way of Kings', author: 'Brandon Sanderson' })

  assert.equal(result.title, 'The Way of Kings')
  assert.equal(result.author, 'Brandon Sanderson')
  assert.equal(result.narrator, 'Michael Kramer, Kate Reading')
  assert.equal(result.publishedYear, '2010')
  assert.equal(result.asin, 'B003ZWFO7E')
  assert.deepEqual(result.genres, ['Science Fiction & Fantasy'])
  assert.deepEqual(result.tags, ['Epic'])
  assert.equal(result.language, 'English')
  // "Book 1" is cleaned to "1" by the server's own logic
  assert.deepEqual(result.series, [{ series: 'The Stormlight Archive', sequence: '1' }])
  assert.ok(http.calls.some((u) => u.includes('title=The+Way+of+Kings') && u.includes('author=Brandon+Sanderson')))
})

test('findBestMatch picks the right book out of several results', async () => {
  const http = mockHttp({
    audibleProducts: ['B00UNRELAT', 'B00D1EKK2U', 'B003ZWFO7E'],
    audnexus: { B003ZWFO7E: wayOfKings, B00D1EKK2U: wordsOfRadiance, B00UNRELAT: unrelated }
  })
  const best = await findBestMatch({ title: 'The Way of Kings', author: 'Brandon Sanderson' }, createProviders({ http }))
  assert.equal(best.provider, 'audible')
  assert.equal(best.result.asin, 'B003ZWFO7E')
  assert.ok(best.score > 0.9)
})

test('an ASIN in the folder name is an exact match and skips the catalog search', async () => {
  const http = mockHttp({ audnexus: { B003ZWFO7E: wayOfKings } })
  const best = await findBestMatch({ title: 'Whatever the folder is called', asin: 'B003ZWFO7E' }, createProviders({ http }))
  assert.equal(best.result.asin, 'B003ZWFO7E')
  assert.equal(best.score, 1)
  assert.equal(http.calls.filter((u) => u.includes('catalog/products')).length, 0)
})

test('rejects results that do not look like the book (no false matches)', async () => {
  const http = mockHttp({ audibleProducts: ['B00UNRELAT'], audnexus: { B00UNRELAT: unrelated } })
  const best = await findBestMatch({ title: 'The Way of Kings', author: 'Brandon Sanderson' }, createProviders({ http }))
  assert.equal(best, null)
})

test('falls back to Google Books when Audible has nothing', async () => {
  const http = mockHttp({
    audibleProducts: [],
    google: [
      {
        id: 'g1',
        volumeInfo: {
          title: 'Some Print Only Novel',
          authors: ['Jane Doe'],
          publisher: 'Pub House',
          publisherDate: '1999-05-01',
          description: 'A story.',
          industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780000000002' }],
          categories: ['Fiction'],
          imageLinks: { thumbnail: 'http://books.google.com/cover.jpg' }
        }
      }
    ]
  })
  const best = await findBestMatch({ title: 'Some Print Only Novel', author: 'Jane Doe' }, createProviders({ http }))
  assert.equal(best.provider, 'google')
  assert.equal(best.result.isbn, '9780000000002')
  assert.equal(best.result.cover, 'https://books.google.com/cover.jpg') // upgraded to https
})

test('network failures never throw, they just mean no match', async () => {
  const best = await findBestMatch({ title: 'The Way of Kings' }, createProviders({ http: mockHttp({ failAll: true }) }))
  assert.equal(best, null)
})

test('buildMetadataUpdate only fills missing fields and never touches folder-derived title/authors', async () => {
  const http = mockHttp({ audibleProducts: ['B003ZWFO7E'], audnexus: { B003ZWFO7E: wayOfKings } })
  const { result } = await findBestMatch({ title: 'The Way of Kings', author: 'Brandon Sanderson' }, createProviders({ http }))

  const current = { title: 'The Way of Kings', authors: ['Brandon Sanderson'], narrators: ['Michael Kramer'], series: [{ name: 'Stormlight Archive', sequence: '1' }], hasCover: false }
  const update = buildMetadataUpdate(result, current)

  assert.equal(update.title, undefined)
  assert.equal(update.authors, undefined)
  assert.equal(update.narrators, undefined) // already known
  assert.equal(update.series, undefined) // already known (from the folder structure)
  assert.equal(update.description, '<p>Roshar is a world of stone and storms.</p>')
  assert.equal(update.publisher, 'Macmillan Audio')
  assert.equal(update.publishedYear, '2010')
  assert.equal(update.asin, 'B003ZWFO7E')
  assert.deepEqual(update.genres, ['Science Fiction & Fantasy'])
  assert.equal(update.coverUrl, 'https://m.media-amazon.com/images/I/way-of-kings.jpg')
})

test('buildMetadataUpdate adds series and authors for a bare book, and respects an existing cover', async () => {
  const update = buildMetadataUpdate(
    {
      title: 'Dune',
      author: 'Frank Herbert',
      narrator: 'Scott Brick, Orlagh Cassidy',
      series: [{ series: 'Dune Chronicles', sequence: '1' }],
      cover: 'https://example.com/dune.jpg'
    },
    { title: 'Dune', hasCover: true }
  )
  assert.deepEqual(update.authors, ['Frank Herbert'])
  assert.deepEqual(update.narrators, ['Scott Brick', 'Orlagh Cassidy'])
  assert.deepEqual(update.series, [{ name: 'Dune Chronicles', sequence: '1' }])
  assert.equal(update.coverUrl, undefined) // already has a cover
})

test('override replaces existing values including the title and cover', () => {
  const update = buildMetadataUpdate({ title: 'Matched Title', description: 'New', cover: 'https://example.com/c.jpg' }, { title: 'Old', description: 'Old', hasCover: true }, { override: true })
  assert.equal(update.title, 'Matched Title')
  assert.equal(update.description, 'New')
  assert.equal(update.coverUrl, 'https://example.com/c.jpg')
})

test('buildMetadataUpdate returns null when nothing would change', () => {
  assert.equal(buildMetadataUpdate({ title: 'X', description: 'Same' }, { description: 'Mine' }), null)
})

test('title comparison ignores noise and works for non-latin text', () => {
  assert.equal(normalizeForCompare('The Hobbit (Unabridged) [Book 1]'), 'the hobbit')
  assert.equal(normalizeForCompare('Café: Ünïcode!'), 'cafe unicode')
  assert.notEqual(normalizeForCompare('吾輩は猫である'), '') // not stripped away
  assert.ok(scoreResult({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }, { title: 'The Hobbit (Unabridged)', author: 'J R R Tolkien' }) > 0.9)
})

test('http adapter rejects on HTTP errors like axios and parses JSON strings', async () => {
  const ok = createHttp({ get: async () => ({ status: 200, data: '{"a":1}' }) })
  assert.deepEqual((await ok.get('https://x')).data, { a: 1 })
  const bad = createHttp({ get: async () => ({ status: 404, data: {} }) })
  await assert.rejects(() => bad.get('https://x'), /404/)
})

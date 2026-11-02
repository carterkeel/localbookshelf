// Run with: node --test utils/local/__tests__/buildScanItems.test.js
const test = require('node:test')
const assert = require('node:assert/strict')

const { buildScanItems } = require('../buildScanItems')

/** Build a listing like AbsFileSystem.listFolderFiles returns, from plain relative paths. */
function listingFrom(paths) {
  const files = []
  const dirs = {}
  for (const p of paths) {
    const parts = p.split('/')
    const name = parts.pop()
    const dot = name.lastIndexOf('.')
    files.push({
      name,
      reldirpath: parts.join('/'),
      extension: dot > 0 ? name.slice(dot) : '',
      deep: parts.length,
      contentUrl: `content://tree/${encodeURIComponent(p)}`,
      size: 1000,
      mimeType: 'audio/mpeg'
    })
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      dirs[d] = `content://tree/${encodeURIComponent(d)}`
    }
  }
  return { files, dirs }
}

const library = listingFrom([
  'notes.txt', // ignored: not media
  'Standalone Book.m4b', // single audio file in the root
  'Frank Herbert/Dune/Dune.m4b',
  'Frank Herbert/Dune/cover.jpg',
  'Brandon Sanderson/Stormlight Archive/Book 1 - The Way of Kings {Michael Kramer & Kate Reading}/Part 10.mp3',
  'Brandon Sanderson/Stormlight Archive/Book 1 - The Way of Kings {Michael Kramer & Kate Reading}/Part 02.mp3',
  'Brandon Sanderson/Stormlight Archive/Book 1 - The Way of Kings {Michael Kramer & Kate Reading}/folder.jpg',
  'Jane Doe/Multi Disc/Disc 1/a.mp3',
  'Jane Doe/Multi Disc/Disc 2/a.mp3',
  'Empty Folder/readme.txt' // a folder without audio is not a book
])

test('finds one book per audiobook folder or root file, in stable order', () => {
  const items = buildScanItems(library)
  assert.deepEqual(
    items.map((i) => i.relPath),
    [
      'Brandon Sanderson/Stormlight Archive/Book 1 - The Way of Kings {Michael Kramer & Kate Reading}',
      'Frank Herbert/Dune',
      'Jane Doe/Multi Disc',
      'Standalone Book.m4b'
    ]
  )
})

test('parses author, series, sequence, narrators and title like the server', () => {
  const sanderson = buildScanItems(library)[0]
  assert.equal(sanderson.title, 'The Way of Kings')
  assert.deepEqual(sanderson.authors, ['Brandon Sanderson'])
  assert.equal(sanderson.authorNameLF, 'Sanderson, Brandon')
  assert.deepEqual(sanderson.narrators, ['Michael Kramer', 'Kate Reading'])
  assert.equal(sanderson.seriesName, 'Stormlight Archive')
  assert.equal(sanderson.seriesSequence, '1')
})

test('a book without a series folder has no series', () => {
  const dune = buildScanItems(library).find((i) => i.relPath === 'Frank Herbert/Dune')
  assert.equal(dune.title, 'Dune')
  assert.deepEqual(dune.authors, ['Frank Herbert'])
  assert.equal(dune.seriesName, undefined)
  assert.equal(dune.seriesSequence, undefined)
})

test('a single audio file in the library root is a book titled after the file (no extension)', () => {
  const single = buildScanItems(library).find((i) => i.relPath === 'Standalone Book.m4b')
  assert.equal(single.title, 'Standalone Book')
  assert.equal(single.authors, undefined)
  assert.equal(single.files.length, 1)
  assert.equal(single.files[0].name, 'Standalone Book.m4b')
  assert.equal(single.contentUrl, single.files[0].contentUrl)
})

test('keeps covers with their book and uses paths relative to the book folder', () => {
  const dune = buildScanItems(library).find((i) => i.relPath === 'Frank Herbert/Dune')
  assert.deepEqual(dune.files.map((f) => f.relPath).sort(), ['Dune.m4b', 'cover.jpg'])
  assert.equal(dune.contentUrl, `content://tree/${encodeURIComponent('Frank Herbert/Dune')}`)
})

test('multi-disc books keep disc sub-folders in the file paths', () => {
  const multi = buildScanItems(library).find((i) => i.relPath === 'Jane Doe/Multi Disc')
  assert.deepEqual(multi.files.map((f) => f.relPath).sort(), ['Disc 1/a.mp3', 'Disc 2/a.mp3'])
})

test('never sends null or empty fields to the native layer', () => {
  const json = JSON.stringify(buildScanItems(library))
  assert.equal(json.includes('null'), false)
  assert.equal(json.includes('""'), false)
})

test('ignores non-audio stray files and empty input', () => {
  assert.deepEqual(buildScanItems({ files: [], dirs: {} }), [])
  assert.deepEqual(buildScanItems(undefined), [])
  const onlyText = listingFrom(['readme.txt', 'Folder/notes.nfo'])
  assert.deepEqual(buildScanItems(onlyText), [])
})

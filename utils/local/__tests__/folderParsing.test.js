// Run with: node --test utils/local/__tests__/
const test = require('node:test')
const assert = require('node:assert/strict')
const Path = require('path')

const fp = require('../folderParsing')
const parseNameString = require('../parsers/parseNameString')
const parseSeriesString = require('../parsers/parseSeriesString')

test('groupFileItemsIntoLibraryItemDirs: matches the server test vector', () => {
  // Verbatim from advplyr/audiobookshelf test/server/utils/scandir.test.js
  const filePaths = [
    'randomfile.txt', // Should be ignored because it's not a book media file
    'Book1.m4b', // Root single file audiobook
    'Book2/audiofile.m4b',
    'Book2/disk 001/audiofile.m4b',
    'Book2/disk 002/audiofile.m4b',
    'Author/Book3/audiofile.mp3',
    'Author/Book3/Disc 1/audiofile.mp3',
    'Author/Book3/Disc 2/audiofile.mp3',
    'Author/Series/Book4/cover.jpg',
    'Author/Series/Book4/CD1/audiofile.mp3',
    'Author/Series/Book4/CD2/audiofile.mp3',
    'Author/Series2/Book5/deeply/nested/cd 01/audiofile.mp3',
    'Author/Series2/Book5/deeply/nested/cd 02/audiofile.mp3',
    'Author/Series2/Book5/randomfile.js' // Should be ignored because it's not a book media file
  ]
  const fileItems = filePaths.map((filePath) => {
    const dirname = Path.dirname(filePath)
    return {
      name: Path.basename(filePath),
      reldirpath: dirname === '.' ? '' : dirname,
      extension: Path.extname(filePath),
      deep: filePath.split('/').length - 1
    }
  })

  assert.deepEqual(fp.groupFileItemsIntoLibraryItemDirs('book', fileItems, false), {
    'Book1.m4b': 'Book1.m4b',
    Book2: ['audiofile.m4b', 'disk 001/audiofile.m4b', 'disk 002/audiofile.m4b'],
    'Author/Book3': ['audiofile.mp3', 'Disc 1/audiofile.mp3', 'Disc 2/audiofile.mp3'],
    'Author/Series/Book4': ['CD1/audiofile.mp3', 'CD2/audiofile.mp3', 'cover.jpg'],
    'Author/Series2/Book5/deeply/nested': ['cd 01/audiofile.mp3', 'cd 02/audiofile.mp3']
  })
})

test('getSequence: examples documented in the server source', () => {
  const cases = [
    ['Book 2 - Title - Subtitle', 'Title - Subtitle', '2'],
    ['Title - Subtitle - Vol 12', 'Title - Subtitle', '12'],
    ['Title - volume 9 - Subtitle', 'Title - Subtitle', '9'],
    ['Vol. 3 Title Here - Subtitle', 'Title Here - Subtitle', '3'],
    ['1980 - Book 2 - Title', '1980 - Title', '2'],
    ['Volume 12. Title - Subtitle', 'Title - Subtitle', '12'],
    ['100 - Book Title', 'Book Title', '100'],
    ['6. Title', 'Title', '6'],
    ['0.5 - Book Title', 'Book Title', '0.5'],
    ['101 Dalmations', '101 Dalmations', null] // title starting with a number is not a sequence
  ]
  for (const [input, rest, seq] of cases) {
    assert.deepEqual(fp.getSequence(input), [rest, seq], input)
  }
})

test('getBookDataFromDir: /Author/Series/Title layout', () => {
  const r = fp.getBookDataFromDir('Brandon Sanderson/Stormlight Archive/Book 1 - The Way of Kings {Michael Kramer & Kate Reading}')
  assert.deepEqual(r, {
    title: 'The Way of Kings',
    subtitle: null,
    asin: null,
    authors: ['Brandon Sanderson'],
    narrators: ['Michael Kramer', 'Kate Reading'],
    seriesName: 'Stormlight Archive',
    seriesSequence: '1',
    publishedYear: null
  })
})

test('getBookDataFromDir: /Author/Title has no series', () => {
  const r = fp.getBookDataFromDir('Frank Herbert/Dune')
  assert.equal(r.title, 'Dune')
  assert.deepEqual(r.authors, ['Frank Herbert'])
  assert.equal(r.seriesName, null)
  assert.equal(r.seriesSequence, null)
})

test('getBookDataFromDir: title only', () => {
  const r = fp.getBookDataFromDir('Some Standalone Book')
  assert.equal(r.title, 'Some Standalone Book')
  assert.deepEqual(r.authors, [])
  assert.equal(r.seriesName, null)
})

test('getBookDataFromDir: year, ASIN and subtitle', () => {
  const withYear = fp.getBookDataFromDir('Jane Doe/Some Series/2005 - Book 3 - Great Title')
  assert.equal(withYear.publishedYear, '2005')
  assert.equal(withYear.seriesSequence, '3')
  assert.equal(withYear.title, 'Great Title')

  const withAsin = fp.getBookDataFromDir('Jane Doe/Great Title [B0015T963C]')
  assert.equal(withAsin.asin, 'B0015T963C')
  assert.equal(withAsin.title, 'Great Title')

  const withSubtitle = fp.getBookDataFromDir('Jane Doe/Great Title - A Subtitle', true)
  assert.equal(withSubtitle.title, 'Great Title')
  assert.equal(withSubtitle.subtitle, 'A Subtitle')
})

test('file type helpers', () => {
  assert.equal(fp.isAudioFile('01 Chapter.MP3'), true)
  assert.equal(fp.isAudioFile('book.m4b'), true)
  assert.equal(fp.isAudioFile('cover.jpg'), false)
  assert.equal(fp.isEbookFile('book.epub'), true)
  assert.equal(fp.isImageFile('folder.JPG'), true)
  assert.equal(fp.getExtension('noextension'), '')
})

test('name and series parsers behave like the server', () => {
  assert.deepEqual(parseNameString.parse('Friedman, Milton & Friedman, Rose').names, ['Milton Friedman', 'Rose Friedman'])
  assert.deepEqual(parseNameString.parse('Jon Smith, Jane Smith').names, ['Jon Smith', 'Jane Smith'])
  assert.deepEqual(parseSeriesString.parse('Name #1a'), { name: 'Name', sequence: '1a' })
  assert.deepEqual(parseSeriesString.parse('Name'), { name: 'Name', sequence: null })
})

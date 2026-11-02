// Organises the books of the standalone library the way the server's Series and Authors views do:
// books grouped into series (in reading order) and by author.
const { nameToLastFirst } = require('./parsers/parseNameString')

function metadataOf(item) {
  return item?.media?.metadata || {}
}

function titleOf(item) {
  return metadataOf(item).title || ''
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
}

/** "2" < "10", "0.5" < "1", and a missing or non-numeric sequence sorts last. */
function sequenceNumber(sequence) {
  const n = parseFloat(sequence)
  return Number.isNaN(n) ? Infinity : n
}

function primarySeries(item) {
  const series = metadataOf(item).series
  return Array.isArray(series) && series[0]?.name ? series[0] : null
}

function authorNamesOf(item) {
  const md = metadataOf(item)
  const names = (md.authors || []).map((a) => a?.name).filter(Boolean)
  if (names.length) return names
  return md.authorName ? [md.authorName] : []
}

/**
 * @param {object[]} items LocalLibraryItems
 * @returns {{ series: {name: string, books: object[]}[], standalone: object[] }}
 *   series sorted by name with books in reading order; books not in a series sorted by title
 */
function organizeBySeries(items) {
  const bySeries = new Map() // lowercased name -> { name, entries }
  const standalone = []

  for (const item of items) {
    const series = primarySeries(item)
    if (!series) {
      standalone.push(item)
      continue
    }
    const key = series.name.trim().toLowerCase()
    if (!bySeries.has(key)) bySeries.set(key, { name: series.name.trim(), entries: [] })
    bySeries.get(key).entries.push({ item, sequence: sequenceNumber(series.sequence) })
  }

  const series = [...bySeries.values()]
    .map(({ name, entries }) => ({
      name,
      books: entries.sort((a, b) => (a.sequence === b.sequence ? compareText(titleOf(a.item), titleOf(b.item)) : a.sequence - b.sequence)).map((e) => e.item)
    }))
    .sort((a, b) => compareText(a.name, b.name))

  return { series, standalone: standalone.sort((a, b) => compareText(titleOf(a), titleOf(b))) }
}

/**
 * Books grouped under each of their authors (a book with two authors appears under both).
 * Authors are sorted by last name; books without an author come last.
 *
 * @param {object[]} items LocalLibraryItems
 * @returns {{ name: string|null, books: object[] }[]} name is null for books without an author
 */
function organizeByAuthor(items) {
  const byAuthor = new Map() // lowercased name -> { name, books }
  const unknown = []

  for (const item of items) {
    const names = authorNamesOf(item)
    if (!names.length) {
      unknown.push(item)
      continue
    }
    for (const name of names) {
      const key = name.trim().toLowerCase()
      if (!byAuthor.has(key)) byAuthor.set(key, { name: name.trim(), books: [] })
      byAuthor.get(key).books.push(item)
    }
  }

  const bookOrder = (a, b) => {
    const sa = primarySeries(a)
    const sb = primarySeries(b)
    // series books first, grouped by series and in reading order; then standalone books by title
    if (sa && sb) {
      const byName = compareText(sa.name, sb.name)
      if (byName !== 0) return byName
      const bySeq = sequenceNumber(sa.sequence) - sequenceNumber(sb.sequence)
      if (bySeq !== 0 && !Number.isNaN(bySeq)) return bySeq
    } else if (sa || sb) {
      return sa ? -1 : 1
    }
    return compareText(titleOf(a), titleOf(b))
  }

  const authors = [...byAuthor.values()]
    .map((a) => ({ name: a.name, books: a.books.sort(bookOrder) }))
    .sort((a, b) => compareText(nameToLastFirst(a.name) || a.name, nameToLastFirst(b.name) || b.name))

  if (unknown.length) authors.push({ name: null, books: unknown.sort((a, b) => compareText(titleOf(a), titleOf(b))) })
  return authors
}

module.exports = { organizeBySeries, organizeByAuthor }

// Works out which scanned books belong together in a series when the folder names do not say so.
//
// The server reads series from file tags and metadata files. On the device we use what is
// available: the album tag of the audio files, and "Vol 1 - " style prefixes in the book title.
// Online matches (Audible) set the series first; this only fills in books that still have none.

// "Vol 1 - Title", "Volume 2: Title", "Book 3. Title", "Part 4 - Title", "Episode 5 - Title", "Ep. 6 Title"
// "1 - Title" or "2. Title" (a bare number needs the separator so "101 Dalmatians" is left alone)
const LABELLED = /^(?:vol(?:ume)?|book|part|episode|ep)\.?\s*(\d{1,3}(?:\.\d{1,2})?)\s*[-:.]?\s+(?=[\p{L}\p{N}])/iu
const BARE = /^(\d{1,3}(?:\.\d{1,2})?)\s*(?:-|:|\.)\s+(?=[\p{L}\p{N}])/u

// Albums that say nothing about a series
const GENERIC_ALBUMS = new Set(['', 'unknown', 'unknown album', 'audiobook', 'audiobooks', 'untitled', 'various', 'books', 'podcast'])

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(unabridged|abridged|audiobook)\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split a leading volume number off a title.
 * @param {string} title
 * @returns {{ sequence: string|null, title: string }}
 */
function parseLeadingSequence(title) {
  const text = String(title || '').trim()
  const match = text.match(LABELLED) || text.match(BARE)
  if (!match) return { sequence: null, title: text }
  const sequence = Number(match[1]).toString()
  const rest = text.slice(match[0].length).trim()
  return { sequence, title: rest || text }
}

/** The title to search metadata providers with: no "Vol 1 -" / "Episode 3:" prefix. */
function cleanTitleForSearch(title) {
  return parseLeadingSequence(title).title
}

function hasSeries(item) {
  const series = item?.media?.metadata?.series
  return Array.isArray(series) && series.some((s) => s?.name)
}

function cleanAlbumName(album) {
  return String(album || '')
    .replace(/\s*[(\[]\s*(?:un)?abridged\s*[)\]]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {object[]} items LocalLibraryItems (as returned by the native layer)
 * @param {Record<string, string>} albums album tag of each book, by item id (from the scan)
 * @returns {{ id: string, series: {name: string, sequence?: string}[], title?: string }[]}
 *   updates to apply: books that share an album which is not just their own title form a series.
 *   `title` is only present when a "Vol 1 -" prefix was removed from it.
 */
function inferSeriesFromAlbums(items, albums) {
  const groups = new Map() // normalized album -> { name, books[] }
  for (const item of items || []) {
    const md = item?.media?.metadata
    const album = cleanAlbumName(albums?.[item?.id])
    const key = normalize(album)
    if (!md?.title || hasSeries(item) || GENERIC_ALBUMS.has(key)) continue
    if (!groups.has(key)) groups.set(key, { name: album, books: [], albumIsATitle: false })
    const group = groups.get(key)
    group.books.push(item)
    // The album is just the name of the book (normal for single books): not a series
    if (normalize(md.title) === key || normalize(parseLeadingSequence(md.title).title) === key) group.albumIsATitle = true
  }

  const updates = []
  for (const group of groups.values()) {
    if (group.books.length < 2 || group.albumIsATitle) continue
    for (const item of group.books) {
      const parsed = parseLeadingSequence(item.media.metadata.title)
      const update = { id: item.id, series: [parsed.sequence ? { name: group.name, sequence: parsed.sequence } : { name: group.name }] }
      if (parsed.sequence && parsed.title !== item.media.metadata.title) update.title = parsed.title
      updates.push(update)
    }
  }
  return updates
}

module.exports = { parseLeadingSequence, cleanTitleForSearch, inferSeriesFromAlbums }

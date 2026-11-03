// Metadata matching for the standalone library: search the metadata providers for a book,
// pick the best result and work out which fields to fill in.
//
// The providers (providers/audible.js, providers/googleBooks.js) are ported from the audiobookshelf
// server. The ranking and "fill only what is missing" policy below are this app's own, modelled on
// the server's quick match (server/scanner/Scanner.js quickMatchBookBuildUpdatePayload), which
// also only fills missing fields unless told to override.
const Audible = require('./providers/audible')
const GoogleBooks = require('./providers/googleBooks')
const { levenshteinSimilarity } = require('./levenshtein')

// Built at runtime so the unicode property escapes never reach the bundler's regex parser.
const NON_WORD = new RegExp('[^\\p{L}\\p{N}\\s]', 'gu')

/** Lowercase, strip accents, "(Unabridged)"-style noise and punctuation. Works for non-latin text too. */
function normalizeForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(unabridged|abridged|audiobook)\b/g, ' ')
    .replace(NON_WORD, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function authorSimilarity(queryAuthor, resultAuthor) {
  if (!resultAuthor) return 0.5 // nothing to compare: neutral, neither helps nor hurts
  const q = normalizeForCompare(queryAuthor)
  const candidates = [resultAuthor, ...String(resultAuthor).split(',')].map(normalizeForCompare).filter(Boolean)
  return Math.max(0, ...candidates.map((c) => levenshteinSimilarity(q, c)))
}

/**
 * @param {object} result a cleaned provider result
 * @param {{title: string, author?: string, asin?: string}} query
 * @returns {number} 0..1
 */
function scoreResult(result, query) {
  if (query.asin && result.asin && String(result.asin).toUpperCase() === String(query.asin).toUpperCase()) return 1
  const queryTitle = normalizeForCompare(query.title)
  // A result's "title" may or may not include the subtitle, so compare both
  const titleScore = Math.max(levenshteinSimilarity(queryTitle, normalizeForCompare(result.title)), result.subtitle ? levenshteinSimilarity(queryTitle, normalizeForCompare(`${result.title} ${result.subtitle}`)) : 0)
  if (!query.author) return titleScore
  return titleScore * 0.7 + authorSimilarity(query.author, result.author) * 0.3
}

/**
 * @param {{ http: {get: Function}, logger?: object, region?: string }} deps
 * @returns {{name: string, search: (query: object) => Promise<object[]>}[]} in priority order
 */
function createProviders({ http, logger, region = 'us' }) {
  const audible = new Audible({ http, logger })
  const google = new GoogleBooks({ http, logger })
  return [
    { name: 'audible', search: (q) => audible.search(q.title, q.author, q.asin, region) },
    { name: 'google', search: (q) => google.search(q.title, q.author) }
  ]
}

/**
 * Search providers in order and return the best result that is similar enough to the query.
 * Stops early when a provider returns a confident match.
 *
 * @param {{title: string, author?: string, asin?: string}} query
 * @param {{name: string, search: Function}[]} providers
 * @param {{ minScore?: number, confidentScore?: number }} [options]
 * @returns {Promise<{provider: string, result: object, score: number}|null>}
 */
async function findBestMatch(query, providers, options = {}) {
  const minScore = options.minScore ?? 0.65
  const confidentScore = options.confidentScore ?? 0.9
  if (!query?.title) return null

  let best = null
  for (const provider of providers) {
    let results = []
    try {
      results = (await provider.search(query)) || []
    } catch (error) {
      continue // one provider failing must not stop the others
    }
    for (const result of results) {
      if (!result?.title) continue
      const score = scoreResult(result, query)
      if (!best || score > best.score) best = { provider: provider.name, result, score }
    }
    if (best && best.score >= confidentScore) break
  }
  return best && best.score >= minScore ? best : null
}

/**
 * Provider descriptions (Audible, Google Books) are HTML from a third party and the item page shows
 * descriptions as HTML. Store plain text only: tags are removed (line breaks kept) and only harmless
 * entities are decoded, so text like "&lt;script&gt;" can never turn back into a tag.
 */
function descriptionToText(value) {
  if (value === undefined || value === null) return value
  return String(value)
    .replace(/<\s*(?:script|style)\b[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

function splitNames(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * Work out which fields a match should write. By default only fields that are currently empty are
 * filled, so titles/authors/series that came from the user's own folder names are never replaced.
 *
 * @param {object} match a provider result
 * @param {{title?: string, subtitle?: string, authors?: string[], narrators?: string[], description?: string, publisher?: string, publishedYear?: string, genres?: string[], language?: string, asin?: string, isbn?: string, series?: object[], hasCover?: boolean}} current
 * @param {{ override?: boolean }} [options]
 * @returns {object|null} payload for AbsFileSystem.applyLocalItemMetadata, or null when nothing would change
 */
function buildMetadataUpdate(match, current = {}, options = {}) {
  const override = !!options.override
  const update = {}
  const fill = (key, newValue, currentValue) => {
    if (hasValue(newValue) && (override || !hasValue(currentValue))) update[key] = newValue
  }

  if (override) fill('title', match.title, null)
  fill('subtitle', match.subtitle, current.subtitle)
  fill('description', descriptionToText(match.description), current.description)
  fill('publisher', match.publisher, current.publisher)
  fill('publishedYear', match.publishedYear, current.publishedYear)
  fill('language', match.language, current.language)
  fill('asin', match.asin, current.asin)
  fill('isbn', match.isbn, current.isbn)
  fill('genres', Array.isArray(match.genres) ? match.genres : null, current.genres)
  fill('narrators', splitNames(match.narrator), current.narrators)
  fill('authors', splitNames(match.author), current.authors)

  if (Array.isArray(match.series) && match.series.length) {
    const series = match.series.filter((s) => s?.series).map((s) => ({ name: s.series, sequence: s.sequence || undefined }))
    fill('series', series, current.series)
  }
  if (match.explicit) update.explicit = true
  if (hasValue(match.cover) && (override || !current.hasCover)) update.coverUrl = match.cover

  return Object.keys(update).length ? update : null
}

module.exports = {
  normalizeForCompare,
  scoreResult,
  createProviders,
  findBestMatch,
  buildMetadataUpdate, descriptionToText }

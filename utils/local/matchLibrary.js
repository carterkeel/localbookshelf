// Runs metadata matching over the books of a scanned folder.
// Pure orchestration: the providers and the "apply" step are injected so it can be tested without
// a network or a device.
const { findBestMatch, buildMetadataUpdate } = require('./matcher')
const { nameToLastFirst } = require('./parsers/parseNameString')
const { cleanTitleForSearch } = require('./seriesInference')

/** A scanned book that has no description yet has not been matched. */
function needsMatch(item) {
  const md = item?.media?.metadata
  return !!item?.isScanned && item.mediaType === 'book' && !!md?.title && !md.description
}

/** Map a LocalLibraryItem (as returned by the native layer) to the "current values" the matcher compares against. */
function currentValuesFrom(item) {
  const md = item.media.metadata
  return {
    title: md.title,
    subtitle: md.subtitle,
    authors: (md.authors || []).map((a) => a.name),
    narrators: md.narrators,
    description: md.description,
    publisher: md.publisher,
    publishedYear: md.publishedYear,
    genres: md.genres,
    language: md.language,
    asin: md.asin,
    isbn: md.isbn,
    series: md.series,
    hasCover: !!item.coverContentUrl
  }
}

/**
 * @param {object[]} items LocalLibraryItems
 * @param {{
 *   providers: {name: string, search: Function}[],
 *   apply: (id: string, metadata: object) => Promise<any>,
 *   onProgress?: (done: number, total: number, title: string) => void,
 *   isCancelled?: () => boolean,
 *   concurrency?: number,
 *   override?: boolean
 * }} deps
 * @returns {Promise<{matched: number, unmatched: number, failed: number, total: number}>}
 */
async function matchLocalItems(items, { providers, apply, onProgress, isCancelled, concurrency = 3, override = false }) {
  const result = { matched: 0, unmatched: 0, failed: 0, total: items.length }
  let next = 0
  let done = 0

  async function worker() {
    while (next < items.length && !(isCancelled && isCancelled())) {
      const item = items[next++]
      const md = item.media.metadata
      try {
        const best = await findBestMatch({ title: cleanTitleForSearch(md.title), author: md.authorName || undefined, asin: md.asin || undefined }, providers)
        if (!best) {
          result.unmatched++
        } else {
          const update = buildMetadataUpdate(best.result, currentValuesFrom(item), { override })
          if (update) {
            if (update.authors) update.authorNameLF = update.authors.map((a) => nameToLastFirst(a)).join(', ')
            await apply(item.id, update)
          }
          result.matched++
        }
      } catch (error) {
        result.failed++
      }
      done++
      if (onProgress) onProgress(done, items.length, md.title)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker))
  return result
}

module.exports = { needsMatch, currentValuesFrom, matchLocalItems }

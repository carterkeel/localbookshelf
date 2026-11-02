// Turns the flat file listing from the native layer (AbsFileSystem.listFolderFiles) into the
// list of books the native scanner (AbsFileSystem.scanLocalBooks) should index.
//
// Grouping files into books and parsing author/series/title/narrator from folder names uses the
// same logic as the audiobookshelf server (see folderParsing.js), so a library laid out for the
// server (/Author/Series/Book 1 - Title {Narrator}/) is organised the same way on the device.
const { groupFileItemsIntoLibraryItemDirs, getBookDataFromDir } = require('./folderParsing')
const { nameToLastFirst } = require('./parsers/parseNameString')

/**
 * @typedef ListedFile
 * @property {string} name
 * @property {string} reldirpath directory relative to the selected folder ('' for the root)
 * @property {string} extension including the leading dot
 * @property {number} deep number of directories below the root
 * @property {string} contentUrl
 * @property {number} [size]
 * @property {string} [mimeType]
 *
 * @typedef FolderListing
 * @property {ListedFile[]} files
 * @property {Record<string,string>} [dirs] content URL of every directory, keyed by relative path
 */

function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name
}

function stripExtension(name) {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(0, idx) : name
}

/** Remove null/undefined/empty values so the native side never sees JSON nulls. */
function compact(obj) {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value) && !value.length) continue
    out[key] = value
  }
  return out
}

/**
 * @param {FolderListing} listing
 * @param {{ parseSubtitle?: boolean }} [options]
 * @returns {object[]} books to index, in a stable order
 */
function buildScanItems(listing, options = {}) {
  const files = listing?.files || []
  const dirs = listing?.dirs || {}

  const byFullPath = new Map()
  for (const f of files) {
    byFullPath.set(joinPath(f.reldirpath, f.name), f)
  }

  // Audiobooks only: a folder becomes a book when it holds at least one audio file.
  const groups = groupFileItemsIntoLibraryItemDirs(
    'book',
    files.map((f) => ({ name: f.name, reldirpath: f.reldirpath, extension: f.extension, deep: f.deep })),
    true
  )

  const items = []
  for (const itemPath of Object.keys(groups).sort()) {
    const group = groups[itemPath]
    const isSingleFile = typeof group === 'string' // an audio file sitting in the library root
    const fileRels = isSingleFile ? [group] : group

    const itemFiles = []
    for (const rel of fileRels) {
      const listed = byFullPath.get(isSingleFile ? rel : joinPath(itemPath, rel))
      if (!listed) continue
      itemFiles.push(
        compact({
          name: listed.name,
          relPath: isSingleFile ? listed.name : rel,
          contentUrl: listed.contentUrl,
          size: listed.size || 0,
          mimeType: listed.mimeType
        })
      )
    }
    if (!itemFiles.length) continue

    const parsed = getBookDataFromDir(isSingleFile ? stripExtension(itemPath) : itemPath, !!options.parseSubtitle)

    items.push(
      compact({
        relPath: itemPath,
        contentUrl: isSingleFile ? itemFiles[0].contentUrl : dirs[itemPath] || itemFiles[0].contentUrl,
        title: parsed.title,
        subtitle: parsed.subtitle,
        authors: parsed.authors,
        authorNameLF: parsed.authors.map((a) => nameToLastFirst(a)).join(', '),
        narrators: parsed.narrators,
        seriesName: parsed.seriesName,
        seriesSequence: parsed.seriesSequence,
        publishedYear: parsed.publishedYear,
        asin: parsed.asin,
        files: itemFiles
      })
    )
  }
  return items
}

module.exports = { buildScanItems }

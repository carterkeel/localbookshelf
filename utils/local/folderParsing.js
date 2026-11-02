// Folder/file-name metadata parsing for standalone (serverless) libraries.
//
// Ported from advplyr/audiobookshelf (GPL-3.0):
//   server/utils/scandir.js   -> getBookDataFromDir and its helpers
//   server/utils/globals.js   -> supported file type lists
// The logic is kept identical to the server so a library laid out for the server
// (/Author/Series/Book 1 - Title {Narrator}/) is parsed the same way on the device.
// Differences from the server: helpers are exported (for tests) and the server-only
// LibraryFile/Logger dependencies are dropped.

const parseNameString = require('./parsers/parseNameString')

const globals = {
  SupportedImageTypes: ['png', 'jpg', 'jpeg', 'webp'],
  SupportedAudioTypes: ['m4b', 'mp3', 'm4a', 'flac', 'opus', 'ogg', 'oga', 'mp4', 'aac', 'wma', 'aiff', 'aif', 'wav', 'webm', 'webma', 'mka', 'awb', 'caf', 'mpg', 'mpeg'],
  SupportedEbookTypes: ['epub', 'pdf', 'mobi', 'azw3', 'cbr', 'cbz'],
  TextFileTypes: ['txt', 'nfo'],
  MetadataFileTypes: ['opf', 'abs', 'xml', 'json']
}

/**
 * @typedef LibraryItemFilenameMetadata
 * @property {string} title
 * @property {string|null} subtitle Book mediaType only
 * @property {string|null} asin Book mediaType only
 * @property {string[]} authors Book mediaType only
 * @property {string[]} narrators Book mediaType only
 * @property {string|null} seriesName Book mediaType only
 * @property {string|null} seriesSequence Book mediaType only
 * @property {string|null} publishedYear Book mediaType only
 */

/** @param {string} filename */
function getExtension(filename) {
  const idx = (filename || '').lastIndexOf('.')
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : ''
}

/** @param {string} filename */
function isAudioFile(filename) {
  return globals.SupportedAudioTypes.includes(getExtension(filename))
}

/** @param {string} filename */
function isEbookFile(filename) {
  return globals.SupportedEbookTypes.includes(getExtension(filename))
}

/** @param {string} filename */
function isImageFile(filename) {
  return globals.SupportedImageTypes.includes(getExtension(filename))
}

/**
 * Extract narrator from folder name
 *
 * @param {string} folder
 * @returns {[string, string|null]} [folder, narrator]
 */
function getNarrator(folder) {
  const pattern = /^(?<title>.*) \{(?<narrators>.*)\}$/
  const match = folder.match(pattern)
  return match ? [match.groups.title, match.groups.narrators] : [folder, null]
}

/**
 * Extract series sequence from folder name
 *
 * @example
 * 'Book 2 - Title - Subtitle'
 * 'Title - Subtitle - Vol 12'
 * 'Title - volume 9 - Subtitle'
 * 'Vol. 3 Title Here - Subtitle'
 * '1980 - Book 2 - Title'
 * 'Volume 12. Title - Subtitle'
 * '100 - Book Title'
 * '6. Title'
 * '0.5 - Book Title'
 *
 * @param {string} folder
 * @returns {[string, string|null]} [folder, sequence]
 */
function getSequence(folder) {
  // Matches a valid volume string. Also matches a book whose title starts with a 1 to 3 digit number. Will handle that later.
  const pattern = /^(?<volumeLabel>vol\.? |volume |book )?(?<sequence>\d{0,3}(?:\.\d{1,2})?)(?<trailingDot>\.?)(?: (?<suffix>.*))?$/i

  let volumeNumber = null
  const parts = folder.split(' - ')
  for (let i = 0; i < parts.length; i++) {
    const match = parts[i].match(pattern)
    // This excludes '101 Dalmations' but includes '101. Dalmations'
    if (match && !(match.groups.suffix && !(match.groups.volumeLabel || match.groups.trailingDot))) {
      volumeNumber = isNaN(match.groups.sequence) ? match.groups.sequence : Number(match.groups.sequence).toString()
      parts[i] = match.groups.suffix
      if (!parts[i]) {
        parts.splice(i, 1)
      }
      break
    }
  }

  folder = parts.join(' - ')
  return [folder, volumeNumber]
}

/**
 * Extract published year from folder name
 *
 * @param {string} folder
 * @returns {[string, string|null]} [folder, publishedYear]
 */
function getPublishedYear(folder) {
  let publishedYear = null

  const pattern = /^ *\(?([0-9]{4})\)? * - *(.+)/ //Matches #### - title or (####) - title
  const match = folder.match(pattern)
  if (match) {
    publishedYear = match[1]
    folder = match[2]
  }

  return [folder, publishedYear]
}

/**
 * Extract subtitle from folder name
 *
 * @param {string} folder
 * @returns {[string, string]} [folder, subtitle]
 */
function getSubtitle(folder) {
  // Subtitle is everything after " - "
  const splitTitle = folder.split(' - ')
  return [splitTitle.shift(), splitTitle.join(' - ')]
}

/**
 * Extract asin from folder name
 *
 * @param {string} folder
 * @returns {[string, string|null]} [folder, asin]
 */
function getASIN(folder) {
  let asin = null

  const pattern = /(?: |^)\[([A-Z0-9]{10})](?= |$)/ // Matches "[B0015T963C]"
  const match = folder.match(pattern)
  if (match) {
    asin = match[1]
    folder = folder.replace(match[0], '')
  }
  return [folder.trim(), asin]
}

/**
 * Get details parsed from a book's folder path, relative to the library root.
 * Uses the /Author/Series/Title layout: the last folder is the title, the one above
 * it is the series (only when there are at least 2 folders above the title), and the
 * one above that is the author.
 *
 * @param {string} relPath POSIX-style path relative to the library root
 * @param {boolean} parseSubtitle
 * @returns {LibraryItemFilenameMetadata}
 */
function getBookDataFromDir(relPath, parseSubtitle = false) {
  const splitDir = relPath.split('/')

  const titleFolder = splitDir.pop() // Audio files will always be in the directory named for the title
  const series = splitDir.length > 1 ? splitDir.pop() : null // If there are at least 2 more directories, next furthest will be the series
  const author = splitDir.length > 0 ? splitDir.pop() : null // There could be many more directories, but only the top 3 are used for naming /author/series/title/

  // Each extractor strips one piece of metadata and returns the remaining folder name.
  const [afterAsin, asin] = getASIN(titleFolder)
  const [afterNarrators, narrators] = getNarrator(afterAsin)
  const [afterSequence, sequence] = series ? getSequence(afterNarrators) : [afterNarrators, null]
  const [afterYear, publishedYear] = getPublishedYear(afterSequence)
  const [title, subtitle] = parseSubtitle ? getSubtitle(afterYear) : [afterYear, null]

  return {
    title,
    subtitle,
    asin,
    authors: parseNameString.parse(author)?.names || [],
    narrators: parseNameString.parse(narrators)?.names || [],
    seriesName: series,
    seriesSequence: sequence,
    publishedYear
  }
}

/**
 * Minimal replacement for path.posix.join (avoids needing a path polyfill in the web view).
 * Joins non-empty segments with '/'. Folder names containing '.'/'..' segments are not expected here.
 *
 * @param {...string} parts
 * @returns {string}
 */
function joinPosix(...parts) {
  return parts
    .filter((p) => !!p)
    .join('/')
    .replace(/\/{2,}/g, '/')
}

/**
 * @param {string} mediaType
 * @param {string} ext extension including the leading dot, e.g. '.m4b'
 * @param {boolean} audiobooksOnly
 */
function isMediaFile(mediaType, ext, audiobooksOnly = false) {
  if (!ext) return false
  const extclean = ext.slice(1).toLowerCase()
  if (mediaType === 'podcast') return globals.SupportedAudioTypes.includes(extclean)
  else if (audiobooksOnly) return globals.SupportedAudioTypes.includes(extclean)
  return globals.SupportedAudioTypes.includes(extclean) || globals.SupportedEbookTypes.includes(extclean)
}

/** @param {string} ext extension including the leading dot */
function isScannableNonMediaFile(ext) {
  if (!ext) return false
  const extclean = ext.slice(1).toLowerCase()
  return globals.TextFileTypes.includes(extclean) || globals.MetadataFileTypes.includes(extclean) || globals.SupportedImageTypes.includes(extclean)
}

/**
 * Group a flat list of files into potential library item directories.
 * Handles single-file books in the root, multi-disc folders (CD1/Disc 2/...), and
 * books nested at any depth. Ported from the server's groupFileItemsIntoLibraryItemDirs.
 *
 * @typedef FilePathItem
 * @property {string} name file name
 * @property {string} reldirpath directory relative to the library root ('' for root), POSIX separators
 * @property {string} extension including the leading dot
 * @property {number} deep number of directories below the root
 *
 * @param {string} mediaType 'book' | 'podcast'
 * @param {FilePathItem[]} fileItems
 * @param {boolean} audiobooksOnly
 * @param {boolean} [includeNonMediaFiles=false]
 * @returns {Record<string, string|string[]>} map of item path -> files (a root single-file book maps to its own file name)
 */
function groupFileItemsIntoLibraryItemDirs(mediaType, fileItems, audiobooksOnly, includeNonMediaFiles = false) {
  // Step 1: Filter out non-book-media files in root dir (with depth of 0)
  const itemsFiltered = fileItems.filter((i) => {
    return i.deep > 0 || (mediaType === 'book' && isMediaFile(mediaType, i.extension, audiobooksOnly))
  })

  // Step 2: Separate media files and other files
  //     - Directories without a media file will not be included (unless includeNonMediaFiles is true)
  const mediaFileItems = []
  const otherFileItems = []
  itemsFiltered.forEach((item) => {
    if (isMediaFile(mediaType, item.extension, audiobooksOnly) || (includeNonMediaFiles && isScannableNonMediaFile(item.extension))) {
      mediaFileItems.push(item)
    } else {
      otherFileItems.push(item)
    }
  })

  // Step 3: Group media files (or non-media files if includeNonMediaFiles is true) in library items
  const libraryItemGroup = {}
  mediaFileItems.forEach((item) => {
    const dirparts = item.reldirpath.split('/').filter((p) => !!p)
    const numparts = dirparts.length
    let _path = ''

    if (!dirparts.length) {
      // Media file in root
      libraryItemGroup[item.name] = item.name
    } else {
      // Iterate over directories in path
      for (let i = 0; i < numparts; i++) {
        const dirpart = dirparts.shift()
        _path = joinPosix(_path, dirpart)

        if (libraryItemGroup[_path]) {
          // Directory already has files, add file
          const relpath = joinPosix(dirparts.join('/'), item.name)
          libraryItemGroup[_path].push(relpath)
          return
        } else if (!dirparts.length) {
          // This is the last directory, create group
          libraryItemGroup[_path] = [item.name]
          return
        } else if (dirparts.length === 1 && /^(cd|dis[ck])\s*\d{1,3}$/i.test(dirparts[0])) {
          // Next directory is the last and is a CD dir, create group
          libraryItemGroup[_path] = [joinPosix(dirparts[0], item.name)]
          return
        }
      }
    }
  })

  // Step 4: Add other files into library item groups
  otherFileItems.forEach((item) => {
    const dirparts = item.reldirpath.split('/')
    const numparts = dirparts.length
    let _path = ''

    // Iterate over directories in path
    for (let i = 0; i < numparts; i++) {
      const dirpart = dirparts.shift()
      _path = joinPosix(_path, dirpart)
      if (libraryItemGroup[_path]) {
        // Directory is audiobook group
        const relpath = joinPosix(dirparts.join('/'), item.name)
        libraryItemGroup[_path].push(relpath)
        return
      }
    }
  })
  return libraryItemGroup
}

/**
 * @param {string} relPath
 * @returns {LibraryItemFilenameMetadata}
 */
function getPodcastDataFromDir(relPath) {
  const splitDir = relPath.split('/')

  // Audio files will always be in the directory named for the title
  const title = splitDir.pop()
  return {
    title
  }
}

module.exports = {
  globals,
  getExtension,
  isAudioFile,
  isEbookFile,
  isImageFile,
  isMediaFile,
  isScannableNonMediaFile,
  groupFileItemsIntoLibraryItemDirs,
  getBookDataFromDir,
  getPodcastDataFromDir,
  // exported for testing
  getNarrator,
  getSequence,
  getPublishedYear,
  getSubtitle,
  getASIN
}

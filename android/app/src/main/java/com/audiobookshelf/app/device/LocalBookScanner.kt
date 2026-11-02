package com.audiobookshelf.app.device

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import com.audiobookshelf.app.data.AudioTrack
import com.audiobookshelf.app.data.Author
import com.audiobookshelf.app.data.Book
import com.audiobookshelf.app.data.BookChapter
import com.audiobookshelf.app.data.BookMetadata
import com.audiobookshelf.app.data.FileMetadata
import com.audiobookshelf.app.data.LocalFile
import com.audiobookshelf.app.data.LocalFolder
import com.audiobookshelf.app.data.LocalLibraryItem
import com.audiobookshelf.app.data.SeriesType
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Indexes audiobooks that live in a folder the user selected (standalone library, no server).
 *
 * Division of labour with the web layer (utils/local):
 *  - [listFolderFiles] walks the folder tree and returns a flat file list.
 *  - The web layer groups files into books and parses author/series/title from folder names
 *    (same logic as the audiobookshelf server).
 *  - [scanItems] receives that description, reads durations/tags/covers from the audio files
 *    and builds + saves [LocalLibraryItem]s. The audio files are never modified or moved.
 */
class LocalBookScanner(private val ctx: Context) {
  private val tag = "LocalBookScanner"

  data class ListedFile(
          val name: String,
          val relDirPath: String,
          val extension: String,
          val deep: Int,
          val contentUrl: String,
          val size: Long,
          val mimeType: String?
  )

  data class FolderListing(val files: List<ListedFile>, val dirs: Map<String, String>)

  data class ScanResult(
          var added: Int = 0,
          var updated: Int = 0,
          var removed: Int = 0,
          val failed: MutableList<String> = mutableListOf()
  )

  private data class ScanFile(
          val name: String,
          val relPath: String,
          val contentUrl: String,
          val size: Long,
          val mimeType: String?
  )

  private data class ScanItem(
          val relPath: String,
          val contentUrl: String,
          val title: String,
          val subtitle: String?,
          val authors: List<String>,
          val authorNameLF: String?,
          val narrators: List<String>,
          val seriesName: String?,
          val seriesSequence: String?,
          val publishedYear: String?,
          val asin: String?,
          val files: List<ScanFile>
  )

  private class Probe(
          val durationSec: Double,
          val title: String?,
          val artist: String?,
          val albumArtist: String?,
          val album: String?,
          val genre: String?,
          val year: String?,
          val embeddedPicture: ByteArray?
  )

  private val imageExtensions = setOf("jpg", "jpeg", "png", "webp")
  private val audioExtensions =
          setOf(
                  "m4b", "mp3", "m4a", "flac", "opus", "ogg", "oga", "mp4", "aac", "wma", "aiff",
                  "aif", "wav", "webm", "webma", "mka", "awb", "caf", "mpg", "mpeg"
          )

  // ---------------------------------------------------------------------------------------------
  // Step 1: list files
  // ---------------------------------------------------------------------------------------------

  /** Walk the selected folder with DocumentsContract (one query per directory, fast on SAF). */
  fun listFolderFiles(folder: LocalFolder): FolderListing {
    val treeUri = Uri.parse(folder.contentUrl)
    val rootDocId =
            if (DocumentsContract.isDocumentUri(ctx, treeUri)) {
              DocumentsContract.getDocumentId(treeUri)
            } else {
              DocumentsContract.getTreeDocumentId(treeUri)
            }

    val files = mutableListOf<ListedFile>()
    val dirs = mutableMapOf<String, String>()
    val stack = ArrayDeque<Triple<String, String, Int>>()
    stack.addLast(Triple(rootDocId, "", 0))

    val projection =
            arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE
            )

    while (stack.isNotEmpty()) {
      val (parentDocId, relDir, depth) = stack.removeLast()
      val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)
      try {
        ctx.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
          while (cursor.moveToNext()) {
            val docId = cursor.getString(0) ?: continue
            val name = cursor.getString(1) ?: continue
            val mime = cursor.getString(2)
            val size = if (cursor.isNull(3)) 0L else cursor.getLong(3)
            if (name.startsWith(".")) continue // hidden files/folders

            val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId).toString()
            if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
              val childRel = if (relDir.isEmpty()) name else "$relDir/$name"
              dirs[childRel] = docUri
              stack.addLast(Triple(docId, childRel, depth + 1))
            } else {
              val dot = name.lastIndexOf('.')
              val ext = if (dot > 0) name.substring(dot) else ""
              files.add(ListedFile(name, relDir, ext, depth, docUri, size, mime))
            }
          }
        }
      } catch (e: Exception) {
        Log.e(tag, "Failed to list directory '$relDir'", e)
      }
    }
    return FolderListing(files, dirs)
  }

  // ---------------------------------------------------------------------------------------------
  // Step 2: build + save library items
  // ---------------------------------------------------------------------------------------------

  fun scanItems(
          folder: LocalFolder,
          itemsJson: JSONArray,
          onProgress: (done: Int, total: Int, title: String) -> Unit
  ): ScanResult {
    val result = ScanResult()
    val total = itemsJson.length()
    // Every item present on disk this scan. Includes items that failed to read this time, so a
    // transient read error never removes a book from the library.
    val keepIds = mutableSetOf<String>()

    for (i in 0 until total) {
      val dto =
              try {
                parseItem(itemsJson.getJSONObject(i))
              } catch (e: Exception) {
                Log.e(tag, "Invalid scan item at index $i", e)
                result.failed.add("item #$i")
                continue
              }
      onProgress(i, total, dto.title)

      val itemId = "local_${DeviceManager.getBase64Id("${folder.id}/${dto.relPath}")}"
      keepIds.add(itemId)
      try {
        val existing = DeviceManager.dbManager.getLocalLibraryItem(itemId)
        val saved = buildAndSave(folder, itemId, dto, existing)
        if (!saved) {
          result.failed.add(dto.relPath)
        } else if (existing != null) {
          result.updated++
        } else {
          result.added++
        }
      } catch (e: Exception) {
        Log.e(tag, "Failed to scan '${dto.relPath}'", e)
        result.failed.add(dto.relPath)
      }
    }
    onProgress(total, total, "")

    // Remove previously scanned items in this folder that no longer exist on disk.
    // Items downloaded from a server (isScanned == false) are never touched here.
    DeviceManager.dbManager.getLocalLibraryItemsInFolder(folder.id).forEach { lli ->
      if (lli.isScanned && !keepIds.contains(lli.id)) {
        DeviceManager.dbManager.removeLocalLibraryItem(lli.id)
        result.removed++
      }
    }
    return result
  }

  private fun buildAndSave(
          folder: LocalFolder,
          itemId: String,
          dto: ScanItem,
          existing: LocalLibraryItem?
  ): Boolean {
    val audioFiles =
            dto.files
                    .filter { audioExtensions.contains(extensionOf(it.name)) }
                    .sortedWith(Comparator { a, b -> naturalCompare(a.relPath, b.relPath) })
    if (audioFiles.isEmpty()) return false

    val itemAbsolutePath = "${folder.absolutePath}/${dto.relPath}"
    val itemBasePath = "${folder.basePath}/${dto.relPath}"

    // Probe every audio file for duration/tags
    val tracks = mutableListOf<AudioTrack>()
    val localFiles = mutableListOf<LocalFile>()
    var firstProbe: Probe? = null
    var index = 1
    for (file in audioFiles) {
      val probe = probe(Uri.parse(file.contentUrl))
      if (probe == null || probe.durationSec <= 0.0) {
        Log.w(tag, "Skipping unreadable audio file ${file.relPath}")
        continue
      }
      if (firstProbe == null) firstProbe = probe

      val ext = extensionOf(file.name)
      val fileId = DeviceManager.getBase64Id(file.contentUrl)
      val fileAbsolutePath = "$itemAbsolutePath/${file.relPath}".replace("//", "/")
      val mimeType = audioMimeFor(ext, file.mimeType)
      localFiles.add(
              LocalFile(
                      fileId,
                      file.name,
                      file.contentUrl,
                      itemBasePath,
                      fileAbsolutePath,
                      mimeType,
                      file.size
              )
      )
      tracks.add(
              AudioTrack(
                      index,
                      0.0,
                      probe.durationSec,
                      probe.title?.takeIf { it.isNotBlank() } ?: file.name.substringBeforeLast('.'),
                      file.contentUrl,
                      mimeType,
                      FileMetadata(file.name, ext, fileAbsolutePath, file.relPath, file.size),
                      true,
                      fileId,
                      index
              )
      )
      index++
    }
    if (tracks.isEmpty()) return false

    // Cover: an image file in the book folder, else the picture embedded in the first audio file
    var coverContentUrl: String? = null
    var coverAbsolutePath: String? = null
    val coverFile = pickCoverFile(dto.files)
    if (coverFile != null) {
      coverContentUrl = coverFile.contentUrl
      coverAbsolutePath = "$itemAbsolutePath/${coverFile.relPath}".replace("//", "/")
      localFiles.add(
              LocalFile(
                      DeviceManager.getBase64Id(coverFile.contentUrl),
                      coverFile.name,
                      coverFile.contentUrl,
                      itemBasePath,
                      coverAbsolutePath,
                      mimeForImage(extensionOf(coverFile.name)),
                      coverFile.size
              )
      )
    } else {
      val picture = firstProbe?.embeddedPicture
      val saved = if (picture != null) saveEmbeddedCover(itemId, picture) else null
      if (saved != null) {
        val savedUrl = Uri.fromFile(saved).toString()
        coverContentUrl = savedUrl
        coverAbsolutePath = saved.absolutePath
        localFiles.add(
                LocalFile(
                        DeviceManager.getBase64Id(savedUrl),
                        saved.name,
                        savedUrl,
                        saved.parent ?: "",
                        saved.absolutePath,
                        "image/jpeg",
                        saved.length()
                )
        )
      }
    }

    if (existing != null) {
      // Re-scan: refresh files/tracks, keep metadata (it may have been matched/edited) and progress
      existing.updateFromScan(tracks, localFiles)
      (existing.media as? Book)?.let { book ->
        book.chapters = chaptersFor(tracks)
        book.size = localFiles.sumOf { it.size }
        book.numTracks = tracks.size
      }
      if (coverContentUrl != null && existing.coverContentUrl == null) {
        existing.coverContentUrl = coverContentUrl
        existing.coverAbsolutePath = coverAbsolutePath
        existing.media.coverPath = coverContentUrl
      }
      existing.isScanned = true
      DeviceManager.dbManager.saveLocalLibraryItem(existing)
      return true
    }

    // New item: folder-derived values win, embedded tags fill the gaps
    val authorNames =
            when {
              dto.authors.isNotEmpty() -> dto.authors
              !firstProbe?.albumArtist.isNullOrBlank() -> listOf(firstProbe!!.albumArtist!!.trim())
              !firstProbe?.artist.isNullOrBlank() -> listOf(firstProbe!!.artist!!.trim())
              else -> emptyList()
            }
    val authors =
            authorNames
                    .map { Author("local_author_${DeviceManager.getBase64Id(it.lowercase())}", it, null) }
                    .toMutableList()
    val narrators = dto.narrators.toMutableList()
    val genres =
            (firstProbe?.genre ?: "")
                    .split(';', ',')
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .toMutableList()
    val publishedYear =
            dto.publishedYear
                    ?: firstProbe?.year?.let { Regex("\\d{4}").find(it)?.value }
    val series =
            dto.seriesName?.let {
              listOf(SeriesType("local_series_${DeviceManager.getBase64Id(it.lowercase())}", it, dto.seriesSequence))
            }
    val seriesDisplay =
            dto.seriesName?.let { name ->
              if (dto.seriesSequence.isNullOrEmpty()) name else "$name #${dto.seriesSequence}"
            }

    val metadata =
            BookMetadata(
                    dto.title,
                    dto.subtitle,
                    authors,
                    narrators,
                    genres,
                    publishedYear,
                    null,
                    null,
                    null,
                    null,
                    dto.asin,
                    null,
                    false,
                    authors.joinToString(", ") { it.name }.ifEmpty { null },
                    dto.authorNameLF,
                    narrators.joinToString(", ").ifEmpty { null },
                    seriesDisplay,
                    series
            )

    val book =
            Book(
                    metadata,
                    coverContentUrl,
                    mutableListOf(),
                    mutableListOf(),
                    chaptersFor(tracks),
                    mutableListOf(),
                    null,
                    localFiles.sumOf { it.size },
                    null,
                    tracks.size
            )
    book.setAudioTracks(tracks) // computes start offsets + total duration
    book.chapters = chaptersFor(book.getAudioTracks())

    val item =
            LocalLibraryItem(
                    itemId,
                    folder.id,
                    itemBasePath,
                    itemAbsolutePath,
                    dto.contentUrl,
                    false,
                    "book",
                    book,
                    localFiles,
                    coverContentUrl,
                    coverAbsolutePath,
                    true,
                    null,
                    null,
                    null,
                    null,
                    true
            )
    DeviceManager.dbManager.saveLocalLibraryItem(item)
    return true
  }

  /** One chapter per audio file when a book is split over several files. */
  private fun chaptersFor(tracks: List<AudioTrack>): List<BookChapter> {
    if (tracks.size < 2) return mutableListOf()
    return tracks.map { BookChapter(it.index - 1, it.startOffset, it.startOffset + it.duration, it.title) }
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  private fun probe(uri: Uri): Probe? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(ctx, uri)
      val durationMs =
              retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                      ?: 0L
      Probe(
              durationMs / 1000.0,
              retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),
              retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST),
              retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
              retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM),
              retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE),
              retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR),
              retriever.embeddedPicture
      )
    } catch (e: Exception) {
      Log.e(tag, "Failed to read audio metadata for $uri", e)
      null
    } finally {
      try {
        retriever.release()
      } catch (e: Exception) {
        // ignore
      }
    }
  }

  private fun saveEmbeddedCover(itemId: String, bytes: ByteArray): File? {
    return try {
      val dir = File(ctx.filesDir, "scanned_covers")
      if (!dir.exists()) dir.mkdirs()
      val file = File(dir, "${itemId.replace(Regex("[^A-Za-z0-9_-]"), "_")}.jpg")
      file.writeBytes(bytes)
      file
    } catch (e: Exception) {
      Log.e(tag, "Failed to save embedded cover", e)
      null
    }
  }

  private fun pickCoverFile(files: List<ScanFile>): ScanFile? {
    val images = files.filter { imageExtensions.contains(extensionOf(it.name)) }
    if (images.isEmpty()) return null
    val preferredNames = listOf("cover", "folder", "front", "album", "poster")
    // Prefer well-known names, and images closest to the book folder root
    return images.sortedBy { it.relPath.count { c -> c == '/' } }.firstOrNull { img ->
      preferredNames.contains(img.name.substringBeforeLast('.').lowercase())
    }
            ?: images.minByOrNull { it.relPath.count { c -> c == '/' } }
  }

  private fun extensionOf(name: String): String {
    val dot = name.lastIndexOf('.')
    return if (dot >= 0 && dot < name.length - 1) name.substring(dot + 1).lowercase() else ""
  }

  private fun audioMimeFor(ext: String, provided: String?): String {
    if (!provided.isNullOrBlank() && provided != "application/octet-stream") return provided
    return when (ext) {
      "mp3" -> "audio/mpeg"
      "m4b", "m4a", "mp4" -> "audio/mp4"
      "flac" -> "audio/flac"
      "ogg", "oga", "opus" -> "audio/ogg"
      "wav" -> "audio/wav"
      "aac" -> "audio/aac"
      "wma" -> "audio/x-ms-wma"
      "webm", "webma" -> "audio/webm"
      "mka" -> "audio/x-matroska"
      else -> "audio/mpeg"
    }
  }

  private fun mimeForImage(ext: String): String {
    return when (ext) {
      "png" -> "image/png"
      "webp" -> "image/webp"
      else -> "image/jpeg"
    }
  }

  /** Compare strings treating runs of digits as numbers, so "2.mp3" sorts before "10.mp3". */
  private fun naturalCompare(a: String, b: String): Int {
    val chunk = Regex("(\\d+)|(\\D+)")
    val ca = chunk.findAll(a.lowercase()).map { it.value }.toList()
    val cb = chunk.findAll(b.lowercase()).map { it.value }.toList()
    val n = minOf(ca.size, cb.size)
    for (i in 0 until n) {
      val x = ca[i]
      val y = cb[i]
      val bothNumeric = x[0].isDigit() && y[0].isDigit()
      val cmp =
              if (bothNumeric) {
                val nx = x.trimStart('0')
                val ny = y.trimStart('0')
                if (nx.length != ny.length) nx.length.compareTo(ny.length) else nx.compareTo(ny)
              } else {
                x.compareTo(y)
              }
      if (cmp != 0) return cmp
    }
    return ca.size.compareTo(cb.size)
  }

  // ---------------------------------------------------------------------------------------------
  // JSON parsing (org.json turns JSON null into the string "null", so always check isNull first)
  // ---------------------------------------------------------------------------------------------

  private fun JSONObject.str(key: String): String? {
    if (isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() }
  }

  private fun JSONObject.strList(key: String): List<String> {
    if (isNull(key)) return emptyList()
    val arr = optJSONArray(key) ?: return emptyList()
    val out = mutableListOf<String>()
    for (i in 0 until arr.length()) {
      if (!arr.isNull(i)) arr.optString(i).takeIf { it.isNotBlank() }?.let { out.add(it) }
    }
    return out
  }

  private fun parseItem(obj: JSONObject): ScanItem {
    val filesJson = obj.getJSONArray("files")
    val files = mutableListOf<ScanFile>()
    for (i in 0 until filesJson.length()) {
      val f = filesJson.getJSONObject(i)
      files.add(
              ScanFile(
                      f.getString("name"),
                      f.getString("relPath"),
                      f.getString("contentUrl"),
                      f.optLong("size", 0L),
                      f.str("mimeType")
              )
      )
    }
    return ScanItem(
            obj.getString("relPath"),
            obj.getString("contentUrl"),
            obj.getString("title"),
            obj.str("subtitle"),
            obj.strList("authors"),
            obj.str("authorNameLF"),
            obj.strList("narrators"),
            obj.str("seriesName"),
            obj.str("seriesSequence"),
            obj.str("publishedYear"),
            obj.str("asin"),
            files
    )
  }
}

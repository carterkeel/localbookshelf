// Shared by every screen that can index the audiobooks in the user's folders and fetch their metadata.
// The component using it can define `afterLocalScan()` to refresh its own list.
import { CapacitorHttp } from '@capacitor/core'
import { AbsFileSystem } from '@/plugins/capacitor'
import localScan from '@/utils/local/buildScanItems'
import localMatch from '@/utils/local/matchLibrary'
import localMatcher from '@/utils/local/matcher'
import localHttp from '@/utils/local/http'

export default {
  data() {
    return {
      scanning: false,
      scanStatusText: '',
      scanProgress: { done: 0, total: 0, title: '' },
      matching: false,
      matchStatusText: ''
    }
  },
  computed: {
    networkConnected() {
      return this.$store.state.networkConnected
    },
    scanPercent() {
      if (!this.scanProgress.total) return 0
      return Math.min(100, Math.round((this.scanProgress.done / this.scanProgress.total) * 100))
    }
  },
  methods: {
    /** Ids of every folder the user added for audiobooks (never the app's internal storage). */
    async getBookFolderIds() {
      const folders = (await this.$db.getLocalFolders()) || []
      return folders.filter((f) => f.mediaType === 'book' && !f.id.startsWith('internal-')).map((f) => f.id)
    },

    /**
     * Index the audiobooks in the given folders on the device (no server needed): the native layer lists
     * the files, the same folder-name logic as the server groups them into books and parses
     * author/series/title, then the native layer reads durations, tags and covers.
     * Books already known are updated in place (their metadata and progress are kept).
     */
    async scanFolders(folderIds) {
      if (this.scanning || !folderIds?.length) return
      this.scanning = true
      this.scanProgress = { done: 0, total: 0, title: '' }
      this.scanStatusText = this.$strings.MessageLocalLibraryListing
      let progressListener = null
      try {
        progressListener = await AbsFileSystem.addListener('onScanProgress', (data) => {
          this.scanProgress = data
          this.scanStatusText = this.$getString('MessageLocalLibraryScanning', [Math.min(data.done + 1, data.total), data.total])
        })

        const totals = { added: 0, updated: 0, removed: 0, failed: 0 }
        let foundBooks = false
        for (const folderId of folderIds) {
          this.scanStatusText = this.$strings.MessageLocalLibraryListing
          const listing = await AbsFileSystem.listFolderFiles({ folderId })
          const items = localScan.buildScanItems(listing)
          // Never touch the library when nothing was found: an unmounted SD card or a revoked
          // permission also looks like an empty folder.
          if (!items.length) continue
          foundBooks = true
          // Books that were scanned before but are gone from storage are only removed from the library
          // when every directory was read successfully.
          const res = await AbsFileSystem.scanLocalBooks({ folderId, items, removeMissing: !listing.errorCount })
          totals.added += res.added || 0
          totals.updated += res.updated || 0
          totals.removed += res.removed || 0
          totals.failed += res.failed?.length || 0
        }

        if (!foundBooks) {
          this.$toast.info(this.$strings.MessageLocalLibraryScanNoBooks)
          return
        }
        this.$toast.success(this.$getString('MessageLocalLibraryScanComplete', [totals.added, totals.updated, totals.removed]))
        if (totals.failed) this.$toast.warning(this.$getString('MessageLocalLibraryScanSkipped', [totals.failed]))

        if (this.afterLocalScan) await this.afterLocalScan()
        // Look up descriptions, narrators, series and covers online when there is a connection
        if (this.networkConnected) {
          const books = ((await this.$db.getLocalLibraryItems('book')) || []).filter(localMatch.needsMatch)
          await this.fetchMetadataFor(books)
        }
      } catch (error) {
        console.error('Failed to scan folders', error)
        this.$toast.error(`${this.$strings.MessageLocalLibraryScanFailed}: ${error?.message || error}`)
      } finally {
        if (progressListener) progressListener.remove()
        this.scanning = false
      }
    },

    /** Scan every audiobook folder the user added, to pick up books that were added since last time. */
    async scanAllFolders() {
      const ids = await this.getBookFolderIds()
      if (!ids.length) return this.$toast.info(this.$strings.MessageLocalLibraryNoFolders)
      await this.scanFolders(ids)
    },

    /**
     * Match books against online metadata providers (Audible, then Google Books) and fill in what is
     * missing. Folder-derived titles/authors/series are never overwritten.
     */
    async fetchMetadataFor(items) {
      if (this.matching || !items?.length) return
      this.matching = true
      this.matchStatusText = this.$getString('MessageLocalLibraryFetchingMetadata', [1, items.length])
      try {
        const providers = localMatcher.createProviders({ http: localHttp.createHttp(CapacitorHttp) })
        const res = await localMatch.matchLocalItems(items, {
          providers,
          apply: (id, metadata) => AbsFileSystem.applyLocalItemMetadata({ id, metadata }),
          onProgress: (done, total) => {
            this.matchStatusText = this.$getString('MessageLocalLibraryFetchingMetadata', [Math.min(done + 1, total), total])
          }
        })
        this.$toast.success(this.$getString('MessageLocalLibraryMetadataComplete', [res.matched, res.total]))
        if (this.afterLocalScan) await this.afterLocalScan()
      } catch (error) {
        console.error('Failed to fetch metadata', error)
        this.$toast.error(`${error?.message || error}`)
      } finally {
        this.matching = false
      }
    }
  }
}

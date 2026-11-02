<template>
  <div class="w-full h-full py-6 px-4">
    <div class="flex items-center mb-2">
      <p class="text-base font-semibold">{{ $strings.LabelFolder }}: {{ folderName }}</p>
      <div class="flex-grow" />

      <span v-if="dialogItems.length" class="material-symbols text-2xl" @click="showDialog = true">more_vert</span>
    </div>

    <p class="text-sm mb-4 text-fg-muted">{{ $strings.LabelMediaType }}: {{ mediaType }}</p>

    <div v-if="canScan" class="mb-4">
      <ui-btn small color="success" class="w-full" :loading="scanning" :disabled="scanning" @click="scanFolder">{{ scanning ? scanStatusText : $strings.ButtonScanFolder }}</ui-btn>
      <div v-if="scanning && scanProgress.total" class="w-full h-1 bg-primary mt-2 rounded overflow-hidden">
        <div class="h-full bg-success" :style="{ width: scanPercent + '%' }" />
      </div>
      <p v-if="scanning && scanProgress.title" class="text-xs text-fg-muted mt-1 truncate">{{ scanProgress.title }}</p>
      <ui-btn v-if="!scanning && itemsNeedingMetadata.length && networkConnected" small class="w-full mt-2" :loading="matching" :disabled="matching" @click="fetchMetadata">{{ matching ? matchStatusText : $strings.ButtonFetchMetadata }}</ui-btn>
    </div>

    <p class="mb-2 text-base text-fg">{{ $strings.HeaderLocalLibraryItems }} ({{ localLibraryItems.length }})</p>

    <div class="w-full media-item-container overflow-y-auto">
      <template v-for="localLibraryItem in localLibraryItems">
        <nuxt-link :to="`/localMedia/item/${localLibraryItem.id}`" :key="localLibraryItem.id" class="flex my-1">
          <div class="w-12 h-12 min-w-12 min-h-12 bg-primary">
            <img v-if="localLibraryItem.coverPathSrc" :src="localLibraryItem.coverPathSrc" class="w-full h-full object-contain" />
          </div>
          <div class="flex-grow px-2">
            <p class="text-sm">{{ localLibraryItem.media.metadata.title }}</p>
            <p class="text-xs text-fg-muted">{{ getLocalLibraryItemSubText(localLibraryItem) }}</p>
          </div>
          <div class="w-12 h-12 flex items-center justify-center">
            <span class="material-symbols text-xl text-fg-muted">arrow_right</span>
          </div>
        </nuxt-link>
      </template>
    </div>

    <modals-dialog v-model="showDialog" :items="dialogItems" @action="dialogAction" />
  </div>
</template>

<script>
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Dialog } from '@capacitor/dialog'
import { AbsFileSystem } from '@/plugins/capacitor'
import localScan from '@/utils/local/buildScanItems'
import localMatch from '@/utils/local/matchLibrary'
import localMatcher from '@/utils/local/matcher'
import localHttp from '@/utils/local/http'

export default {
  asyncData({ params, query }) {
    return {
      folderId: params.id,
      autoScan: !!query.scan
    }
  },
  data() {
    return {
      localLibraryItems: [],
      folder: null,
      removingFolder: false,
      showDialog: false,
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
    itemsNeedingMetadata() {
      return this.localLibraryItems.filter(localMatch.needsMatch)
    },
    canScan() {
      // Audiobooks can be indexed from any folder the user selected (not the app's internal storage)
      return !!this.folder && this.mediaType === 'book' && !this.isInternalStorage
    },
    scanPercent() {
      if (!this.scanProgress.total) return 0
      return Math.min(100, Math.round((this.scanProgress.done / this.scanProgress.total) * 100))
    },
    folderName() {
      return this.folder?.name || null
    },
    mediaType() {
      return this.folder?.mediaType
    },
    isInternalStorage() {
      return this.folder?.id.startsWith('internal-')
    },
    dialogItems() {
      if (this.isInternalStorage) return []
      const items = []
      items.push({
        text: this.$strings.ButtonRemove,
        value: 'remove'
      })
      return items
    }
  },
  methods: {
    /**
     * Index the audiobooks in this folder on the device (no server needed):
     * the native layer lists the files, the same folder-name logic as the server groups them into
     * books and parses author/series/title, then the native layer reads durations, tags and covers.
     */
    async scanFolder() {
      if (this.scanning || !this.canScan) return
      this.scanning = true
      this.scanProgress = { done: 0, total: 0, title: '' }
      this.scanStatusText = this.$strings.MessageLocalLibraryListing
      let progressListener = null
      try {
        const listing = await AbsFileSystem.listFolderFiles({ folderId: this.folderId })
        const items = localScan.buildScanItems(listing)
        if (!items.length) {
          // Never touch the library when nothing was found: an unmounted SD card or a revoked
          // permission also looks like an empty folder.
          this.$toast.info(this.$strings.MessageLocalLibraryScanNoBooks)
          return
        }

        progressListener = await AbsFileSystem.addListener('onScanProgress', (data) => {
          this.scanProgress = data
          this.scanStatusText = this.$getString('MessageLocalLibraryScanning', [Math.min(data.done + 1, data.total), data.total])
        })
        // Books that were scanned before but are gone from storage are only removed from the library
        // when every directory was read successfully.
        const res = await AbsFileSystem.scanLocalBooks({ folderId: this.folderId, items, removeMissing: !listing.errorCount })
        this.$toast.success(this.$getString('MessageLocalLibraryScanComplete', [res.added, res.updated, res.removed]))
        if (res.failed?.length) {
          this.$toast.warning(this.$getString('MessageLocalLibraryScanSkipped', [res.failed.length]))
        }
        await this.init()
        // Look up descriptions, narrators, series and covers online when there is a connection
        if (this.networkConnected) {
          await this.fetchMetadata()
        }
      } catch (error) {
        console.error('Failed to scan folder', error)
        this.$toast.error(`${this.$strings.MessageLocalLibraryScanFailed}: ${error?.message || error}`)
      } finally {
        if (progressListener) progressListener.remove()
        this.scanning = false
      }
    },
    /**
     * Match the scanned books against online metadata providers (Audible, then Google Books) and fill
     * in what is missing. Folder-derived titles/authors/series are never overwritten.
     */
    async fetchMetadata() {
      const items = this.itemsNeedingMetadata
      if (this.matching || !items.length) return
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
        await this.init()
      } catch (error) {
        console.error('Failed to fetch metadata', error)
        this.$toast.error(`${error?.message || error}`)
      } finally {
        this.matching = false
      }
    },
    getLocalLibraryItemSubText(localLibraryItem) {
      if (!localLibraryItem) return ''
      if (localLibraryItem.mediaType == 'book') {
        const txts = []
        if (localLibraryItem.media.metadata.authorName) {
          txts.push(localLibraryItem.media.metadata.authorName)
        }
        if (localLibraryItem.media.ebookFile) {
          txts.push(`${localLibraryItem.media.ebookFile.ebookFormat} ${this.$strings.LabelEbook}`)
        }
        if (localLibraryItem.media.tracks?.length) {
          txts.push(`${localLibraryItem.media.tracks.length} ${this.$strings.LabelTracks}`)
        }
        return txts.join(' • ')
      } else {
        return `${localLibraryItem.media.episodes?.length || 0} ${this.$strings.HeaderEpisodes}`
      }
    },
    dialogAction(action) {
      console.log('Dialog action', action)
      if (action == 'remove') {
        this.removeFolder()
      }
      this.showDialog = false
    },
    async removeFolder() {
      var deleteMessage = 'Are you sure you want to remove this folder? (does not delete anything in your file system)'
      if (this.localLibraryItems.length) {
        deleteMessage = `Are you sure you want to remove this folder and ${this.localLibraryItems.length} items? (does not delete anything in your file system)`
      }
      const { value } = await Dialog.confirm({
        title: this.$strings.HeaderConfirm,
        message: deleteMessage
      })
      if (value) {
        this.removingFolder = true
        await AbsFileSystem.removeFolder({ folderId: this.folderId })
        this.removingFolder = false
        this.$router.replace('/localMedia/folders')
      }
    },
    async init() {
      var folder = await this.$db.getLocalFolder(this.folderId)
      this.folder = folder

      var items = (await this.$db.getLocalLibraryItemsInFolder(this.folderId)) || []
      console.log('Init folder', this.folderId, items)
      this.localLibraryItems = items.map((lmi) => {
        console.log('Local library item', JSON.stringify(lmi))
        return {
          ...lmi,
          coverPathSrc: lmi.coverContentUrl ? Capacitor.convertFileSrc(lmi.coverContentUrl) : null
        }
      })
    },
    newLocalLibraryItem(item) {
      if (item.folderId == this.folderId) {
        console.log('New local library item', item.id)
        if (this.localLibraryItems.find((li) => li.id == item.id)) {
          console.warn('Item already added', item.id)
          return
        }

        var _item = {
          ...item,
          coverPathSrc: item.coverContentUrl ? Capacitor.convertFileSrc(item.coverContentUrl) : null
        }
        this.localLibraryItems.push(_item)
      }
    }
  },
  async mounted() {
    this.$eventBus.$on('new-local-library-item', this.newLocalLibraryItem)
    await this.init()
    if (this.autoScan) {
      this.scanFolder()
    }
  },
  beforeDestroy() {
    this.$eventBus.$off('new-local-library-item', this.newLocalLibraryItem)
  }
}
</script>

<style scoped>
.media-item-container {
  height: calc(100vh - 210px);
  max-height: calc(100vh - 210px);
}
.playerOpen .media-item-container {
  height: calc(100vh - 310px);
  max-height: calc(100vh - 310px);
}
</style>

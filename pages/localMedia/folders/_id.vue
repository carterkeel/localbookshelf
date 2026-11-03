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
import { Capacitor } from '@capacitor/core'
import { Dialog } from '@capacitor/dialog'
import { AbsFileSystem } from '@/plugins/capacitor'
import localMatch from '@/utils/local/matchLibrary'
import localLibraryScan from '@/mixins/localLibraryScan'

export default {
  mixins: [localLibraryScan],
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
      showDialog: false
    }
  },
  computed: {
    itemsNeedingMetadata() {
      return this.localLibraryItems.filter(localMatch.needsMatch)
    },
    canScan() {
      // Audiobooks can be indexed from any folder the user selected (not the app's internal storage)
      return !!this.folder && this.mediaType === 'book' && !this.isInternalStorage
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
    scanFolder() {
      if (!this.canScan) return
      return this.scanFolders([this.folderId])
    },
    fetchMetadata() {
      return this.fetchMetadataFor(this.itemsNeedingMetadata)
    },
    afterLocalScan() {
      return this.init()
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
      this.localLibraryItems = items.map((lmi) => {
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

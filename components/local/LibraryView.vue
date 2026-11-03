<template>
  <div class="w-full px-4 py-3">
    <!-- Header: count + scan for new books -->
    <div class="flex items-center mb-3">
      <p class="text-xs text-fg-muted">{{ summary }}</p>
      <div class="flex-grow" />
      <ui-btn v-if="hasFolders" small :loading="scanning" :disabled="scanning || matching" @click="scanAllFolders">{{ scanning ? scanStatusText : matching ? matchStatusText : $strings.ButtonScanForNewBooks }}</ui-btn>
    </div>
    <div v-if="scanning && scanProgress.total" class="w-full h-1 bg-primary mb-3 rounded overflow-hidden">
      <div class="h-full bg-success" :style="{ width: scanPercent + '%' }" />
    </div>

    <!-- Nothing here yet -->
    <div v-if="loaded && !books.length" class="py-10 text-center">
      <p class="text-sm text-fg-muted mb-3">{{ $strings.MessageLocalLibraryEmpty }}</p>
      <ui-btn color="success" small @click="$router.push('/localMedia/folders?add=book')">{{ $strings.ButtonAddLocalBooks }}</ui-btn>
    </div>

    <!-- Library: every book -->
    <div v-else-if="mode === 'books'" class="flex flex-wrap -mx-1">
      <nuxt-link v-for="b in allSorted" :key="b.id" :to="`/localMedia/item/${b.id}`" class="p-1" :style="{ width: cardWidth + 'px' }">
        <div class="w-full bg-primary rounded overflow-hidden flex items-center justify-center" :style="{ height: cardWidth + 'px' }">
          <img v-if="b.coverPathSrc" :src="b.coverPathSrc" class="w-full h-full object-cover" />
          <p v-else class="text-xs text-center px-2 text-fg-muted">{{ b.media.metadata.title }}</p>
        </div>
        <p class="text-xs mt-1 truncate">{{ b.media.metadata.title }}</p>
        <p v-if="b.media.metadata.authorName" class="text-xs text-fg-muted truncate">{{ b.media.metadata.authorName }}</p>
      </nuxt-link>
    </div>

    <!-- Series -->
    <template v-else-if="mode === 'series'">
      <p v-if="loaded && !bySeries.series.length" class="text-sm text-fg-muted py-6 text-center">{{ $strings.MessageLocalLibraryNoSeries }}</p>
      <div v-for="s in bySeries.series" :key="'s-' + s.name" class="mb-1">
        <button class="w-full flex items-center py-2 text-left" @click="toggle('s-' + s.name)">
          <span class="material-symbols text-xl text-fg-muted mr-1">{{ isOpen('s-' + s.name) ? 'expand_more' : 'chevron_right' }}</span>
          <span class="text-sm font-semibold flex-grow truncate">{{ s.name }}</span>
          <span class="text-xs text-fg-muted pl-2">{{ s.books.length }} {{ $strings.LabelBooks }}</span>
        </button>
        <div v-if="isOpen('s-' + s.name)" class="pl-6">
          <local-book-row v-for="b in s.books" :key="b.id" :book="b" show-sequence show-author />
        </div>
      </div>
    </template>

    <!-- Authors -->
    <template v-else-if="mode === 'authors'">
      <div v-for="a in byAuthor" :key="'a-' + (a.name || '')" class="mb-1">
        <button class="w-full flex items-center py-2 text-left" @click="toggle('a-' + (a.name || ''))">
          <span class="material-symbols text-xl text-fg-muted mr-1">{{ isOpen('a-' + (a.name || '')) ? 'expand_more' : 'chevron_right' }}</span>
          <span class="text-sm font-semibold flex-grow truncate">{{ a.name || $strings.LabelUnknown }}</span>
          <span class="text-xs text-fg-muted pl-2">{{ a.books.length }} {{ $strings.LabelBooks }}</span>
        </button>
        <div v-if="isOpen('a-' + (a.name || ''))" class="pl-6">
          <local-book-row v-for="b in a.books" :key="b.id" :book="b" show-series />
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { Capacitor } from '@capacitor/core'
import organize from '@/utils/local/organize'
import localLibraryScan from '@/mixins/localLibraryScan'

// The Library / Series / Authors tabs for the standalone (no server) library
export default {
  mixins: [localLibraryScan],
  props: {
    mode: { type: String, default: 'books' } // 'books' | 'series' | 'authors'
  },
  data() {
    return {
      books: [],
      loaded: false,
      hasFolders: false,
      open: {},
      cardWidth: 120
    }
  },
  computed: {
    bySeries() {
      return organize.organizeBySeries(this.books)
    },
    byAuthor() {
      return organize.organizeByAuthor(this.books)
    },
    allSorted() {
      return [...this.books].sort((a, b) => a.media.metadata.title.localeCompare(b.media.metadata.title, undefined, { sensitivity: 'base', numeric: true }))
    },
    summary() {
      if (this.mode === 'series') return `${this.bySeries.series.length} ${this.$strings.LabelSeries}`
      if (this.mode === 'authors') return `${this.byAuthor.filter((a) => a.name).length} ${this.$strings.LabelAuthors}`
      return `${this.books.length} ${this.$strings.LabelBooks}`
    }
  },
  methods: {
    isOpen(key) {
      return !!this.open[key]
    },
    toggle(key) {
      this.$set(this.open, key, !this.open[key])
    },
    async afterLocalScan() {
      await this.init()
    },
    async init() {
      const items = (await this.$db.getLocalLibraryItems('book')) || []
      this.books = items
        .filter((i) => i.media?.metadata)
        .map((i) => ({ ...i, coverPathSrc: i.coverContentUrl ? Capacitor.convertFileSrc(i.coverContentUrl) : null }))
      this.hasFolders = (await this.getBookFolderIds()).length > 0
      this.loaded = true
      this.$eventBus.$emit('bookshelf-total-entities', this.books.length)
    }
  },
  mounted() {
    this.cardWidth = Math.floor((window.innerWidth - 32) / 3) - 8
    this.init()
  }
}
</script>

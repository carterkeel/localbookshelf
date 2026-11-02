<template>
  <div class="w-full h-full py-4 px-4 overflow-y-auto library-container">
    <div class="flex items-center mb-3">
      <p class="text-base font-semibold">{{ $strings.HeaderLocalLibrary }}</p>
      <div class="flex-grow" />
      <p class="text-xs text-fg-muted">{{ books.length }} {{ $strings.LabelBooks }}</p>
    </div>

    <div class="flex mb-3 border-b border-white/10">
      <button v-for="t in tabs" :key="t.value" class="px-3 py-2 text-sm" :class="tab === t.value ? 'border-b-2 border-success text-fg' : 'text-fg-muted'" @click="tab = t.value">{{ t.text }}</button>
    </div>

    <div v-if="loaded && !books.length" class="py-6 text-center">
      <p class="text-sm text-fg-muted mb-3">{{ $strings.MessageLocalLibraryEmpty }}</p>
      <ui-btn color="success" small @click="$router.push('/localMedia/folders')">{{ $strings.ButtonAddAudiobookFolder }}</ui-btn>
    </div>

    <template v-else-if="tab === 'series'">
      <div v-for="s in bySeries.series" :key="'s-' + s.name" class="mb-4">
        <p class="text-sm font-semibold mb-1">{{ s.name }} <span class="text-xs text-fg-muted font-normal">({{ s.books.length }})</span></p>
        <book-row v-for="b in s.books" :key="b.id" :book="b" :show-sequence="true" />
      </div>
      <div v-if="bySeries.standalone.length" class="mb-4">
        <p class="text-sm font-semibold mb-1">{{ $strings.LabelStandaloneBooks }} <span class="text-xs text-fg-muted font-normal">({{ bySeries.standalone.length }})</span></p>
        <book-row v-for="b in bySeries.standalone" :key="b.id" :book="b" />
      </div>
    </template>

    <template v-else-if="tab === 'authors'">
      <div v-for="a in byAuthor" :key="'a-' + (a.name || '')" class="mb-4">
        <p class="text-sm font-semibold mb-1">{{ a.name || $strings.LabelUnknown }} <span class="text-xs text-fg-muted font-normal">({{ a.books.length }})</span></p>
        <book-row v-for="b in a.books" :key="b.id" :book="b" :show-series="true" />
      </div>
    </template>

    <template v-else>
      <book-row v-for="b in allSorted" :key="b.id" :book="b" :show-author="true" />
    </template>
  </div>
</template>

<script>
import { Capacitor } from '@capacitor/core'
import organize from '@/utils/local/organize'

// Small inline row component: cover, title and a subtitle, linking to the item page
const BookRow = {
  name: 'BookRow',
  props: { book: Object, showSequence: Boolean, showSeries: Boolean, showAuthor: Boolean },
  computed: {
    md() {
      return this.book.media.metadata
    },
    sub() {
      const parts = []
      const s = this.md.series?.[0]
      if (this.showSequence && s?.sequence) parts.push(`#${s.sequence}`)
      if (this.showSeries && s?.name) parts.push(s.sequence ? `${s.name} #${s.sequence}` : s.name)
      if (this.showAuthor && this.md.authorName) parts.push(this.md.authorName)
      return parts.join(' • ')
    }
  },
  render(h) {
    return h('nuxt-link', { props: { to: `/localMedia/item/${this.book.id}` }, class: 'flex my-1' }, [
      h('div', { class: 'w-12 h-12 min-w-12 min-h-12 bg-primary' }, [this.book.coverPathSrc ? h('img', { attrs: { src: this.book.coverPathSrc }, class: 'w-full h-full object-contain' }) : null]),
      h('div', { class: 'flex-grow px-2 min-w-0' }, [h('p', { class: 'text-sm truncate' }, this.md.title), this.sub ? h('p', { class: 'text-xs text-fg-muted truncate' }, this.sub) : null])
    ])
  }
}

export default {
  components: { BookRow },
  data() {
    return { books: [], loaded: false, tab: 'series' }
  },
  computed: {
    tabs() {
      return [
        { value: 'series', text: this.$strings.LabelSeries },
        { value: 'authors', text: this.$strings.LabelAuthors },
        { value: 'all', text: this.$strings.LabelAll }
      ]
    },
    bySeries() {
      return organize.organizeBySeries(this.books)
    },
    byAuthor() {
      return organize.organizeByAuthor(this.books)
    },
    allSorted() {
      return [...this.books].sort((a, b) => a.media.metadata.title.localeCompare(b.media.metadata.title, undefined, { sensitivity: 'base', numeric: true }))
    }
  },
  methods: {
    async init() {
      const items = (await this.$db.getLocalLibraryItems('book')) || []
      this.books = items
        .filter((i) => i.media?.metadata)
        .map((i) => ({ ...i, coverPathSrc: i.coverContentUrl ? Capacitor.convertFileSrc(i.coverContentUrl) : null }))
      this.loaded = true
    }
  },
  mounted() {
    this.init()
  }
}
</script>

<style scoped>
.library-container {
  height: calc(100vh - 64px);
  max-height: calc(100vh - 64px);
}
.playerOpen .library-container {
  height: calc(100vh - 164px);
  max-height: calc(100vh - 164px);
}
</style>

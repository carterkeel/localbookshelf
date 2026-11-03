<template>
  <nuxt-link :to="`/localMedia/item/${book.id}`" class="flex my-1">
    <div class="w-12 h-12 min-w-12 min-h-12 bg-primary">
      <img v-if="book.coverPathSrc" :src="book.coverPathSrc" class="w-full h-full object-contain" />
    </div>
    <div class="flex-grow px-2 min-w-0 flex flex-col justify-center">
      <p class="text-sm truncate">{{ md.title }}</p>
      <p v-if="sub" class="text-xs text-fg-muted truncate">{{ sub }}</p>
    </div>
  </nuxt-link>
</template>

<script>
// One book in a list: cover, title and a short subtitle
export default {
  props: {
    book: Object,
    showSequence: Boolean, // "#2" (inside a series)
    showSeries: Boolean, // "Series Name #2"
    showAuthor: Boolean
  },
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
  }
}
</script>

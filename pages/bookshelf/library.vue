<template>
  <local-library-view v-if="isStandalone" mode="books" />
  <bookshelf-lazy-bookshelf v-else page="books" />
</template>

<script>
export default {
  computed: {
    // No server connected: show the books indexed on this device
    isStandalone() {
      return !this.$store.state.user.serverConnectionConfig
    }
  },
  async asyncData({ store, params, query }) {
    // Set filter by
    if (query.filter) {
      await store.dispatch('user/updateUserSettings', { mobileFilterBy: query.filter })
    }
  }
}
</script>

<template>
  <bookshelf-lazy-bookshelf page="books" />
</template>

<script>
export default {
  async asyncData({ store, params, query }) {
    // Set filter by (server libraries only; on-device books are filtered by the page itself)
    if (query.filter && store.state.user.serverConnectionConfig) {
      await store.dispatch('user/updateUserSettings', { mobileFilterBy: query.filter })
    }
  }
}
</script>

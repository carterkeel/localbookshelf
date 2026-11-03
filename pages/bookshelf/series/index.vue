<template>
  <local-library-view v-if="isStandalone" mode="series" />
  <bookshelf-lazy-bookshelf v-else page="series" />
</template>

<script>
export default {
  data() {
    return {}
  },
  computed: {
    // No server connected: show the series of the books indexed on this device
    isStandalone() {
      return !this.$store.state.user.serverConnectionConfig
    }
  },
  methods: {},
  mounted() {}
}
</script>

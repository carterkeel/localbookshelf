// Adapts Capacitor's native HTTP client to the small `get(url, {timeout})` interface the metadata
// providers use. The native client is used (not fetch/axios in the web view) so requests to
// third-party metadata services are not blocked by CORS.
//
// Like axios, the returned promise rejects for HTTP error statuses, which the providers rely on.

/**
 * @param {{ get: (options: object) => Promise<{status: number, data: any}> }} capacitorHttp CapacitorHttp from '@capacitor/core'
 */
function createHttp(capacitorHttp) {
  return {
    async get(url, options = {}) {
      const timeout = options.timeout || 10000
      const res = await capacitorHttp.get({
        url,
        connectTimeout: timeout,
        readTimeout: timeout,
        headers: { Accept: 'application/json' }
      })
      if (!res || res.status >= 400) {
        const error = new Error(`Request failed with status ${res?.status}`)
        error.response = res
        throw error
      }
      // CapacitorHttp parses JSON when the response says it is JSON; handle plain strings too
      let data = res.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch (e) {
          // leave as string
        }
      }
      return { data, status: res.status }
    }
  }
}

module.exports = { createHttp }

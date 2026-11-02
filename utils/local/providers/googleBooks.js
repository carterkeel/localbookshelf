// Ported from advplyr/audiobookshelf server/providers/GoogleBooks.js (GPL-3.0).
// Only change: HTTP and logging are injected (axios/Logger removed) so it runs in the app.
class GoogleBooks {
  /**
   * @param {{ http: {get: Function}, logger?: {debug: Function, error: Function} }} deps
   */
  constructor({ http, logger } = {}) {
    this.http = http
    this.logger = logger || { debug() {}, error() {} }
    this.responseTimeout = 10000
  }

  extractIsbn(industryIdentifiers) {
    if (!industryIdentifiers || !industryIdentifiers.length) return null

    var isbnObj = industryIdentifiers.find((i) => i.type === 'ISBN_13') || industryIdentifiers.find((i) => i.type === 'ISBN_10')
    if (isbnObj && isbnObj.identifier) return isbnObj.identifier
    return null
  }

  cleanResult(item) {
    var { id, volumeInfo } = item
    if (!volumeInfo) return null
    const { title, subtitle, authors, publisher, publisherDate, description, industryIdentifiers, categories, imageLinks } = volumeInfo

    let cover = null
    // Selects the largest cover assuming the largest is the last key in the object
    if (imageLinks && Object.keys(imageLinks).length) {
      cover = imageLinks[Object.keys(imageLinks).pop()]
      cover = cover?.replace(/^http:/, 'https:') || null
    }

    return {
      id,
      title,
      subtitle: subtitle || null,
      author: authors ? authors.join(', ') : null,
      publisher,
      publishedYear: publisherDate ? publisherDate.split('-')[0] : null,
      description,
      cover,
      genres: categories && Array.isArray(categories) ? [...categories] : null,
      isbn: this.extractIsbn(industryIdentifiers)
    }
  }

  /**
   * Search for a book by title and author
   * @param {string} title
   * @param {string} author
   * @param {number} [timeout] response timeout in ms
   * @returns {Promise<Object[]>}
   **/
  async search(title, author, timeout = this.responseTimeout) {
    if (!timeout || isNaN(timeout)) timeout = this.responseTimeout

    title = encodeURIComponent(title)
    let queryString = `q=intitle:${title}`
    if (author) {
      author = encodeURIComponent(author)
      queryString += `+inauthor:${author}`
    }
    const url = `https://www.googleapis.com/books/v1/volumes?${queryString}`
    this.logger.debug(`[GoogleBooks] Search url: ${url}`)
    const items = await this.http
      .get(url, {
        timeout
      })
      .then((res) => {
        if (!res || !res.data || !res.data.items) return []
        return res.data.items
      })
      .catch((error) => {
        this.logger.error('[GoogleBooks] Volume search error', error.message)
        return []
      })
    return items.map((item) => this.cleanResult(item))
  }
}

module.exports = GoogleBooks

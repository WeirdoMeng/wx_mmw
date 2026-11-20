const { MAX_PHOTOS } = require('../../utils/photo-picker')

Component({
  properties: {
    items: { type: Array, value: [], observer: 'updateTiles' },
    editable: { type: Boolean, value: false },
    limit: { type: Number, value: MAX_PHOTOS },
    disabled: { type: Boolean, value: false },
    retryable: { type: Boolean, value: false },
    passive: { type: Boolean, value: false },
    fullWidthSingle: { type: Boolean, value: false },
  },

  data: { tiles: [] },

  methods: {
    updateTiles(items) {
      this.setData({
        tiles: items.map((photo, index) => ({
          key: photo.key || photo.id || String(index),
          source: photo.localPath || photo.path || photo.url || '',
          failed: photo.failed === true,
        })),
      })
    },

    onImageError(event) {
      const { index, key, source } = event.currentTarget.dataset
      const tile = this.data.tiles[index]
      if (tile?.key === key && tile.source === source) {
        this.setData({ ['tiles[' + index + '].failed']: true })
      }
    },

    onPreview(event) {
      const { index } = event.currentTarget.dataset
      const tile = this.data.tiles[index]
      if (tile && !this.data.disabled && !this.data.passive) {
        this.triggerEvent('preview', { index, key: tile.key, failed: tile.failed || !tile.source })
      }
    },

    onRemove(event) {
      const { index } = event.currentTarget.dataset
      const tile = this.data.tiles[index]
      if (tile && this.data.editable && !this.data.disabled) this.triggerEvent('remove', { index, key: tile.key })
    },

    onAdd() {
      if (this.data.editable && !this.data.disabled && this.data.tiles.length < this.data.limit) {
        this.triggerEvent('add')
      }
    },
  },
})

import type { Store } from './types'

/** Adapts a chrome.storage area to the `Store` interface. */
export function chromeStore(area: chrome.storage.StorageArea): Store {
  return {
    async get<T>(key: string) {
      const found = await area.get(key)
      return found[key] as T | undefined
    },
    async set(key, value) {
      await area.set({ [key]: value })
    },
    async remove(key) {
      await area.remove(key)
    },
  }
}

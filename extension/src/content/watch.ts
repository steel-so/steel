import { contactKey } from '../lib/extract'
import type { Contact, Message } from '../lib/types'

const DEBOUNCE_MS = 700

/**
 * Reports the contact on screen to the service worker whenever it changes.
 * `read` must be cheap and side-effect free: it runs after every burst of DOM
 * mutations (WhatsApp Web, Gmail and LinkedIn are single-page apps).
 */
export function watchContact(read: () => Contact | null): void {
  let last: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const send = (contact: Contact | null) => {
    const message: Message = { type: 'contact', contact }
    // The extension may have been reloaded under this page; nothing to do then.
    chrome.runtime.sendMessage(message).catch(() => {})
  }

  const push = () => {
    let contact: Contact | null = null
    try {
      contact = read()
    } catch {
      contact = null
    }
    const key = contactKey(contact)
    if (key === last) return
    last = key
    send(contact)
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(push, DEBOUNCE_MS)
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  window.addEventListener('hashchange', schedule)
  window.addEventListener('popstate', schedule)
  window.addEventListener('pagehide', () => send(null))
  push()
}

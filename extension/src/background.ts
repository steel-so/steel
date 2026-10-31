import { makeClient } from './lib/api'
import { chromeStore } from './lib/chrome-stores'
import * as service from './lib/service'
import type { Message } from './lib/types'

const deps: service.Deps = {
  local: chromeStore(chrome.storage.local),
  session: chromeStore(chrome.storage.session),
  makeClient,
  now: () => Date.now(),
}

function setup(): void {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  // The token lives in storage.local, which content scripts can read unless
  // the area is restricted to the extension's own pages.
  const local = chrome.storage.local as unknown as {
    setAccessLevel?: (options: { accessLevel: string }) => Promise<void>
  }
  local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => {})
}

chrome.runtime.onInstalled.addListener(setup)
chrome.runtime.onStartup.addListener(setup)

chrome.tabs.onRemoved.addListener((tabId) => {
  service.forgetTab(deps, tabId).catch(() => {})
})

async function handle(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type === 'contact') {
    // Content scripts only ever report the page they run in.
    if (sender.tab?.id === undefined) return { ok: false }
    await service.saveContact(deps, sender.tab.id, message.contact)
    return { ok: true }
  }
  // Everything below is for the side panel, never for a page's content script.
  if (sender.tab) return { ok: false, error: 'Não permitido.' }
  switch (message.type) {
    case 'state':
      return service.lookup(deps, message.tabId)
    case 'refresh':
      return service.lookup(deps, message.tabId, true)
    case 'save-config':
      return service.saveConfig(deps, message)
    case 'clear-config':
      await service.clearConfig(deps)
      return { ok: true }
    case 'create-lead':
      return service.createLead(deps, message.tabId, message.form)
    case 'create-ticket':
      return service.createTicket(deps, message.tabId, message.form)
    default:
      return { ok: false, error: 'Mensagem desconhecida.' }
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: 'Erro inesperado na extensão.' }))
  return true
})

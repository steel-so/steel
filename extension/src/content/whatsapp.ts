import { buildWhatsAppContact } from '../lib/extract'
import { watchContact } from './watch'

watchContact(() => {
  const header = document.querySelector('#main header')
  if (!header) return null
  const title =
    header.querySelector('span[title]')?.getAttribute('title') ??
    header.querySelector('span[dir="auto"]')?.textContent
  const row = document.querySelector('#main [data-id]')
  return buildWhatsAppContact({ title, messageId: row?.getAttribute('data-id') })
})

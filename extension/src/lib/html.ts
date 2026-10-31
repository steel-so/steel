import { canonicalPhone } from './phone'
import { linkedinProfile } from './extract'
import type { Contact, ContactSource } from './types'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const SOURCE_LABEL: Record<ContactSource, string> = {
  whatsapp: 'WhatsApp Web',
  gmail: 'Gmail',
  linkedin: 'LinkedIn',
}

/**
 * Body of a ticket opened from the side panel. It carries the contact in plain
 * text, with the same identifiers the history search uses, so the next lookup
 * finds this ticket again.
 */
export function ticketDescriptionHtml(contact: Contact | null, note: string): string {
  const parts: string[] = []
  const text = note.trim()
  if (text) {
    for (const paragraph of text.split(/\n{2,}/)) {
      parts.push(`<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
    }
  }
  if (contact) {
    const lines: string[] = [`Origem: ${SOURCE_LABEL[contact.source]}`]
    if (contact.name) lines.push(`Contato: ${contact.name}`)
    for (const phone of contact.phones) {
      lines.push(`Telefone: ${canonicalPhone(phone) ?? phone}`)
    }
    for (const email of contact.emails) lines.push(`E-mail: ${email.toLowerCase()}`)
    const slug = linkedinProfile(contact.linkedin)?.slug
    if (slug) lines.push(`LinkedIn: ${slug}`)
    parts.push(`<p>${lines.map(escapeHtml).join('<br>')}</p>`)
  }
  parts.push('<p><em>Aberto pela extensão do Steel.</em></p>')
  return parts.join('')
}

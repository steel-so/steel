import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'

type ContactFields = Pick<
  WhatsAppConversationDTO,
  'contactName' | 'contactWaId' | 'contactUsername' | 'contactHasPhone'
>

/** Name, else @username, else the number (never a raw BSUID). */
export function contactTitle(contact: ContactFields): string {
  if (contact.contactName) return contact.contactName
  if (contact.contactUsername) return `@${contact.contactUsername}`
  return contact.contactHasPhone ? contact.contactWaId : 'Sem telefone'
}

/** Second line: the phone, else the username, else a plain notice. */
export function contactSubtitle(contact: ContactFields): string {
  if (contact.contactHasPhone) return contact.contactWaId
  return contact.contactUsername
    ? `@${contact.contactUsername} · sem telefone`
    : 'Sem telefone'
}

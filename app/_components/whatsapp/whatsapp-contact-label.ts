import type { WhatsAppContactDTO } from '@/types/whatsapp-contact'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'

type ContactFields = Pick<
  WhatsAppConversationDTO,
  'contactName' | 'contactWaId' | 'contactUsername' | 'contactHasPhone'
>

/** Social channel of a contact (`ig:` / `fb:` identity), else null. */
export function contactSocialChannel(
  contact: Pick<ContactFields, 'contactWaId'>,
): 'Instagram' | 'Messenger' | null {
  if (contact.contactWaId.startsWith('ig:')) return 'Instagram'
  if (contact.contactWaId.startsWith('fb:')) return 'Messenger'
  return null
}

/** Name, else @username, else the number (never a raw BSUID). */
export function contactTitle(contact: ContactFields): string {
  if (contact.contactName) return contact.contactName
  if (contact.contactUsername) return `@${contact.contactUsername}`
  if (contact.contactHasPhone) return contact.contactWaId
  return contactSocialChannel(contact) ?? 'Sem telefone'
}

/** Second line: the phone, else the username, else a plain notice. */
export function contactSubtitle(contact: ContactFields): string {
  if (contact.contactHasPhone) return contact.contactWaId
  const social = contactSocialChannel(contact)
  if (social) {
    return contact.contactUsername
      ? `${social} · @${contact.contactUsername}`
      : social
  }
  return contact.contactUsername
    ? `@${contact.contactUsername} · sem telefone`
    : 'Sem telefone'
}

type ContactRecord = Pick<
  WhatsAppContactDTO,
  'name' | 'waId' | 'username' | 'hasPhone'
>

/** Contact list label: name, else @username, else the number. */
export function contactRecordTitle(contact: ContactRecord): string {
  if (contact.name) return contact.name
  if (contact.username) return `@${contact.username}`
  return contact.hasPhone ? contact.waId : 'Sem telefone'
}

/** Contact list second line / phone column. */
export function contactRecordPhone(contact: ContactRecord): string {
  if (contact.hasPhone) return contact.waId
  return contact.username ? `@${contact.username}` : 'Sem telefone'
}

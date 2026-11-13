/** Description given to a WhatsApp contact that comes from a CRM lead. */
export const LEAD_CONTACT_DESCRIPTION = 'Lead do CRM'

/** Phones worth a WhatsApp contact: DDD + number, with or without 55. */
export function isLeadWhatsAppPhone(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 15
}

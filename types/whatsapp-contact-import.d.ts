import type { WhatsAppImportValidationDTO } from './whatsapp-number-validation'

export interface WhatsAppContactImportResultDTO
  extends Partial<WhatsAppImportValidationDTO> {
  created: number
  updated: number
  skipped: number
  rejected: { line: number; message: string }[]
}

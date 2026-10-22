import type { WhatsAppBroadcastListDTO } from './whatsapp-broadcast'
import type { WhatsAppImportValidationDTO } from './whatsapp-number-validation'

export interface WhatsAppBroadcastImportRejectedRowDTO {
  rowNumber: number
  reason: string
}

export interface WhatsAppBroadcastImportResultDTO
  extends Partial<WhatsAppImportValidationDTO> {
  broadcastList: WhatsAppBroadcastListDTO | null
  createdCount: number
  rejectedRows: WhatsAppBroadcastImportRejectedRowDTO[]
}

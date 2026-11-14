import type { WhatsAppBroadcastListDTO } from './whatsapp-broadcast'
import type { WhatsAppImportValidationDTO } from './whatsapp-number-validation'

export interface WhatsAppBroadcastImportRejectedRowDTO {
  rowNumber: number
  reason: string
}

export interface WhatsAppBroadcastImportPreviewRowDTO {
  rowNumber: number
  phone: string
  contactName: string | null
  /** When the reminder will be sent (ISO). */
  scheduledAt: string
  /** The reference date from the spreadsheet (ISO). */
  appointmentAt: string
}

export interface WhatsAppBroadcastImportResultDTO
  extends Partial<WhatsAppImportValidationDTO> {
  broadcastList: WhatsAppBroadcastListDTO | null
  createdCount: number
  rejectedRows: WhatsAppBroadcastImportRejectedRowDTO[]
  /** Set only for a dry run: how many rows would be scheduled. */
  validCount?: number
  /** Set only for a dry run: the first rows with the computed send date. */
  preview?: WhatsAppBroadcastImportPreviewRowDTO[]
}

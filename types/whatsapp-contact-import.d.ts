export interface WhatsAppContactImportResultDTO {
  created: number
  updated: number
  skipped: number
  rejected: { line: number; message: string }[]
}

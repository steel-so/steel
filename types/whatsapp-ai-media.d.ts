export interface WhatsAppAiMediaDTO {
  id: string
  workspaceId: string
  /** Identifier the AI tool uses (snake_case of the name). */
  key: string
  name: string
  /** When the AI must send the file (free text written by the user). */
  whenToSend: string
  mediaUrl: string
  mediaType: 'IMAGE' | 'VIDEO'
  mimeType: string
  fileName: string
  sizeBytes: number
  active: boolean
  createdAt: string
  updatedAt: string
}

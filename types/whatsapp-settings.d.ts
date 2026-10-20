export interface WhatsAppSettingsDTO {
  workspaceId: string
  /** 0 = fechamento automático desligado. */
  autoCloseAfterHours: number
  sentimentAlertEnabled: boolean
  /** Média da conversa (-1 a 0) a partir da qual o alerta dispara. */
  sentimentAlertThreshold: number
  sentimentAlertNotifyInApp: boolean
  sentimentAlertNotifyEmail: boolean
  /** Vazio = todos os OWNER/ADMIN. */
  sentimentAlertRecipientIds: string[]
  sentimentAlertAssignToId: string | null
  sentimentAlertCooldownHours: number
  /** Gravação das ligações do "Ligar" (desligada por padrão). */
  callRecordingEnabled: boolean
  /** Aviso efetivo (o salvo ou o padrão) que o atendente lê ao contato. */
  callRecordingNotice: string
  callRecordingRetentionDays: number
  callTranscriptionEnabled: boolean
  /** Status de fechamento escolhidos ao fechar: mínimo (0 = opcional) e máximo. */
  closeStatusMinSelections: number
  closeStatusMaxSelections: number
}

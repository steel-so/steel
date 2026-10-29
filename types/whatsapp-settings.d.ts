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
  /** Horário de atendimento (America/Sao_Paulo); fora dele envios travam. */
  businessHoursEnabled: boolean
  /** `HH:mm`. */
  businessHoursStart: string
  businessHoursEnd: string
  /** 0 = domingo … 6 = sábado. */
  businessHoursDays: number[]
  /** Conversa sem atendente: aviso no app / por e-mail aos supervisores. */
  unassignedAlertNotifyInApp: boolean
  unassignedAlertNotifyEmail: boolean
  /** Minutos sem atendente até o lembrete (0 = sem lembrete). */
  unassignedReminderMinutes: number
  /** Distribuição automática da fila (OFF = manual, como sempre). */
  distributionMode: 'OFF' | 'ROUND_ROBIN' | 'LEAST_LOADED'
  /** Teto de conversas abertas por atendente; nulo = sem limite. */
  distributionMaxOpenPerAgent: number | null
  /** Só distribui para atendentes com presença Disponível. */
  distributionOnlyAvailable: boolean
  /** Fora do horário de atendimento a conversa espera na fila. */
  distributionRespectBusinessHours: boolean
  /** Dias até a checagem "tem zap?" de um contato valer de novo. */
  whatsappCheckTtlDays: number
  /** Marketing Messages Lite API for marketing templates (Meta). */
  marketingLiteEnabled: boolean
  /** Allow Meta to fall back to the Cloud API when Lite can't deliver. */
  marketingLiteCloudFallback: boolean
}

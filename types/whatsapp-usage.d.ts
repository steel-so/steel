export interface WhatsAppUsageMetricDTO {
  used: number
  /** `null` = unlimited. */
  limit: number | null
  /** 0–100 (floored, capped); `null` when unlimited. */
  percent: number | null
  /** At or over the limit: sends of this kind are refused. */
  reached: boolean
}

export interface WhatsAppUsageDTO {
  workspaceId: string
  /** `YYYY-MM` (America/Sao_Paulo). */
  period: string
  /** OWNER/ADMIN — may change the limits. */
  canManage: boolean
  conversations: WhatsAppUsageMetricDTO
  messages: WhatsAppUsageMetricDTO
}

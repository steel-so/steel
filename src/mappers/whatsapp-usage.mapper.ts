import type { WhatsAppSettings, WhatsAppUsageMonthly } from '@prisma/client'
import type {
  WhatsAppUsageDTO,
  WhatsAppUsageMetricDTO,
} from '@/types/whatsapp-usage'

function toMetric(used: number, limit: number | null): WhatsAppUsageMetricDTO {
  if (limit === null) return { used, limit, percent: null, reached: false }
  return {
    used,
    limit,
    percent: Math.min(100, Math.floor((used / limit) * 100)),
    reached: used >= limit,
  }
}

export function toWhatsAppUsageDTO(input: {
  workspaceId: string
  period: string
  usage: WhatsAppUsageMonthly | null
  settings: WhatsAppSettings | null
  canManage: boolean
}): WhatsAppUsageDTO {
  return {
    workspaceId: input.workspaceId,
    period: input.period,
    canManage: input.canManage,
    conversations: toMetric(
      input.usage?.conversations ?? 0,
      input.settings?.monthlyConversationLimit ?? null,
    ),
    messages: toMetric(
      input.usage?.outboundMessages ?? 0,
      input.settings?.monthlyMessageLimit ?? null,
    ),
  }
}

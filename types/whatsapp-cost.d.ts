export type WhatsAppCostCategoryDTO =
  | 'MARKETING'
  | 'UTILITY'
  | 'AUTHENTICATION'
  | 'SERVICE'

export type WhatsAppCostSourceDTO =
  | 'BROADCAST'
  | 'AI_CAMPAIGN'
  | 'CRM_CAMPAIGN'
  | 'AGENT'
  | 'AI_REPLY'
  | 'BUTTON'
  | 'OTHER'

export interface WhatsAppPriceDTO {
  id: string
  category: Exclude<WhatsAppCostCategoryDTO, 'SERVICE'>
  country: string
  currency: string
  unitPrice: number
  validFrom: string
  /** Seeded default — "valores de referência", confirm on the Meta account. */
  reference: boolean
}

export interface WhatsAppCostSettingsDTO {
  /** Monthly budget in BRL; null = no budget (no alerts). */
  monthlyCostBudget: number | null
  connections: {
    id: string
    label: string
    provider: 'META' | 'ZAPI'
    monthlyFee: number | null
  }[]
}

export interface WhatsAppCostBreakdownRowDTO {
  key: string
  label: string
  messages: number
  cost: number
}

export interface WhatsAppCostConnectionRowDTO {
  connectionId: string
  label: string
  provider: 'META' | 'ZAPI'
  messages: number
  conversations: number
  /** Estimated Meta charges (zero for Z-API). */
  variableCost: number
  /** Flat monthly fee prorated to the period. */
  fee: number
  totalCost: number
  costPerMessage: number
  costPerConversation: number
}

export interface WhatsAppCostProviderRowDTO {
  provider: 'META' | 'ZAPI'
  connections: number
  messages: number
  conversations: number
  variableCost: number
  fee: number
  totalCost: number
  costPerMessage: number
  costPerConversation: number
}

export interface WhatsAppCostReportDTO {
  workspaceId: string
  currency: string
  from: string
  to: string
  connectionId: string | null
  totals: {
    messages: number
    templateMessages: number
    serviceMessages: number
    variableCost: number
    fees: number
    totalCost: number
    conversations: number
    resolvedConversations: number
    costPerConversation: number
    costPerResolvedConversation: number
  }
  trend: { date: string; cost: number; messages: number }[]
  byConnection: WhatsAppCostConnectionRowDTO[]
  byProvider: WhatsAppCostProviderRowDTO[]
  byCategory: WhatsAppCostBreakdownRowDTO[]
  byBroadcast: WhatsAppCostBreakdownRowDTO[]
  byAiCampaign: WhatsAppCostBreakdownRowDTO[]
  byAgent: WhatsAppCostBreakdownRowDTO[]
  bySource: WhatsAppCostBreakdownRowDTO[]
  /** Current-month projection from the run-rate (ignores the filters). */
  projection: {
    period: string
    monthCost: number
    variableToDate: number
    fees: number
    daysElapsed: number
    daysInMonth: number
  }
  /** Month-to-date versus the budget, independent of the period filter. */
  budget: {
    monthlyCostBudget: number | null
    spent: number
    percent: number | null
    level: 80 | 100 | null
  }
}

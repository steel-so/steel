import type { SdSettings } from '@prisma/client'
import { SD_DEFAULT_TICKET_PREFIXES } from '@/src/schemas/sd-settings.schema'
import type {
  SdPublicSettingsDTO,
  SdSettingsDTO,
  SdTicketPrefixesDTO,
} from '@/types/sd-settings'

/** Prefixos salvos + padrão para qualquer tipo ausente/inválido no JSON. */
export function toSdTicketPrefixes(value: unknown): SdTicketPrefixesDTO {
  const saved =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const pick = (key: keyof SdTicketPrefixesDTO) =>
    typeof saved[key] === 'string' && saved[key]
      ? (saved[key] as string)
      : SD_DEFAULT_TICKET_PREFIXES[key]
  return {
    INCIDENT: pick('INCIDENT'),
    SERVICE_REQUEST: pick('SERVICE_REQUEST'),
    CHANGE: pick('CHANGE'),
    PROBLEM: pick('PROBLEM'),
  }
}

export function toSdSettingsDTO(settings: SdSettings): SdSettingsDTO {
  return {
    id: settings.id,
    workspaceId: settings.workspaceId,
    nextTicketNumber: settings.nextTicketNumber,
    ticketPrefixes: toSdTicketPrefixes(settings.ticketPrefixes),
    defaultDepartmentId: settings.defaultDepartmentId,
    defaultSlaPolicyId: settings.defaultSlaPolicyId,
    whatsappConnectionId: settings.whatsappConnectionId,
    whatsappSendAcknowledgement: settings.whatsappSendAcknowledgement,
    portalEnabled: settings.portalEnabled,
    portalTicketTypes: settings.portalTicketTypes,
    portalCompanyScope: settings.portalCompanyScope,
    requireSignatureOnClose: settings.requireSignatureOnClose,
    requireSolutionOnResolve: settings.requireSolutionOnResolve,
    autoCloseResolvedAfterHours: settings.autoCloseResolvedAfterHours,
    slaAtRiskPercent: settings.slaAtRiskPercent,
    reopenOnRequesterReply: settings.reopenOnRequesterReply,
    autoAssignRoundRobin: settings.autoAssignRoundRobin,
    kbReviewIntervalDays: settings.kbReviewIntervalDays,
    aiEnabled: settings.aiEnabled,
    aiPreServiceEnabled: settings.aiPreServiceEnabled,
    aiAutoTriageEnabled: settings.aiAutoTriageEnabled,
    aiWhatsappAutoReply: settings.aiWhatsappAutoReply,
    aiPersona: settings.aiPersona,
    aiInstructions: settings.aiInstructions,
    aiHandoffKeywords: settings.aiHandoffKeywords,
    updatedById: settings.updatedById,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  }
}

export function toSdPublicSettingsDTO(
  settings: SdSettingsDTO,
): SdPublicSettingsDTO {
  return {
    ticketPrefixes: settings.ticketPrefixes,
    portalEnabled: settings.portalEnabled,
    portalTicketTypes: settings.portalTicketTypes,
    portalCompanyScope: settings.portalCompanyScope,
    requireSignatureOnClose: settings.requireSignatureOnClose,
    requireSolutionOnResolve: settings.requireSolutionOnResolve,
    reopenOnRequesterReply: settings.reopenOnRequesterReply,
    slaAtRiskPercent: settings.slaAtRiskPercent,
    defaultDepartmentId: settings.defaultDepartmentId,
    aiEnabled: settings.aiEnabled,
    aiPreServiceEnabled: settings.aiPreServiceEnabled,
  }
}

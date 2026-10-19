import type { CrmApolloImport, WorkspaceIntegration } from '@prisma/client'
import type {
  ApolloContact,
  ApolloPersonPreview,
} from '@/src/lib/integrations/apollo-client'
import type {
  CrmApolloConnectionDTO,
  CrmApolloContactDTO,
  CrmApolloImportDTO,
  CrmApolloPersonDTO,
} from '@/types/crm-apollo'

/** Reads `config.defaultMailingListId` defensively (the column is free JSON). */
export function apolloDefaultMailingListId(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null
  const value = (config as Record<string, unknown>).defaultMailingListId
  return typeof value === 'string' && value ? value : null
}

export function toCrmApolloConnectionDTO(
  integration: WorkspaceIntegration | null,
  phoneRevealAvailable = false,
): CrmApolloConnectionDTO {
  if (!integration) {
    return {
      connected: false,
      status: null,
      statusError: null,
      keyHint: null,
      lastCheckedAt: null,
      defaultMailingListId: null,
      phoneRevealAvailable,
    }
  }
  return {
    connected: true,
    status: integration.status,
    statusError: integration.statusError,
    keyHint: integration.externalName,
    lastCheckedAt: integration.lastCheckedAt?.toISOString() ?? null,
    defaultMailingListId: apolloDefaultMailingListId(integration.config),
    phoneRevealAvailable,
  }
}

export function toCrmApolloPersonDTO(
  person: ApolloPersonPreview,
): CrmApolloPersonDTO {
  return {
    id: person.id,
    name:
      [person.firstName, person.lastNameObfuscated].filter(Boolean).join(' ') ||
      'Sem nome',
    title: person.title,
    organizationName: person.organizationName,
    hasEmail: person.hasEmail,
  }
}

export function toCrmApolloContactDTO(
  contact: ApolloContact,
): CrmApolloContactDTO {
  return {
    id: contact.id,
    name: contact.name || contact.email || 'Sem nome',
    email: contact.email,
    emailStatus: contact.emailStatus,
    title: contact.title,
    organizationName: contact.organizationName,
    linkedinUrl: contact.linkedinUrl,
    city: contact.city,
  }
}

export function toCrmApolloImportDTO(row: CrmApolloImport): CrmApolloImportDTO {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    filters: row.filters,
    mailingListId: row.mailingListId,
    requestedCount: row.requestedCount,
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    creditsConsumed: row.creditsConsumed,
    revealPhones: row.revealPhones,
    phonesRequested: row.phonesRequested,
    phonesReceived: row.phonesReceived,
    error: row.error,
    createdById: row.createdById,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

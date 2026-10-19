import { createId } from '@paralleldrive/cuid2'
import type { Prisma, WorkspaceIntegration } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { crmApolloNotConnected, validationError } from '@/src/errors'
import { encryptConnectionSecret } from '@/src/lib/crypto'
import {
  APOLLO_SOURCE,
  type ApolloRateLimit,
  maskApolloKey,
} from '@/src/lib/integrations/apollo'
import { ApolloClient } from '@/src/lib/integrations/apollo-client'
import {
  apolloWebhookToken,
  hashApolloWebhookToken,
  isApolloPhoneRevealAvailable,
} from '@/src/lib/integrations/apollo-webhook'
import { CrmApolloImportJob } from '@/src/lib/queue/jobs'
import { getCrmApolloImportQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  apolloDefaultMailingListId,
  toCrmApolloConnectionDTO,
  toCrmApolloContactDTO,
  toCrmApolloImportDTO,
  toCrmApolloPersonDTO,
} from '@/src/mappers/crm-apollo.mapper'
import { toWorkspaceIntegrationDTO } from '@/src/mappers/workspace-integration.mapper'
import { CrmApolloImportRepository } from '@/src/repositories/crm-apollo-import.repository'
import { CrmMailingListRepository } from '@/src/repositories/crm-mailing-list.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import {
  type ApolloListContactsDTO,
  type ApolloSearchDTO,
  type ConnectApolloDTO,
  type CreateApolloImportDTO,
  hasApolloFilters,
  type ListApolloImportsDTO,
  type UpdateApolloSettingsDTO,
} from '@/src/schemas/crm-apollo.schema'
import type {
  CrmApolloConnectionDTO,
  CrmApolloContactsResultDTO,
  CrmApolloImportDTO,
  CrmApolloLabelDTO,
  CrmApolloRateLimitDTO,
  CrmApolloSearchResultDTO,
} from '@/types/crm-apollo'
import type {
  WorkspaceIntegrationDTO,
  WorkspaceIntegrationTestDTO,
} from '@/types/workspace-integration'
import { assertModuleMember, assertPrivileged } from './authz'
import { decryptSdIntegrationToken } from './sd-integration-credentials'
import { WorkspaceIntegrationService } from './workspace-integration.service'

/**
 * Apollo.io lead import (CRM). The workspace brings ITS OWN API key (admin
 * only, stored encrypted in `WorkspaceIntegration`, never returned); any
 * member with lead-creation rights can search (0 credits), preview and start
 * an import. The enrichment that spends credits runs in the worker
 * (`CrmApolloImportRunner`).
 */

function rateLimitDTO(limit: ApolloRateLimit): CrmApolloRateLimitDTO {
  return limit
}

/** Config without secrets: only the default mailing list for now. */
function configJson(
  defaultMailingListId: string | null,
): Prisma.InputJsonValue {
  return defaultMailingListId ? { defaultMailingListId } : {}
}

async function requireLeadCreator(actorId: string, workspaceId: string) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'leads',
    action: 'CREATE',
  })
}

/** Live Apollo connection + decrypted key (or `CRM_APOLLO_NOT_CONNECTED`). */
async function loadKey(
  workspaceId: string,
): Promise<Result<{ integration: WorkspaceIntegration; key: string }>> {
  const found = await WorkspaceIntegrationRepository.findByKind(
    workspaceId,
    'APOLLO',
  )
  if (!found.ok) return found
  if (!found.value) return err(crmApolloNotConnected())
  const key = await decryptSdIntegrationToken(found.value)
  if (!key.ok) return err(crmApolloNotConnected())
  return ok({ integration: found.value, key: key.value })
}

/** Remembers a rejected key so the settings card shows it. */
async function noteKeyProblem(
  integration: WorkspaceIntegration,
  code: string,
  message: string,
): Promise<void> {
  if (code !== 'CRM_APOLLO_INVALID_KEY') return
  await WorkspaceIntegrationRepository.markError(integration.id, message)
}

export const CrmApolloService = {
  /** State of the connection for the import page (any CRM member). */
  async getConnection(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmApolloConnectionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const found = await WorkspaceIntegrationRepository.findByKind(
      workspaceId,
      'APOLLO',
    )
    if (!found.ok) return found
    return ok(
      toCrmApolloConnectionDTO(found.value, isApolloPhoneRevealAvailable()),
    )
  },

  /** Saves the key after Apollo confirms it (admin only). */
  async connect(
    actorId: string,
    workspaceId: string,
    dto: ConnectApolloDTO,
  ): Promise<Result<WorkspaceIntegrationDTO>> {
    const allowed = await assertPrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const health = await ApolloClient.health(dto.apiKey)
    if (!health.ok) {
      auditMutation({
        entity: 'workspace_integration',
        action: 'connect',
        actorId,
        outcome: 'failure',
        reason: health.error.code,
        meta: { workspaceId, kind: 'APOLLO' },
      })
      return health
    }

    const current = await WorkspaceIntegrationRepository.findByKind(
      workspaceId,
      'APOLLO',
    )
    if (!current.ok) return current

    const saved = await WorkspaceIntegrationRepository.connect(
      workspaceId,
      'APOLLO',
      APOLLO_SOURCE,
      {
        externalName: maskApolloKey(dto.apiKey),
        baseUrl: null,
        encryptedToken: await encryptConnectionSecret(dto.apiKey),
        encryptedSigningSecret: null,
        config: configJson(apolloDefaultMailingListId(current.value?.config)),
        createdById: actorId,
        status: 'ACTIVE',
        statusError: null,
        lastCheckedAt: new Date(),
      },
    )
    if (!saved.ok) return saved

    // Never the key: only that a connection was made.
    auditMutation({
      entity: 'workspace_integration',
      action: 'connect',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, kind: 'APOLLO' },
    })
    return ok(toWorkspaceIntegrationDTO(saved.value))
  },

  /** Default destination list of the imports (admin only). */
  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateApolloSettingsDTO,
  ): Promise<Result<CrmApolloConnectionDTO>> {
    const allowed = await assertPrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const integration = await WorkspaceIntegrationRepository.findByKind(
      workspaceId,
      'APOLLO',
    )
    if (!integration.ok) return integration
    if (!integration.value) return err(crmApolloNotConnected())

    if (dto.defaultMailingListId) {
      const list = await CrmMailingListRepository.findById(
        dto.defaultMailingListId,
        workspaceId,
      )
      if (!list.ok) return list
    }
    const updated = await WorkspaceIntegrationRepository.update(
      integration.value.id,
      workspaceId,
      { config: configJson(dto.defaultMailingListId) },
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'workspace_integration',
      action: 'update',
      actorId,
      targetId: updated.value.id,
      meta: { workspaceId, kind: 'APOLLO', fields: ['defaultMailingListId'] },
    })
    return ok(
      toCrmApolloConnectionDTO(updated.value, isApolloPhoneRevealAvailable()),
    )
  },

  /** "Testar conexão" (admin only) — shared with the integrations page. */
  test(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WorkspaceIntegrationTestDTO>> {
    return WorkspaceIntegrationService.test(actorId, workspaceId, 'APOLLO')
  },

  disconnect(actorId: string, workspaceId: string): Promise<Result<void>> {
    return WorkspaceIntegrationService.disconnect(
      actorId,
      workspaceId,
      'APOLLO',
    )
  },

  /** Preview of a people search: 0 credits, no e-mail in the answer. */
  async search(
    actorId: string,
    workspaceId: string,
    dto: ApolloSearchDTO,
  ): Promise<Result<CrmApolloSearchResultDTO>> {
    const membership = await requireLeadCreator(actorId, workspaceId)
    if (!membership.ok) return membership
    if (!hasApolloFilters(dto.filters)) {
      return err(
        validationError('Preencha ao menos um filtro para buscar na Apollo'),
      )
    }

    const loaded = await loadKey(workspaceId)
    if (!loaded.ok) return loaded
    const result = await ApolloClient.searchPeople(
      loaded.value.key,
      dto.filters,
      dto.page,
      dto.perPage,
    )
    if (!result.ok) {
      await noteKeyProblem(
        loaded.value.integration,
        result.error.code,
        result.error.message,
      )
      return result
    }
    const { data, rateLimit } = result.value
    return ok({
      totalEntries: data.totalEntries,
      page: dto.page,
      perPage: dto.perPage,
      totalPages: Math.ceil(data.totalEntries / dto.perPage),
      people: data.people.map(toCrmApolloPersonDTO),
      rateLimit: rateLimitDTO(rateLimit),
    })
  },

  /** The account's saved lists (a non-master key gets 403 from Apollo). */
  async listLabels(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmApolloLabelDTO[]>> {
    const membership = await requireLeadCreator(actorId, workspaceId)
    if (!membership.ok) return membership
    const loaded = await loadKey(workspaceId)
    if (!loaded.ok) return loaded
    const result = await ApolloClient.listLabels(loaded.value.key)
    if (!result.ok) {
      await noteKeyProblem(
        loaded.value.integration,
        result.error.code,
        result.error.message,
      )
      return result
    }
    return ok(result.value.data.filter((label) => label.id))
  },

  /** Contacts of a saved list — 0 credits, e-mail already included. */
  async listContacts(
    actorId: string,
    workspaceId: string,
    labelId: string,
    dto: ApolloListContactsDTO,
  ): Promise<Result<CrmApolloContactsResultDTO>> {
    const membership = await requireLeadCreator(actorId, workspaceId)
    if (!membership.ok) return membership
    const loaded = await loadKey(workspaceId)
    if (!loaded.ok) return loaded
    const result = await ApolloClient.searchContacts(
      loaded.value.key,
      labelId,
      dto.page,
      dto.perPage,
    )
    if (!result.ok) {
      await noteKeyProblem(
        loaded.value.integration,
        result.error.code,
        result.error.message,
      )
      return result
    }
    const { data, rateLimit } = result.value
    return ok({
      totalEntries: data.totalEntries,
      page: dto.page,
      perPage: dto.perPage,
      totalPages: data.totalPages,
      contacts: data.contacts.map(toCrmApolloContactDTO),
      rateLimit: rateLimitDTO(rateLimit),
    })
  },

  /** Creates the run and queues it; credits are only spent by the worker. */
  async createImport(
    actorId: string,
    workspaceId: string,
    dto: CreateApolloImportDTO,
  ): Promise<Result<CrmApolloImportDTO>> {
    const membership = await requireLeadCreator(actorId, workspaceId)
    if (!membership.ok) return membership

    const loaded = await loadKey(workspaceId)
    if (!loaded.ok) return loaded

    if (dto.revealPhones && !isApolloPhoneRevealAvailable()) {
      return err(
        validationError(
          'A revelação de telefones exige que o Steel esteja publicado em HTTPS, para a Apollo entregar os números. Importe sem telefones.',
        ),
      )
    }

    if (dto.mailingListId) {
      const list = await CrmMailingListRepository.findById(
        dto.mailingListId,
        workspaceId,
      )
      if (!list.ok) return list
    }

    const id = createId()
    const common = {
      id,
      workspaceId,
      createdById: actorId,
      mailingListId: dto.mailingListId ?? null,
      revealPhones: dto.revealPhones,
      webhookTokenHash: dto.revealPhones
        ? hashApolloWebhookToken(apolloWebhookToken(id))
        : null,
    }
    const created =
      dto.source === 'SEARCH'
        ? await CrmApolloImportRepository.create({
            ...common,
            source: 'SEARCH',
            filters: dto.filters as Prisma.InputJsonValue,
            apolloIds: [...new Set(dto.apolloIds)],
            requestedCount: new Set(dto.apolloIds).size,
          })
        : await CrmApolloImportRepository.create({
            ...common,
            source: 'LIST',
            filters: {
              labelId: dto.labelId,
              labelName: dto.labelName ?? null,
            },
            apolloIds: [],
            contacts: uniqueContacts(dto.contacts) as Prisma.InputJsonValue,
            requestedCount: uniqueContacts(dto.contacts).length,
          })
    if (!created.ok) return created

    try {
      await getCrmApolloImportQueue().add(CrmApolloImportJob.Run, {
        importId: created.value.id,
      })
    } catch (error) {
      logger.error(
        'crm.apollo.enqueue_failed',
        logFields(
          { component: 'CrmApolloService', workspaceId },
          {
            importId: created.value.id,
            cause: error instanceof Error ? error.message : String(error),
          },
        ),
      )
      await CrmApolloImportRepository.setStatus(created.value.id, 'FAILED', {
        error: 'Não foi possível enfileirar a importação',
        finishedAt: new Date(),
      })
      return err(
        validationError(
          'Não foi possível iniciar a importação agora. Tente de novo.',
        ),
      )
    }

    auditMutation({
      entity: 'crm_apollo_import',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        source: dto.source,
        requested: created.value.requestedCount,
        mailingListId: dto.mailingListId ?? null,
        revealPhones: dto.revealPhones,
      },
    })
    return ok(toCrmApolloImportDTO(created.value))
  },

  async listImports(
    actorId: string,
    workspaceId: string,
    query: ListApolloImportsDTO,
  ): Promise<Result<CrmApolloImportDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const rows = await CrmApolloImportRepository.listByWorkspace(
      workspaceId,
      query.limit,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toCrmApolloImportDTO))
  },

  async getImport(
    actorId: string,
    workspaceId: string,
    importId: string,
  ): Promise<Result<CrmApolloImportDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const row = await CrmApolloImportRepository.findById(importId, workspaceId)
    if (!row.ok) return row
    return ok(toCrmApolloImportDTO(row.value))
  },
}

function uniqueContacts<T extends { id: string }>(contacts: T[]): T[] {
  const seen = new Set<string>()
  return contacts.filter((c) => !seen.has(c.id) && !!seen.add(c.id))
}

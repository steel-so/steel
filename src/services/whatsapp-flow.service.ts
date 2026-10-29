import { createId } from '@paralleldrive/cuid2'
import type { Prisma, WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  validationError,
  whatsappConnectionNotFound,
  whatsappFlowInvalid,
  whatsappFlowLimitReached,
  whatsappFlowMetaRejected,
  whatsappFlowNotFound,
  whatsappFlowNotSendable,
} from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { buildFlowToken } from '@/src/lib/whatsapp/flows/answers'
import { flowFromCrmForm } from '@/src/lib/whatsapp/flows/from-crm-form'
import {
  buildMetaFlowJson,
  firstScreenId,
} from '@/src/lib/whatsapp/flows/meta-json'
import { flowFromPreset } from '@/src/lib/whatsapp/flows/templates'
import { flowCrmIssues } from '@/src/lib/whatsapp/flows/validate'
import {
  createMetaFlow,
  deleteMetaFlow,
  deprecateMetaFlow,
  getMetaFlow,
  type MetaFlowAuth,
  publishMetaFlow,
  uploadMetaFlowJson,
} from '@/src/lib/whatsapp/meta-flows'
import { createMetaTemplate } from '@/src/lib/whatsapp/meta-templates'
import {
  parseStoredDefinition,
  toWhatsAppFlowDTO,
  toWhatsAppFlowListItemDTO,
  toWhatsAppFlowResponseDTO,
} from '@/src/mappers/whatsapp-flow.mapper'
import { toWhatsAppTemplateDTO } from '@/src/mappers/whatsapp-template.mapper'
import { CrmFormRepository } from '@/src/repositories/crm-form.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import { WhatsAppFlowResponseRepository } from '@/src/repositories/whatsapp-flow-response.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import {
  type CreateWhatsAppFlowDTO,
  type CreateWhatsAppFlowTemplateDTO,
  FLOW_LIMITS,
  FlowDefinitionSchema,
  type ListWhatsAppFlowResponsesDTO,
  type PublishWhatsAppFlowDTO,
  type SendWhatsAppFlowDTO,
  type UpdateWhatsAppFlowDTO,
} from '@/src/schemas/whatsapp-flow.schema'
import type {
  WhatsAppFlowDTO,
  WhatsAppFlowListItemDTO,
  WhatsAppFlowMetaJsonDTO,
  WhatsAppFlowPreviewDTO,
  WhatsAppFlowPublishDTO,
  WhatsAppFlowResponsesPageDTO,
  WhatsAppFlowSendDTO,
} from '@/types/whatsapp-flow'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { WhatsAppMessageService } from './whatsapp-message.service'

const VIEW = { resource: 'conversations', action: 'VIEW' } as const
const SEND = { resource: 'conversations', action: 'CREATE' } as const

async function loadOwned(workspaceId: string, id: string) {
  const flow = await WhatsAppFlowRepository.findById(id, workspaceId)
  if (!flow.ok) return flow
  if (!flow.value) return err(whatsappFlowNotFound())
  return ok(flow.value)
}

/** Flows live in a WABA: only Meta connections can own one. */
async function loadMetaConnection(
  workspaceId: string,
  connectionId: string,
): Promise<Result<WhatsAppConnection>> {
  const connection = await WhatsAppConnectionRepository.findById(
    connectionId,
    workspaceId,
  )
  if (!connection.ok) return connection
  if (!connection.value) return err(whatsappConnectionNotFound())
  if (connection.value.provider !== 'META') {
    return err(
      badRequest(
        'WhatsApp Flows estão disponíveis apenas para conexões da API oficial da Meta',
      ),
    )
  }
  return ok(connection.value)
}

async function metaAuth(
  connection: WhatsAppConnection,
): Promise<Result<MetaFlowAuth & { wabaId: string }>> {
  if (!connection.metaWabaId || !connection.encryptedMetaAccessToken) {
    return err(badRequest('A conexão Meta está sem credenciais configuradas'))
  }
  return ok({
    wabaId: connection.metaWabaId,
    accessToken: await decryptConnectionSecret(
      connection.encryptedMetaAccessToken,
    ),
  })
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value))
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export const WhatsAppFlowService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppFlowListItemDTO[]>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      VIEW,
    )
    if (!access.ok) return access

    const flows = await WhatsAppFlowRepository.listByWorkspace(workspaceId)
    if (!flows.ok) return flows
    const counts =
      await WhatsAppFlowResponseRepository.countsByFlow(workspaceId)
    if (!counts.ok) return counts

    return ok(
      flows.value.map((flow) => {
        let sent = 0
        let completed = 0
        for (const row of counts.value) {
          if (row.flowId !== flow.id) continue
          sent += row.count
          if (row.status === 'COMPLETED') completed += row.count
        }
        return toWhatsAppFlowListItemDTO(flow, { sent, completed })
      }),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppFlowDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      VIEW,
    )
    if (!access.ok) return access
    const flow = await loadOwned(workspaceId, id)
    if (!flow.ok) return flow
    return ok(toWhatsAppFlowDTO(flow.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppFlowDTO,
  ): Promise<Result<WhatsAppFlowDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const connection = await loadMetaConnection(workspaceId, dto.connectionId)
    if (!connection.ok) return connection

    const count = await WhatsAppFlowRepository.count(workspaceId)
    if (!count.ok) return count
    if (count.value >= FLOW_LIMITS.perWorkspace) {
      return err(whatsappFlowLimitReached(FLOW_LIMITS.perWorkspace))
    }

    const base = flowFromPreset(dto.crmFormId ? 'BLANK' : dto.preset)
    let { definition, crmAction } = base
    const category =
      dto.category !== 'OTHER' || dto.crmFormId ? dto.category : base.category

    if (dto.crmFormId) {
      // Reusing a CRM form needs the CRM, like reading the form would.
      const crm = await assertModuleMember(actorId, workspaceId, 'CRM')
      if (!crm.ok) return crm
      const form = await CrmFormRepository.findById(dto.crmFormId, workspaceId)
      if (!form.ok) return form
      const fields = Array.isArray(form.value.fields)
        ? (form.value.fields as unknown as Parameters<
            typeof flowFromCrmForm
          >[0])
        : []
      if (fields.length > 0) {
        const converted = flowFromCrmForm(fields, form.value.action)
        const checked = FlowDefinitionSchema.safeParse(converted.definition)
        if (!checked.success) {
          return err(
            whatsappFlowInvalid(
              `O formulário do CRM tem campos que o WhatsApp Flows não suporta: ${checked.error.issues[0]?.message ?? 'definição inválida'}`,
            ),
          )
        }
        definition = checked.data
        crmAction = converted.crmAction
      }
    }

    const created = await WhatsAppFlowRepository.create({
      workspaceId,
      connectionId: dto.connectionId,
      name: dto.name,
      description: dto.description ?? null,
      category,
      definition: toJson(definition),
      bodyText: base.bodyText,
      ctaLabel: base.ctaLabel,
      confirmationText: base.confirmationText,
      crmAction,
      sourceCrmFormId: dto.crmFormId ?? null,
      createdByUserId: actorId,
    })
    if (!created.ok) {
      auditMutation({
        entity: 'whatsapp_flow',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }
    auditMutation({
      entity: 'whatsapp_flow',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        preset: dto.preset,
        fromCrmForm: Boolean(dto.crmFormId),
      },
    })
    return ok(toWhatsAppFlowDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppFlowDTO,
  ): Promise<Result<WhatsAppFlowDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing
    if (existing.value.status === 'DEPRECATED') {
      return err(
        whatsappFlowInvalid('Um formulário descontinuado não pode ser editado'),
      )
    }

    const { definition, ...fields } = dto
    const issues = flowCrmIssues(
      definition ?? parseStoredDefinition(existing.value.definition),
      fields.crmAction ?? existing.value.crmAction,
    )
    if (issues.length > 0 && (definition || fields.crmAction)) {
      return err(whatsappFlowInvalid(issues[0]))
    }

    const updated = await WhatsAppFlowRepository.update(id, {
      ...fields,
      ...(definition ? { definition: toJson(definition) } : {}),
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_flow',
      action: 'update',
      actorId,
      targetId: id,
      meta: { workspaceId, definitionChanged: Boolean(definition) },
    })
    return ok(toWhatsAppFlowDTO(updated.value))
  },

  /** Apaga o formulário; com respostas coletadas, só descontinuando. */
  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const flow = await loadOwned(workspaceId, id)
    if (!flow.ok) return flow

    const responses = await WhatsAppFlowResponseRepository.countByFlow(id)
    if (!responses.ok) return responses
    if (responses.value > 0) {
      return err(
        validationError(
          'Este formulário já foi enviado. Descontinue-o para preservar as respostas.',
        ),
      )
    }

    // The Meta copy goes too, but never blocks the local delete.
    if (flow.value.metaFlowId && flow.value.metaStatus !== 'PUBLISHED') {
      const connection = await loadMetaConnection(
        workspaceId,
        flow.value.connectionId,
      )
      const auth = connection.ok ? await metaAuth(connection.value) : null
      if (auth?.ok) {
        try {
          await deleteMetaFlow(auth.value, flow.value.metaFlowId)
        } catch (error) {
          logger.warn('whatsapp.flow.meta_delete_failed', {
            flowId: id,
            reason: messageOf(error, 'unknown'),
          })
        }
      }
    }

    const deleted = await WhatsAppFlowRepository.delete(id)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'whatsapp_flow',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  /** The Flow JSON Meta would receive, for the editor's "ver JSON". */
  async metaJson(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppFlowMetaJsonDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      VIEW,
    )
    if (!access.ok) return access
    const flow = await loadOwned(workspaceId, id)
    if (!flow.ok) return flow
    const definition = parseStoredDefinition(flow.value.definition)
    return ok({ json: buildMetaFlowJson(definition) })
  },

  /**
   * Sends the definition to Meta. A flow still draft at Meta is updated in
   * place; one already published cannot be edited there, so a new Meta flow
   * takes over (answers to messages already sent still resolve locally).
   * `publish: false` only uploads, for test sends.
   */
  async publish(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: PublishWhatsAppFlowDTO,
  ): Promise<Result<WhatsAppFlowPublishDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const loaded = await loadOwned(workspaceId, id)
    if (!loaded.ok) return loaded
    const flow = loaded.value
    if (flow.status === 'DEPRECATED') {
      return err(
        whatsappFlowInvalid(
          'Um formulário descontinuado não pode ser publicado',
        ),
      )
    }

    const definition = parseStoredDefinition(flow.definition)
    if (definition.screens.length === 0) {
      return err(
        whatsappFlowInvalid('O formulário precisa de ao menos uma tela'),
      )
    }
    const issues = flowCrmIssues(definition, flow.crmAction)
    if (issues.length > 0) return err(whatsappFlowInvalid(issues[0]))

    const connection = await loadMetaConnection(workspaceId, flow.connectionId)
    if (!connection.ok) return connection
    const auth = await metaAuth(connection.value)
    if (!auth.ok) return auth

    const flowJson = buildMetaFlowJson(definition)
    let metaFlowId = flow.metaFlowId
    try {
      if (!metaFlowId || flow.metaStatus === 'PUBLISHED') {
        const created = await createMetaFlow(auth.value, {
          wabaId: auth.value.wabaId,
          name: `${flow.name} (${flow.id.slice(-6)})`.slice(0, 200),
          categories: [flow.category],
          flowJson,
        })
        metaFlowId = created.id
      } else {
        await uploadMetaFlowJson(auth.value, { flowId: metaFlowId, flowJson })
      }
      if (dto.publish) await publishMetaFlow(auth.value, metaFlowId)
    } catch (error) {
      const message = messageOf(error, 'A Meta recusou o formulário')
      await WhatsAppFlowRepository.update(id, {
        publishError: message.slice(0, 2000),
        ...(metaFlowId && metaFlowId !== flow.metaFlowId
          ? { metaFlowId, metaStatus: 'DRAFT' }
          : {}),
      })
      auditMutation({
        entity: 'whatsapp_flow',
        action: 'publish',
        actorId,
        targetId: id,
        outcome: 'failure',
        reason: 'META_REJECTED',
      })
      return err(whatsappFlowMetaRejected(message))
    }

    const updated = await WhatsAppFlowRepository.update(id, {
      metaFlowId,
      metaStatus: dto.publish ? 'PUBLISHED' : 'DRAFT',
      status: dto.publish ? 'PUBLISHED' : 'DRAFT',
      publishedDefinition: toJson(definition),
      publishedVersion: { increment: 1 },
      publishedAt: new Date(),
      publishError: null,
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_flow',
      action: 'publish',
      actorId,
      targetId: id,
      meta: { workspaceId, published: dto.publish, metaFlowId },
    })
    return ok({
      flow: toWhatsAppFlowDTO(updated.value),
      published: dto.publish,
    })
  },

  /** Retires the flow: no new sends, answers already collected stay. */
  async deprecate(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppFlowDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const loaded = await loadOwned(workspaceId, id)
    if (!loaded.ok) return loaded
    const flow = loaded.value
    if (flow.status === 'DEPRECATED') return ok(toWhatsAppFlowDTO(flow))

    if (flow.metaFlowId && flow.metaStatus === 'PUBLISHED') {
      const connection = await loadMetaConnection(
        workspaceId,
        flow.connectionId,
      )
      if (!connection.ok) return connection
      const auth = await metaAuth(connection.value)
      if (!auth.ok) return auth
      try {
        await deprecateMetaFlow(auth.value, flow.metaFlowId)
      } catch (error) {
        return err(
          whatsappFlowMetaRejected(
            messageOf(error, 'A Meta recusou a mudança'),
          ),
        )
      }
    }

    const updated = await WhatsAppFlowRepository.update(id, {
      status: 'DEPRECATED',
      metaStatus: flow.metaFlowId ? 'DEPRECATED' : flow.metaStatus,
    })
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_flow',
      action: 'archive',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return ok(toWhatsAppFlowDTO(updated.value))
  },

  /** Link of Meta's own preview of the uploaded flow. */
  async preview(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppFlowPreviewDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const loaded = await loadOwned(workspaceId, id)
    if (!loaded.ok) return loaded
    if (!loaded.value.metaFlowId) {
      return err(
        whatsappFlowNotSendable(
          'Envie o formulário para a Meta antes de pré-visualizar',
        ),
      )
    }
    const connection = await loadMetaConnection(
      workspaceId,
      loaded.value.connectionId,
    )
    if (!connection.ok) return connection
    const auth = await metaAuth(connection.value)
    if (!auth.ok) return auth
    try {
      const info = await getMetaFlow(auth.value, loaded.value.metaFlowId)
      return ok({ previewUrl: info.previewUrl, status: info.status })
    } catch (error) {
      return err(
        whatsappFlowMetaRejected(messageOf(error, 'A Meta não respondeu')),
      )
    }
  },

  /**
   * Submits a template (BODY + FLOW button) for the published flow, so it can
   * be sent outside the 24h window. Saved with the other templates; it sends
   * once Meta approves it.
   */
  async createTemplate(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: CreateWhatsAppFlowTemplateDTO,
  ): Promise<Result<WhatsAppTemplateDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const loaded = await loadOwned(workspaceId, id)
    if (!loaded.ok) return loaded
    const flow = loaded.value
    if (flow.status !== 'PUBLISHED' || !flow.metaFlowId) {
      return err(
        whatsappFlowNotSendable(
          'Publique o formulário antes de criar o template',
        ),
      )
    }
    const connection = await loadMetaConnection(workspaceId, flow.connectionId)
    if (!connection.ok) return connection
    const auth = await metaAuth(connection.value)
    if (!auth.ok) return auth

    const components = [
      { type: 'BODY', text: dto.body },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'FLOW',
            text: dto.buttonText,
            flow_id: flow.metaFlowId,
            flow_action: 'navigate',
            navigate_screen: firstScreenId(),
          },
        ],
      },
    ]
    let created: Awaited<ReturnType<typeof createMetaTemplate>>
    try {
      created = await createMetaTemplate({
        wabaId: auth.value.wabaId,
        accessToken: auth.value.accessToken,
        name: dto.name,
        language: dto.language,
        category: dto.category,
        components,
      })
    } catch (error) {
      return err(
        whatsappFlowMetaRejected(messageOf(error, 'A Meta recusou o template')),
      )
    }

    const saved = await WhatsAppTemplateRepository.upsertSynced({
      workspaceId,
      connectionId: flow.connectionId,
      name: dto.name,
      language: dto.language,
      category: dto.category,
      status: created.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
      components: toJson(components),
    })
    if (!saved.ok) return saved
    auditMutation({
      entity: 'whatsapp_flow',
      action: 'create',
      actorId,
      targetId: id,
      meta: { workspaceId, template: dto.name },
    })
    return ok(toWhatsAppTemplateDTO(saved.value))
  },

  /** Sends the flow into a conversation and records the pending answer. */
  async send(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: SendWhatsAppFlowDTO,
  ): Promise<Result<WhatsAppFlowSendDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      SEND,
    )
    if (!access.ok) return access
    const loaded = await loadOwned(workspaceId, id)
    if (!loaded.ok) return loaded
    const flow = loaded.value
    if (flow.status === 'DEPRECATED') {
      return err(whatsappFlowNotSendable('Este formulário foi descontinuado'))
    }
    if (!flow.metaFlowId) {
      return err(
        whatsappFlowNotSendable('Publique o formulário antes de enviar'),
      )
    }

    const flowToken = buildFlowToken(flow.id, createId())
    const sent = await WhatsAppMessageService.sendFlow(
      actorId,
      workspaceId,
      dto.conversationId,
      dto.templateName && dto.language
        ? {
            kind: 'TEMPLATE',
            connectionId: flow.connectionId,
            templateName: dto.templateName,
            language: dto.language,
            flowToken,
            label: flow.name,
          }
        : {
            kind: 'INTERACTIVE',
            connectionId: flow.connectionId,
            flowId: flow.metaFlowId,
            flowToken,
            bodyText: dto.bodyText ?? flow.bodyText,
            ctaLabel: dto.ctaLabel ?? flow.ctaLabel,
            screen: firstScreenId(),
            draft: flow.metaStatus !== 'PUBLISHED',
            label: flow.name,
          },
    )
    if (!sent.ok) return sent

    const response = await WhatsAppFlowResponseRepository.create({
      workspaceId,
      flowId: flow.id,
      contactId: sent.value.contactId,
      conversationId: dto.conversationId,
      flowToken,
      sentByUserId: actorId,
      messageId: sent.value.message.id,
    })
    if (!response.ok) {
      // The message already left: the answer still resolves by the flow id
      // inside the token, so this only costs the "sent" counter.
      logger.error('whatsapp.flow.response_record_failed', {
        flowId: flow.id,
        reason: response.error.code,
      })
      return response
    }
    auditMutation({
      entity: 'whatsapp_flow',
      action: 'send',
      actorId,
      targetId: flow.id,
      meta: {
        workspaceId,
        conversationId: dto.conversationId,
        viaTemplate: Boolean(dto.templateName),
      },
    })
    return ok({
      messageId: sent.value.message.id,
      responseId: response.value.id,
    })
  },

  async listResponses(
    actorId: string,
    workspaceId: string,
    id: string,
    options: ListWhatsAppFlowResponsesDTO,
  ): Promise<Result<WhatsAppFlowResponsesPageDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      VIEW,
    )
    if (!access.ok) return access
    const flow = await loadOwned(workspaceId, id)
    if (!flow.ok) return flow

    const rows = await WhatsAppFlowResponseRepository.listByFlow(
      workspaceId,
      id,
      options,
    )
    if (!rows.ok) return rows
    const hasMore = rows.value.length > options.limit
    const page = hasMore ? rows.value.slice(0, options.limit) : rows.value
    return ok({
      items: page.map(toWhatsAppFlowResponseDTO),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    })
  },
}

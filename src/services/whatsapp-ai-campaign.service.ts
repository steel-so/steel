import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppAiCampaign,
  WhatsAppConnection,
  WhatsAppTemplate,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  validationError,
  whatsappAiCampaignNotFound,
  whatsappAiCampaignNotReady,
  whatsappAiCampaignRunning,
  whatsappConnectionNotFound,
  whatsappTemplateNotFound,
} from '@/src/errors'
import type { PermissionAction } from '@/src/lib/permissions'
import { WhatsappBroadcastJob } from '@/src/lib/queue/jobs'
import { getWhatsappBroadcastQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  aiCampaignTemplateProblem,
  buildAiCampaignMessage,
  missingVariableSlots,
  resolveTemplateValues,
  templateFields,
} from '@/src/lib/whatsapp/ai-campaign'
import { isWhatsAppPhone } from '@/src/lib/whatsapp/phone'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import {
  parseAiCampaignActions,
  parseAiCampaignVariables,
  recipientValuesOf,
  toWhatsAppAiCampaignActionRunDTO,
  toWhatsAppAiCampaignDTO,
  toWhatsAppAiCampaignRecipientDTO,
} from '@/src/mappers/whatsapp-ai-campaign.mapper'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  emptyAiCampaignStats,
  type WhatsAppAiCampaignRecipientWithContact,
  WhatsAppAiCampaignRepository,
  type WhatsAppAiCampaignWithTemplate,
} from '@/src/repositories/whatsapp-ai-campaign.repository'
import { WhatsAppCloseStatusRepository } from '@/src/repositories/whatsapp-close-status.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import {
  AI_CAMPAIGN_MAX_QUEUE,
  type AiCampaignAction,
  type CreateWhatsAppAiCampaignDTO,
  type ListWhatsAppAiCampaignRecipientsDTO,
  type QueueWhatsAppAiCampaignDTO,
  type UpdateWhatsAppAiCampaignDTO,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import type {
  WhatsAppAiCampaignActionRunDTO,
  WhatsAppAiCampaignDTO,
  WhatsAppAiCampaignRecipientPageDTO,
} from '@/types/whatsapp-ai-campaign'
import { assertModuleMember } from './authz'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import { reopenWhatsAppConversation } from './whatsapp-conversation.service'
import { WhatsAppUsageService } from './whatsapp-usage.service'

/** Skipped contacts (opt-out, missing value) move on almost at once. */
const SKIP_DELAY_MS = 1000
/** Actions listed in the campaign panel. */
const ACTION_RUNS_LIMIT = 100

/** Errors that stop the run: retrying would fail again until someone acts. */
const PAUSING_ERRORS = new Set([
  'WHATSAPP_MESSAGE_LIMIT_REACHED',
  'WHATSAPP_CONVERSATION_LIMIT_REACHED',
])

/** Fields that only change with the campaign stopped. */
const LOCKED_WHILE_RUNNING = [
  'connectionId',
  'templateId',
  'variables',
  'headerMediaUrl',
] as const

export type WhatsAppAiCampaignStepOutcome =
  | { status: 'stopped' }
  | { status: 'done' }
  | { status: 'paused'; reason: string }
  | { status: 'waiting'; resumeAt: Date }
  | { status: 'sent' | 'failed' | 'skipped' | 'retry'; nextDelayMs: number }

/** Same resource as Transmissões (the product owner's call). */
async function authorize(
  actorId: string,
  workspaceId: string,
  action: PermissionAction,
) {
  return assertModuleMember(actorId, workspaceId, 'COMMUNICATION', {
    resource: 'broadcasts',
    action,
  })
}

/** What still blocks the play button (empty = ready). */
function campaignProblems(
  campaign: WhatsAppAiCampaignWithTemplate,
  pending: number,
): string[] {
  const problems: string[] = []
  if (!campaign.connection) problems.push('Escolha a conexão')
  if (!campaign.template) problems.push('Escolha o template')
  if (campaign.connection && campaign.template) {
    const problem = aiCampaignTemplateProblem(
      campaign.connection,
      campaign.template,
    )
    if (problem) problems.push(problem)
    const missing = missingVariableSlots(
      templateFields(campaign.template.components),
      parseAiCampaignVariables(campaign.variables),
    )
    if (missing.length > 0) {
      problems.push(
        `Preencha as variáveis: ${missing.map((slot) => slot.label).join(', ')}`,
      )
    }
  }
  if (pending === 0 && campaign.status !== 'RUNNING') {
    problems.push('Adicione contatos à campanha')
  }
  return problems
}

async function toDTOs(
  campaigns: WhatsAppAiCampaignWithTemplate[],
): Promise<Result<WhatsAppAiCampaignDTO[]>> {
  const stats = await WhatsAppAiCampaignRepository.statsFor(
    campaigns.map((campaign) => campaign.id),
  )
  if (!stats.ok) return stats
  return ok(
    campaigns.map((campaign) => {
      const entry = stats.value.get(campaign.id) ?? emptyAiCampaignStats()
      return toWhatsAppAiCampaignDTO(
        campaign,
        entry,
        campaignProblems(campaign, entry.pending),
      )
    }),
  )
}

async function toDTO(
  campaign: WhatsAppAiCampaignWithTemplate,
): Promise<Result<WhatsAppAiCampaignDTO>> {
  const dtos = await toDTOs([campaign])
  if (!dtos.ok) return dtos
  return ok(dtos.value[0])
}

async function loadCampaign(
  workspaceId: string,
  id: string,
): Promise<Result<WhatsAppAiCampaignWithTemplate>> {
  const found = await WhatsAppAiCampaignRepository.findById(id, workspaceId)
  if (!found.ok) return found
  if (!found.value || found.value.status === 'ARCHIVED') {
    return err(whatsappAiCampaignNotFound())
  }
  return ok(found.value)
}

/**
 * The destinations the admin picked must exist in the workspace: the AI
 * only ever transfers to, closes with or assigns what is configured here.
 */
async function validateActions(
  workspaceId: string,
  actions: AiCampaignAction[],
): Promise<Result<void>> {
  const userIds = actions.flatMap((a) =>
    a.kind === 'TRANSFER_USER' ? [a.userId] : [],
  )
  const teamIds = actions.flatMap((a) =>
    a.kind === 'TRANSFER_TEAM' ? [a.teamId] : [],
  )
  const statusIds = actions.flatMap((a) =>
    a.kind === 'CLOSE' ? a.statusIds : [],
  )

  if (userIds.length > 0) {
    const members =
      await MembershipRepository.listWithUserByWorkspace(workspaceId)
    if (!members.ok) return members
    const memberIds = new Set(members.value.map((m) => m.userId))
    if (userIds.some((id) => !memberIds.has(id))) {
      return err(
        validationError(
          'Escolha apenas membros deste workspace nas transferências',
        ),
      )
    }
  }
  for (const teamId of new Set(teamIds)) {
    const team = await WhatsAppTeamRepository.findById(teamId, workspaceId)
    if (!team.ok) return team
    if (!team.value) {
      return err(validationError('Uma das equipes escolhidas não existe mais'))
    }
  }
  if (statusIds.length > 0) {
    const statuses = await WhatsAppCloseStatusRepository.listActive(workspaceId)
    if (!statuses.ok) return statuses
    const active = new Set(statuses.value.map((s) => s.id))
    if (statusIds.some((id) => !active.has(id))) {
      return err(
        validationError(
          'Um dos status de fechamento escolhidos não existe mais',
        ),
      )
    }
  }
  return ok(undefined)
}

/** Connection and template of the campaign (same workspace, same pairing). */
async function validateTemplateChoice(
  workspaceId: string,
  connectionId: string | null,
  templateId: string | null,
): Promise<Result<void>> {
  if (connectionId) {
    const connection = await WhatsAppConnectionRepository.findById(
      connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())
  }
  if (templateId) {
    const template = await WhatsAppTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!template.ok) return template
    if (!template.value) return err(whatsappTemplateNotFound())
    if (connectionId && template.value.connectionId !== connectionId) {
      return err(validationError('O template precisa ser da conexão escolhida'))
    }
  }
  return ok(undefined)
}

async function enqueueNext(
  campaignId: string,
  runToken: string,
  delayMs: number,
): Promise<void> {
  await getWhatsappBroadcastQueue().add(
    WhatsappBroadcastJob.SendAiCampaignNext,
    { campaignId, runToken },
    // No automatic retry of a send that may have reached the contact; the
    // chain itself moves on (a DB failure throws and BullMQ retries).
    { delay: delayMs, jobId: `ai-campaign-${runToken}-${createId()}` },
  )
}

/**
 * The contact's conversation on the campaign connection, linked to the
 * campaign: an open one gets the template again (the product owner's call:
 * the auto-close takes care of stale ones), a closed one is reopened, else a
 * new one. The AI answers unless a person already has the conversation.
 */
async function conversationFor(
  campaign: WhatsAppAiCampaign,
  recipient: WhatsAppAiCampaignRecipientWithContact,
  connection: WhatsAppConnection,
): Promise<Result<{ id: string }>> {
  const workspaceId = campaign.workspaceId
  const scope = { connectionId: connection.id }
  const open = await WhatsAppConversationRepository.findActiveByContact(
    workspaceId,
    recipient.contactId,
    scope,
  )
  if (!open.ok) return open
  if (open.value) {
    const humanOwned = open.value.assignedUserId !== null
    const linked = await WhatsAppConversationRepository.update(open.value.id, {
      aiCampaignId: campaign.id,
      ...(campaign.aiReplies && !humanOwned
        ? { aiActive: true, aiHandoff: false }
        : {}),
    })
    if (!linked.ok) return linked
    return ok({ id: open.value.id })
  }

  const allowed = await WhatsAppUsageService.assertCanSend(
    workspaceId,
    'conversations',
  )
  if (!allowed.ok) return allowed

  const closed = await WhatsAppConversationRepository.findLatestClosedByContact(
    workspaceId,
    recipient.contactId,
    scope,
  )
  if (!closed.ok) return closed

  let conversationId: string
  if (closed.value) {
    const reopened = await reopenWhatsAppConversation(closed.value, {
      actorUserId: null,
      source: 'AI_CAMPAIGN',
      extra: {
        aiCampaignId: campaign.id,
        aiActive: campaign.aiReplies,
        aiHandoff: false,
      },
    })
    if (!reopened.ok) return reopened
    conversationId = reopened.value.id
  } else {
    const created = await WhatsAppConversationRepository.create({
      workspaceId,
      connectionId: connection.id,
      contactId: recipient.contactId,
      status: 'NEW',
      aiCampaignId: campaign.id,
      aiActive: campaign.aiReplies,
      aiHandoff: false,
    })
    if (!created.ok) return created
    conversationId = created.value.id
  }
  await WhatsAppUsageService.record(workspaceId, 'conversations')
  return ok({ id: conversationId })
}

/** Records the sent template in the conversation (as sent by the AI). */
async function recordOutboundTemplate(input: {
  workspaceId: string
  conversationId: string
  providerMessageId: string
  text: string
}): Promise<void> {
  const message = await WhatsAppMessageRepository.create({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    direction: 'OUT',
    type: 'TEMPLATE',
    text: input.text,
    providerMessageId: input.providerMessageId,
    status: 'SENT',
    sentByAi: true,
  })
  if (!message.ok) return
  await WhatsAppConversationRepository.update(input.conversationId, {
    lastMessageAt: new Date(),
  })
  await publishWhatsAppEvent(input.workspaceId, {
    type: 'message.created',
    conversationId: input.conversationId,
    message: toWhatsAppMessageDTO(message.value),
  })
  const fresh = await WhatsAppConversationRepository.findById(
    input.conversationId,
    input.workspaceId,
  )
  if (fresh.ok && fresh.value) {
    await publishWhatsAppEvent(input.workspaceId, {
      type: 'conversation.updated',
      conversation: toWhatsAppConversationDTO(fresh.value),
    })
  }
}

/** Connection + template of a campaign that may send now (worker). */
async function loadSendable(
  campaign: WhatsAppAiCampaign,
): Promise<
  Result<{ connection: WhatsAppConnection; template: WhatsAppTemplate }>
> {
  if (!campaign.connectionId || !campaign.templateId) {
    return err(whatsappAiCampaignNotReady())
  }
  const [connection, template] = await Promise.all([
    WhatsAppConnectionRepository.findById(
      campaign.connectionId,
      campaign.workspaceId,
    ),
    WhatsAppTemplateRepository.findById(
      campaign.templateId,
      campaign.workspaceId,
    ),
  ])
  if (!connection.ok) return connection
  if (!template.ok) return template
  if (!connection.value) return err(whatsappConnectionNotFound())
  if (!template.value) return err(whatsappTemplateNotFound())
  const problem = aiCampaignTemplateProblem(connection.value, template.value)
  if (problem) return err(whatsappAiCampaignNotReady(problem))
  return ok({ connection: connection.value, template: template.value })
}

export const WhatsAppAiCampaignService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAiCampaignDTO[]>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaigns =
      await WhatsAppAiCampaignRepository.listByWorkspace(workspaceId)
    if (!campaigns.ok) return campaigns
    return toDTOs(campaigns.value)
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppAiCampaignDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign
    return toDTO(campaign.value)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppAiCampaignDTO,
  ): Promise<Result<WhatsAppAiCampaignDTO>> {
    const membership = await authorize(actorId, workspaceId, 'CREATE')
    if (!membership.ok) return membership

    const created = await WhatsAppAiCampaignRepository.create({
      workspaceId,
      name: dto.name,
      objective: dto.objective || null,
      createdById: actorId,
      updatedById: actorId,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_ai_campaign',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId },
    })
    return toDTO(created.value)
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppAiCampaignDTO,
  ): Promise<Result<WhatsAppAiCampaignDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign
    if (
      campaign.value.status === 'RUNNING' &&
      LOCKED_WHILE_RUNNING.some((field) => dto[field] !== undefined)
    ) {
      return err(whatsappAiCampaignRunning())
    }

    const connectionId =
      dto.connectionId === undefined
        ? campaign.value.connectionId
        : dto.connectionId
    let templateId =
      dto.templateId === undefined ? campaign.value.templateId : dto.templateId
    // A new connection drops a template of the old one.
    if (
      dto.connectionId !== undefined &&
      dto.templateId === undefined &&
      campaign.value.template &&
      campaign.value.template.connectionId !== connectionId
    ) {
      templateId = null
    }
    if (dto.connectionId !== undefined || dto.templateId !== undefined) {
      const valid = await validateTemplateChoice(
        workspaceId,
        connectionId,
        templateId,
      )
      if (!valid.ok) return valid
    }
    if (dto.actions) {
      const valid = await validateActions(workspaceId, dto.actions)
      if (!valid.ok) return valid
    }

    const templateChanged = templateId !== campaign.value.templateId
    const saved = await WhatsAppAiCampaignRepository.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.objective !== undefined
        ? { objective: dto.objective || null }
        : {}),
      connectionId,
      templateId,
      // Another template has other variables: start the mapping over.
      ...(dto.variables !== undefined
        ? { variables: dto.variables }
        : templateChanged
          ? { variables: {} }
          : {}),
      ...(dto.headerMediaUrl !== undefined
        ? { headerMediaUrl: dto.headerMediaUrl }
        : {}),
      ...(dto.instructions !== undefined
        ? { instructions: dto.instructions }
        : {}),
      ...(dto.actions !== undefined ? { actions: dto.actions } : {}),
      ...(dto.intervalSeconds !== undefined
        ? { intervalSeconds: dto.intervalSeconds }
        : {}),
      ...(dto.aiReplies !== undefined ? { aiReplies: dto.aiReplies } : {}),
      updatedById: actorId,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_ai_campaign',
      action: 'update',
      actorId,
      targetId: id,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return toDTO(saved.value)
  },

  /** Archives the campaign (stops it); its conversations keep the link. */
  async archive(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<{ id: string }>> {
    const membership = await authorize(actorId, workspaceId, 'DELETE')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign

    const archived = await WhatsAppAiCampaignRepository.update(id, {
      status: 'ARCHIVED',
      runToken: null,
      updatedById: actorId,
    })
    if (!archived.ok) return archived

    auditMutation({
      entity: 'whatsapp_ai_campaign',
      action: 'archive',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return ok({ id })
  },

  /**
   * Adds contacts: selected, all of them, or spreadsheet rows (new phones
   * become contacts; extra columns feed the variables). Opted-out contacts
   * and invalid phones stay out; contacts already in the campaign too.
   */
  async queue(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: QueueWhatsAppAiCampaignDTO,
  ): Promise<
    Result<
      WhatsAppAiCampaignDTO & {
        added: number
        rejected: number
        optedOut: number
      }
    >
  > {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign

    let rows: { contactId: string; values?: Record<string, string> }[] = []
    let rejected = 0
    let optedOut = 0
    if (dto.rows) {
      const valid = dto.rows
        .map((row) => ({ ...row, waId: row.phone.replace(/\D/g, '') }))
        .filter((row) => row.waId.length >= 10 && row.waId.length <= 15)
      rejected = dto.rows.length - valid.length
      const contacts = await WhatsAppAiCampaignRepository.ensureContacts(
        workspaceId,
        valid.map((row) => ({ waId: row.waId, name: row.name })),
      )
      if (!contacts.ok) return contacts
      for (const row of valid) {
        const contact = contacts.value.get(row.waId)
        if (!contact) continue
        if (contact.optedOut) {
          optedOut += 1
          continue
        }
        rows.push({ contactId: contact.id, values: row.values })
      }
    } else {
      const contactIds =
        await WhatsAppAiCampaignRepository.listQueueableContactIds(
          workspaceId,
          dto.all ? null : (dto.contactIds ?? []),
          AI_CAMPAIGN_MAX_QUEUE,
        )
      if (!contactIds.ok) return contactIds
      rows = contactIds.value.map((contactId) => ({ contactId }))
      if (dto.contactIds) optedOut = dto.contactIds.length - rows.length
    }

    const added = await WhatsAppAiCampaignRepository.addRecipients(id, rows)
    if (!added.ok) return added

    let current = campaign.value
    // A finished campaign picks the new contacts up on the next play.
    if (current.status === 'DONE' && added.value > 0) {
      const reset = await WhatsAppAiCampaignRepository.update(id, {
        status: 'PAUSED',
      })
      if (!reset.ok) return reset
      current = reset.value
    }

    auditMutation({
      entity: 'whatsapp_ai_campaign',
      action: 'update',
      actorId,
      targetId: id,
      meta: {
        workspaceId,
        queued: added.value,
        source: dto.rows ? 'import' : dto.all ? 'all' : 'selection',
      },
    })
    const result = await toDTO(current)
    if (!result.ok) return result
    return ok({ ...result.value, added: added.value, rejected, optedOut })
  },

  async clear(
    actorId: string,
    workspaceId: string,
    id: string,
    all: boolean,
  ): Promise<Result<WhatsAppAiCampaignDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign
    if (campaign.value.status === 'RUNNING') {
      return err(
        whatsappAiCampaignRunning(
          'Pause a campanha antes de limpar os contatos',
        ),
      )
    }

    const cleared = await WhatsAppAiCampaignRepository.clearRecipients(id, all)
    if (!cleared.ok) return cleared

    auditMutation({
      entity: 'whatsapp_ai_campaign',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { workspaceId, cleared: cleared.value, all },
    })
    return toDTO(campaign.value)
  },

  async listRecipients(
    actorId: string,
    workspaceId: string,
    id: string,
    options: ListWhatsAppAiCampaignRecipientsDTO,
  ): Promise<Result<WhatsAppAiCampaignRecipientPageDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign

    const rows = await WhatsAppAiCampaignRepository.listRecipients(id, {
      ...options,
      limit: options.limit + 1,
    })
    if (!rows.ok) return rows
    const hasMore = rows.value.length > options.limit
    const items = rows.value.slice(0, options.limit)
    return ok({
      items: items.map(toWhatsAppAiCampaignRecipientDTO),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    })
  },

  async listActionRuns(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppAiCampaignActionRunDTO[]>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign

    const runs = await WhatsAppAiCampaignRepository.listActionRuns(
      id,
      ACTION_RUNS_LIMIT,
    )
    if (!runs.ok) return runs
    return ok(runs.value.map(toWhatsAppAiCampaignActionRunDTO))
  },

  /** Play: starts a new job chain (the previous one, if any, dies). */
  async play(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppAiCampaignDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign
    if (campaign.value.status === 'RUNNING') return toDTO(campaign.value)

    const pending = await WhatsAppAiCampaignRepository.countPending(id)
    if (!pending.ok) return pending
    const problems = campaignProblems(campaign.value, pending.value)
    if (problems.length > 0) {
      return err(whatsappAiCampaignNotReady(problems.join('. ')))
    }

    const runToken = createId()
    const started = await WhatsAppAiCampaignRepository.update(id, {
      status: 'RUNNING',
      runToken,
      lastError: null,
      finishedAt: null,
      startedAt: campaign.value.startedAt ?? new Date(),
      updatedById: actorId,
    })
    if (!started.ok) return started
    await enqueueNext(id, runToken, 0)

    auditMutation({
      entity: 'whatsapp_ai_campaign',
      action: 'start',
      actorId,
      targetId: id,
      meta: { workspaceId, pending: pending.value },
    })
    return toDTO(started.value)
  },

  async pause(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppAiCampaignDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await loadCampaign(workspaceId, id)
    if (!campaign.ok) return campaign
    if (campaign.value.status !== 'RUNNING') return toDTO(campaign.value)

    const paused = await WhatsAppAiCampaignRepository.update(id, {
      status: 'PAUSED',
      runToken: null,
      updatedById: actorId,
    })
    if (!paused.ok) return paused

    auditMutation({
      entity: 'whatsapp_ai_campaign',
      action: 'pause',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return toDTO(paused.value)
  },

  /**
   * One step of the run (worker): sends the template to the next queued
   * contact and chains the next step after the campaign interval. A stale
   * `runToken` (paused, or played again) stops silently.
   */
  async sendNext(
    campaignId: string,
    runToken: string,
  ): Promise<Result<WhatsAppAiCampaignStepOutcome>> {
    const found = await WhatsAppAiCampaignRepository.findByIdRaw(campaignId)
    if (!found.ok) return found
    const campaign = found.value
    if (campaign?.status !== 'RUNNING' || campaign.runToken !== runToken) {
      return ok({ status: 'stopped' })
    }

    const stop = async (
      status: 'PAUSED' | 'DONE',
      reason: string | null,
    ): Promise<Result<WhatsAppAiCampaignStepOutcome>> => {
      const stopped = await WhatsAppAiCampaignRepository.stopRun(
        campaign.id,
        runToken,
        {
          status,
          lastError: reason,
          ...(status === 'DONE' ? { finishedAt: new Date() } : {}),
        },
      )
      if (!stopped.ok) return stopped
      if (status === 'DONE') return ok({ status: 'done' })
      return ok({ status: 'paused', reason: reason ?? '' })
    }

    // Business hours lock campaign sends too: sleep until the opening.
    const hours = await WhatsAppBusinessHoursService.check(campaign.workspaceId)
    if (!hours.ok) return hours
    if (!hours.value.open) {
      const resumeAt = hours.value.nextOpeningAt
      if (!resumeAt) {
        return stop('PAUSED', 'O horário de atendimento não tem dias liberados')
      }
      await enqueueNext(
        campaign.id,
        runToken,
        Math.max(0, resumeAt.getTime() - Date.now()),
      )
      return ok({ status: 'waiting', resumeAt })
    }

    const sendable = await loadSendable(campaign)
    if (!sendable.ok) {
      if (sendable.error.code === 'DATABASE_ERROR') return sendable
      return stop('PAUSED', sendable.error.message)
    }
    const { connection } = sendable.value
    const template = {
      ...sendable.value.template,
      headerMediaUrl:
        campaign.headerMediaUrl ?? sendable.value.template.headerMediaUrl,
    }
    const fields = templateFields(template.components)
    const variables = parseAiCampaignVariables(campaign.variables)
    const missing = missingVariableSlots(fields, variables)
    if (missing.length > 0) {
      return stop(
        'PAUSED',
        `Preencha as variáveis: ${missing.map((slot) => slot.label).join(', ')}`,
      )
    }

    const next = await WhatsAppAiCampaignRepository.findNextPending(campaign.id)
    if (!next.ok) return next
    const recipient = next.value
    if (!recipient) return stop('DONE', null)

    const interval = campaign.intervalSeconds * 1000
    const skip = async (
      reason: string,
    ): Promise<Result<WhatsAppAiCampaignStepOutcome>> => {
      const skipped = await WhatsAppAiCampaignRepository.updateRecipient(
        recipient.id,
        { status: 'SKIPPED', errorMessage: reason },
      )
      if (!skipped.ok) return skipped
      await enqueueNext(campaign.id, runToken, SKIP_DELAY_MS)
      return ok({ status: 'skipped', nextDelayMs: SKIP_DELAY_MS })
    }

    if (recipient.contact.broadcastOptedOutAt) {
      return skip('Contato descadastrado das mensagens automáticas')
    }
    if (!isWhatsAppPhone(recipient.contact.waId)) {
      return skip('Contato sem telefone')
    }
    const resolved = resolveTemplateValues(fields, variables, {
      contactName: recipient.contact.name,
      waId: recipient.contact.waId,
      description: recipient.contact.description,
      values: recipientValuesOf(recipient.values),
    })
    if (!resolved.ok) {
      return skip(`Sem valor para ${resolved.missing.label}`)
    }

    const conversation = await conversationFor(campaign, recipient, connection)
    if (!conversation.ok) {
      if (PAUSING_ERRORS.has(conversation.error.code)) {
        return stop('PAUSED', conversation.error.message)
      }
      return conversation
    }

    const message = buildAiCampaignMessage(fields, resolved.values)
    const sent = await WhatsAppSend.template(connection, {
      to: recipient.contact.waId,
      templateName: template.name,
      language: template.language,
      components: applyTemplateSendExtras(template, message.components)
        .components,
    })

    if (!sent.ok) {
      if (PAUSING_ERRORS.has(sent.error.code)) {
        return stop('PAUSED', sent.error.message)
      }
      // Provider throttle: the same contact goes again after the interval.
      if (sent.error.code === 'RATE_LIMITED') {
        await enqueueNext(campaign.id, runToken, interval)
        return ok({ status: 'retry', nextDelayMs: interval })
      }
      const failed = await WhatsAppAiCampaignRepository.updateRecipient(
        recipient.id,
        {
          status: 'FAILED',
          errorMessage: sent.error.message,
          conversationId: conversation.value.id,
        },
      )
      if (!failed.ok) return failed
      logger.warn('whatsapp.ai_campaign.send_failed', {
        component: 'WhatsAppAiCampaignService',
        campaignId: campaign.id,
        recipientId: recipient.id,
        reason: sent.error.code,
      })
      await enqueueNext(campaign.id, runToken, interval)
      return ok({ status: 'failed', nextDelayMs: interval })
    }

    // Already sent: bookkeeping failures are logged, never retried (a retry
    // would message the contact twice).
    const marked = await WhatsAppAiCampaignRepository.updateRecipient(
      recipient.id,
      {
        status: 'SENT',
        providerMessageId: sent.value.providerMessageId,
        conversationId: conversation.value.id,
        sentAt: new Date(),
        errorMessage: null,
      },
    )
    if (!marked.ok) {
      logger.error('whatsapp.ai_campaign.recipient_update_failed', {
        component: 'WhatsAppAiCampaignService',
        recipientId: recipient.id,
        reason: marked.error.code,
      })
    }
    await WhatsAppAiCampaignRepository.update(campaign.id, {
      lastSentAt: new Date(),
    })
    await recordOutboundTemplate({
      workspaceId: campaign.workspaceId,
      conversationId: conversation.value.id,
      providerMessageId: sent.value.providerMessageId,
      text: message.text || template.name,
    })

    await enqueueNext(campaign.id, runToken, interval)
    return ok({ status: 'sent', nextDelayMs: interval })
  },

  /** Campaign of a conversation, for the AI reply (system). */
  async findForReply(campaignId: string): Promise<
    Result<{
      campaign: WhatsAppAiCampaign
      actions: AiCampaignAction[]
    } | null>
  > {
    const found = await WhatsAppAiCampaignRepository.findByIdRaw(campaignId)
    if (!found.ok) return found
    if (!found.value || found.value.status === 'ARCHIVED') return ok(null)
    if (!found.value.aiReplies) return ok(null)
    return ok({
      campaign: found.value,
      actions: parseAiCampaignActions(found.value.actions),
    })
  },
}

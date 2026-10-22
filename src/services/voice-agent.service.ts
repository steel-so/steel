import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import type { VoiceAgentSettings, WhatsAppPhoneCall } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { OPENAI_API_KEY, VOICE_AGENT_AUDIOSOCKET_PORT } from '@/lib/env/server'
import {
  validationError,
  voiceAgentNotReady,
  voiceAgentRouteDuplicate,
  voiceAgentRouteNotFound,
  voiceAgentSecretInvalid,
} from '@/src/errors'
import { currentPeriodStart } from '@/src/lib/ai/quota'
import { PhoneCallAiJob } from '@/src/lib/queue/jobs'
import { getPhoneCallAiQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import type { VoiceCallResult } from '@/src/lib/voice-agent/bridge'
import {
  priceVoiceUsage,
  voiceTokenTotals,
} from '@/src/lib/voice-agent/pricing'
import { DEFAULT_VOICE_NOTICE } from '@/src/lib/voice-agent/prompt'
import type { VoiceCallState } from '@/src/lib/voice-agent/tools'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import {
  toVoiceAgentRouteDTO,
  toVoiceAgentSettingsDTO,
} from '@/src/mappers/voice-agent.mapper'
import { toWhatsAppPhoneCallDTO } from '@/src/mappers/whatsapp-phone-call.mapper'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { VoiceAgentRepository } from '@/src/repositories/voice-agent.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type {
  CreateVoiceAgentRouteDTO,
  PabxVoiceOutcomeDTO,
  PabxVoiceSessionDTO,
  UpdateVoiceAgentRouteDTO,
  UpdateVoiceAgentSettingsDTO,
} from '@/src/schemas/voice-agent.schema'
import type {
  VoiceAgentRouteDTO,
  VoiceAgentSecretDTO,
  VoiceAgentSettingsDTO,
  VoiceAgentUsageDTO,
} from '@/types/voice-agent'
import { AiUsageService } from './ai-usage.service'
import { assertModulePrivileged } from './authz'
import { PlatformAiSettingsService } from './platform-ai-settings.service'

/** Calls shorter than this are not worth opening a model session for. */
export const MIN_REMAINING_SECONDS = 30
/** Longest transcript kept on a call (characters). */
export const TRANSCRIPT_MAX_CHARS = 100_000

/** Why the dialplan should fall through to the human path. */
export type VoiceSessionDecline =
  | 'disabled'
  | 'no_route'
  | 'not_ready'
  | 'no_minutes'
  | 'no_quota'
  | 'invalid_caller'
  | 'no_connection'

export type VoiceSessionStart =
  | { started: true; sessionId: string; callId: string }
  | { started: false; reason: VoiceSessionDecline }

/** Everything the worker needs to run one claimed call. */
export interface VoiceSessionContext {
  call: WhatsAppPhoneCall
  settings: VoiceAgentSettings
  workspaceName: string
  notice: string
  /** Hand-off destination planned when the session was opened. */
  transferTarget: string | null
  /** Hard cap in seconds: the smaller of the call limit and the month balance. */
  maxCallSeconds: number
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** WhatsApp id of a PABX caller id: digits with the country code, or null. */
export function callerToWaId(caller: string): string | null {
  let digits = caller.replace(/\D/g, '')
  if (
    digits.startsWith('0') &&
    (digits.length === 11 || digits.length === 12)
  ) {
    digits = digits.slice(1)
  }
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  return digits.length >= 12 && digits.length <= 15 ? digits : null
}

function serverReady(): boolean {
  return Boolean(OPENAI_API_KEY) && Boolean(VOICE_AGENT_AUDIOSOCKET_PORT)
}

async function publishCall(call: WhatsAppPhoneCall): Promise<void> {
  await publishWhatsAppEvent(call.workspaceId, {
    type: 'phone-call.updated',
    call: toWhatsAppPhoneCallDTO(call),
  })
}

/** The settings row of a PABX request, after the secret check. */
async function authenticatePabx(
  workspaceId: string,
  secret: string,
): Promise<Result<VoiceAgentSettings | null>> {
  const found = await VoiceAgentRepository.findSettings(workspaceId)
  if (!found.ok) return found
  const row = found.value
  if (!row?.pabxSecretHash || !safeEqual(sha256(secret), row.pabxSecretHash)) {
    return err(voiceAgentSecretInvalid())
  }
  return ok(row)
}

/** Existing open conversation of the caller, or a new one on a connection. */
async function conversationForCaller(
  workspaceId: string,
  waId: string,
): Promise<Result<string | null>> {
  const contact = await WhatsAppContactRepository.upsertByWaId({
    workspaceId,
    waId,
  })
  if (!contact.ok) return contact
  const active = await WhatsAppConversationRepository.findActiveByContact(
    workspaceId,
    contact.value.id,
  )
  if (!active.ok) return active
  if (active.value) return ok(active.value.id)

  const connections =
    await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
  if (!connections.ok) return connections
  const connection = connections.value[0]
  if (!connection) return ok(null)
  const created = await WhatsAppConversationRepository.create({
    workspaceId,
    connectionId: connection.id,
    contactId: contact.value.id,
  })
  if (!created.ok) return created
  return ok(created.value.id)
}

function handoffText(
  result: VoiceCallResult,
  state: VoiceCallState,
): string | null {
  if (!result.transfer) return null
  const parts = [`Transferida: ${result.transfer.reason}.`]
  if (state.handoffSummary) parts.push(`Resumo: ${state.handoffSummary}`)
  if (state.ticket) parts.push(`Chamado: ${state.ticket.code}.`)
  return parts.join(' ').slice(0, 2000)
}

export const VoiceAgentService = {
  /* ------------------------------ admin side ----------------------------- */

  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<VoiceAgentSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const row = await VoiceAgentRepository.findSettings(workspaceId)
    if (!row.ok) return row
    return ok(toVoiceAgentSettingsDTO(workspaceId, row.value, serverReady()))
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateVoiceAgentSettingsDTO,
  ): Promise<Result<VoiceAgentSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await VoiceAgentRepository.findSettings(workspaceId)
    if (!existing.ok) return existing
    const runAsUserId =
      dto.runAsUserId !== undefined
        ? dto.runAsUserId
        : (existing.value?.runAsUserId ?? null)
    const enabled = dto.enabled ?? existing.value?.enabled ?? false

    if (runAsUserId && dto.runAsUserId !== undefined) {
      const members =
        await MembershipRepository.listWithUserByWorkspace(workspaceId)
      if (!members.ok) return members
      if (!members.value.some((member) => member.userId === runAsUserId)) {
        return err(
          validationError('Escolha um membro deste workspace para o atendente'),
        )
      }
    }
    if (enabled && !runAsUserId) {
      return err(
        voiceAgentNotReady(
          'Escolha em nome de quem o atendente age antes de ligá-lo',
        ),
      )
    }

    const saved = await VoiceAgentRepository.upsertSettings(workspaceId, dto)
    if (!saved.ok) return saved

    auditMutation({
      entity: 'voice_agent_settings',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: {
        workspaceId,
        enabled: saved.value.enabled,
        fields: Object.keys(dto),
      },
    })
    return ok(toVoiceAgentSettingsDTO(workspaceId, saved.value, serverReady()))
  },

  /** New dialplan secret, shown once; the previous one stops working. */
  async rotateSecret(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<VoiceAgentSecretDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const secret = `vk_${randomBytes(24).toString('base64url')}`
    const hint = secret.slice(-4)
    const saved = await VoiceAgentRepository.upsertSettings(workspaceId, {
      pabxSecretHash: sha256(secret),
      pabxSecretHint: hint,
    })
    if (!saved.ok) return saved
    auditMutation({
      entity: 'voice_agent_settings',
      action: 'rotate',
      actorId,
      targetId: workspaceId,
      meta: { workspaceId },
    })
    return ok({ secret, hint })
  },

  async listRoutes(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<VoiceAgentRouteDTO[]>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const rows = await VoiceAgentRepository.listRoutes(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toVoiceAgentRouteDTO))
  },

  async createRoute(
    actorId: string,
    workspaceId: string,
    dto: CreateVoiceAgentRouteDTO,
  ): Promise<Result<VoiceAgentRouteDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const routes = await VoiceAgentRepository.listRoutes(workspaceId)
    if (!routes.ok) return routes
    if (
      routes.value.some(
        (route) => route.kind === dto.kind && route.value === dto.value,
      )
    ) {
      return err(voiceAgentRouteDuplicate())
    }
    const created = await VoiceAgentRepository.createRoute({
      workspaceId,
      kind: dto.kind,
      value: dto.value,
      label: dto.label ?? null,
      enabled: dto.enabled ?? true,
      transferTarget: dto.transferTarget ?? null,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'voice_agent_route',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, kind: dto.kind, value: dto.value },
    })
    return ok(toVoiceAgentRouteDTO(created.value))
  },

  async updateRoute(
    actorId: string,
    workspaceId: string,
    routeId: string,
    dto: UpdateVoiceAgentRouteDTO,
  ): Promise<Result<VoiceAgentRouteDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const found = await VoiceAgentRepository.findRoute(routeId, workspaceId)
    if (!found.ok) return found
    if (!found.value) return err(voiceAgentRouteNotFound())

    const updated = await VoiceAgentRepository.updateRoute(routeId, dto)
    if (!updated.ok) return updated
    auditMutation({
      entity: 'voice_agent_route',
      action: 'update',
      actorId,
      targetId: routeId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toVoiceAgentRouteDTO(updated.value))
  },

  async deleteRoute(
    actorId: string,
    workspaceId: string,
    routeId: string,
  ): Promise<Result<void>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const found = await VoiceAgentRepository.findRoute(routeId, workspaceId)
    if (!found.ok) return found
    if (!found.value) return err(voiceAgentRouteNotFound())

    const deleted = await VoiceAgentRepository.deleteRoute(routeId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'voice_agent_route',
      action: 'delete',
      actorId,
      targetId: routeId,
      meta: { workspaceId, kind: found.value.kind, value: found.value.value },
    })
    return ok(undefined)
  },

  async usage(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<VoiceAgentUsageDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const settings = await VoiceAgentRepository.findSettings(workspaceId)
    if (!settings.ok) return settings
    const since = currentPeriodStart()
    const totals = await VoiceAgentRepository.usageSince(workspaceId, since)
    if (!totals.ok) return totals
    return ok({
      minutesUsed: Math.ceil(totals.value.seconds / 60),
      minutesCap: settings.value?.monthlyMinutesCap ?? 300,
      calls: totals.value.calls,
      periodStart: since.toISOString(),
    })
  },

  /* ------------------------------ PABX side ------------------------------ */

  /**
   * First dialplan question: may the AI take this call? Mints the call and
   * its one-shot session id when it may. A refusal is not an error: the
   * dialplan simply follows its human path.
   */
  async startSession(
    dto: PabxVoiceSessionDTO,
  ): Promise<Result<VoiceSessionStart>> {
    const auth = await authenticatePabx(dto.workspace, dto.secret)
    if (!auth.ok) return auth
    const settings = auth.value as VoiceAgentSettings
    const decline = (
      reason: VoiceSessionDecline,
    ): Result<VoiceSessionStart> => {
      logger.info('voice_agent.session_declined', {
        component: 'VoiceAgentService',
        workspaceId: dto.workspace,
        reason,
      })
      return ok({ started: false, reason })
    }

    if (!settings.enabled) return decline('disabled')
    if (!settings.runAsUserId || !serverReady()) return decline('not_ready')

    const modules = await WorkspaceModuleAccessRepository.listByWorkspace(
      dto.workspace,
    )
    if (!modules.ok) return modules
    if (!modules.value.some((m) => m.module === 'COMMUNICATION' && m.enabled)) {
      return decline('not_ready')
    }

    const route = await VoiceAgentRepository.findEnabledRoute(dto.workspace, {
      queue: dto.queue || undefined,
      did: dto.did || undefined,
    })
    if (!route.ok) return route
    if (!route.value) return decline('no_route')

    const waId = callerToWaId(dto.caller)
    if (!waId) return decline('invalid_caller')

    const used = await VoiceAgentRepository.usageSince(
      dto.workspace,
      currentPeriodStart(),
    )
    if (!used.ok) return used
    if (
      settings.monthlyMinutesCap * 60 - used.value.seconds <
      MIN_REMAINING_SECONDS
    ) {
      return decline('no_minutes')
    }

    const quota = await AiUsageService.prepare(dto.workspace, 'VOICE_AGENT')
    if (!quota.ok) {
      return quota.error.code === 'AI_QUOTA_EXCEEDED'
        ? decline('no_quota')
        : decline('not_ready')
    }

    const conversationId = await conversationForCaller(dto.workspace, waId)
    if (!conversationId.ok) return conversationId
    if (!conversationId.value) return decline('no_connection')

    const sessionId = randomUUID()
    const notice = settings.noticeText?.trim() || DEFAULT_VOICE_NOTICE
    const created = await WhatsAppPhoneCallRepository.create({
      workspaceId: dto.workspace,
      conversationId: conversationId.value,
      userId: null,
      deviceId: 'voice-agent',
      extension: route.value.value.slice(0, 20),
      destination: waId,
      callbackTokenHash: sha256(sessionId),
      status: 'QUEUED',
      voiceAgent: true,
      recordingNotice: notice.slice(0, 500),
      voiceTransferTarget:
        route.value.transferTarget ?? settings.fallbackTarget ?? null,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_phone_call',
      action: 'voice_start',
      actorId: null,
      targetId: created.value.id,
      meta: {
        workspaceId: dto.workspace,
        conversationId: conversationId.value,
        route: `${route.value.kind}:${route.value.value}`,
      },
    })
    return ok({ started: true, sessionId, callId: created.value.id })
  },

  /**
   * Second dialplan question, after `AudioSocket()`: where does the call go
   * now? `transferTarget` is the person to hand it to, or `null` to hang up.
   * A call that did not get to store its end (worker crash) still carries
   * the target planned when it started, so the caller reaches a person.
   */
  async outcome(
    dto: PabxVoiceOutcomeDTO,
  ): Promise<Result<{ callId: string; transferTarget: string | null }>> {
    const auth = await authenticatePabx(dto.workspace, dto.secret)
    if (!auth.ok) return auth

    const found = await WhatsAppPhoneCallRepository.findByCallbackTokenHash(
      sha256(dto.session),
    )
    if (!found.ok) return found
    const call = found.value
    if (!call || call.workspaceId !== dto.workspace || !call.voiceAgent) {
      return err(voiceAgentSecretInvalid())
    }
    return ok({ callId: call.id, transferTarget: call.voiceTransferTarget })
  },

  /* ----------------------------- worker side ------------------------------ */

  /**
   * Claims the call of an AudioSocket connection (one-shot). `null` when the
   * id is unknown, already used, expired, or the workspace turned the
   * attendant off in between.
   */
  async claim(
    sessionId: string,
    now = new Date(),
  ): Promise<Result<VoiceSessionContext | null>> {
    const claimed = await VoiceAgentRepository.claimSession(
      sha256(sessionId),
      now,
    )
    if (!claimed.ok) return claimed
    const call = claimed.value
    if (!call) return ok(null)

    const settings = await VoiceAgentRepository.findSettings(call.workspaceId)
    if (!settings.ok) return settings
    if (!settings.value?.enabled || !settings.value.runAsUserId) {
      await VoiceAgentService.fail(call, 'disabled', now)
      return ok(null)
    }
    const workspace = await WorkspaceRepository.findById(call.workspaceId)
    if (!workspace.ok) return workspace
    const used = await VoiceAgentRepository.usageSince(
      call.workspaceId,
      currentPeriodStart(now),
    )
    if (!used.ok) return used

    const remaining = settings.value.monthlyMinutesCap * 60 - used.value.seconds
    return ok({
      call,
      settings: settings.value,
      workspaceName: workspace.value.name,
      notice: call.recordingNotice ?? DEFAULT_VOICE_NOTICE,
      transferTarget: call.voiceTransferTarget ?? settings.value.fallbackTarget,
      maxCallSeconds: Math.max(
        0,
        Math.min(settings.value.maxCallSeconds, remaining),
      ),
    })
  },

  /** Stores the end of a call, its cost, and queues the summary. */
  async complete(
    context: VoiceSessionContext,
    result: VoiceCallResult,
    state: VoiceCallState,
    model: string,
    now = new Date(),
  ): Promise<Result<WhatsAppPhoneCall>> {
    const { call } = context
    const transcript = result.transcript.slice(0, TRANSCRIPT_MAX_CHARS)
    const hasTranscript = transcript.length > 0
    const durationSeconds = Math.max(0, Math.round(result.durationMs / 1000))
    const failedEarly = result.endReason === 'provider_error' && !hasTranscript

    const updated = await WhatsAppPhoneCallRepository.update(call.id, {
      status: failedEarly ? 'FAILED' : 'COMPLETED',
      endedAt: now,
      durationSeconds,
      transcript: hasTranscript ? transcript : null,
      voiceEndReason: result.endReason,
      voiceTransferTarget: result.transfer?.target ?? null,
      voiceHandoff: handoffText(result, state),
      sdTicketId: state.ticket?.id ?? null,
      aiStatus: hasTranscript ? 'PENDING' : 'SKIPPED',
      aiSkipReason: hasTranscript ? null : 'no_transcript',
    })
    if (!updated.ok) return updated

    const margin = await PlatformAiSettingsService.getCostMargin()
    const totals = voiceTokenTotals(result.usage)
    if (totals.inputTokens + totals.outputTokens > 0) {
      const recorded = await AiUsageRepository.record({
        workspaceId: call.workspaceId,
        userId: null,
        feature: 'VOICE_AGENT',
        provider: 'openai',
        model,
        ...totals,
        costUsd: priceVoiceUsage(result.usage, margin),
        module: 'COMMUNICATION',
        conversationId: call.conversationId,
      })
      if (!recorded.ok) {
        logger.error('voice_agent.usage_record_failed', {
          component: 'VoiceAgentService',
          workspaceId: call.workspaceId,
          callId: call.id,
          message: recorded.error.message,
        })
      }
    }

    auditMutation({
      entity: 'whatsapp_phone_call',
      action: 'voice_end',
      actorId: null,
      targetId: call.id,
      meta: {
        workspaceId: call.workspaceId,
        endReason: result.endReason,
        durationSeconds,
        ticketId: state.ticket?.id,
      },
    })
    if (result.transfer) {
      auditMutation({
        entity: 'whatsapp_phone_call',
        action: 'voice_transfer',
        actorId: null,
        targetId: call.id,
        meta: {
          workspaceId: call.workspaceId,
          target: result.transfer.target,
          reason: result.transfer.reason,
        },
      })
    }

    if (hasTranscript) {
      try {
        await getPhoneCallAiQueue().add(
          PhoneCallAiJob.ProcessRecording,
          { callId: call.id },
          { jobId: `phone-call-${call.id}` },
        )
      } catch (cause) {
        logger.error('voice_agent.ai_enqueue_failed', {
          component: 'VoiceAgentService',
          workspaceId: call.workspaceId,
          callId: call.id,
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    await publishCall(updated.value)
    return ok(updated.value)
  },

  /** The call could not run (crash, disabled in between): closes it as failed. */
  async fail(
    call: WhatsAppPhoneCall,
    reason: string,
    now = new Date(),
  ): Promise<void> {
    const updated = await WhatsAppPhoneCallRepository.update(call.id, {
      status: 'FAILED',
      endedAt: now,
      voiceEndReason: reason,
    })
    if (updated.ok) await publishCall(updated.value)
  },
}

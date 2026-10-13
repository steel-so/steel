import { createHash, randomBytes } from 'node:crypto'
import type { WhatsAppPhoneCall, WhatsAppPhoneCallStatus } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL, PABX_CALLBACK_URL } from '@/lib/env/server'
import {
  pabxCallbackInvalid,
  pabxExtensionRequired,
  whatsappConversationNotFound,
} from '@/src/errors'
import { placePabxCall } from '@/src/lib/pabx/click-to-call'
import { err, ok, type Result } from '@/src/lib/result'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppPhoneCallDTO } from '@/src/mappers/whatsapp-phone-call.mapper'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import type { PabxCallWebhookDTO } from '@/src/schemas/whatsapp-phone-call.schema'
import type { WhatsAppPhoneCallDTO } from '@/types/whatsapp-phone-call'
import { assertModuleMember } from './authz'

const FINAL_STATUSES: ReadonlySet<WhatsAppPhoneCallStatus> = new Set([
  'COMPLETED',
  'BUSY',
  'NO_ANSWER',
  'CANCELED',
  'EXTENSION_NO_ANSWER',
  'FAILED',
])

/** Asterisk DIALSTATUS of the final report → call status. */
const HANGUP_STATUS: Record<string, WhatsAppPhoneCallStatus> = {
  ANSWER: 'COMPLETED',
  BUSY: 'BUSY',
  NOANSWER: 'NO_ANSWER',
  CANCEL: 'CANCELED',
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function callbackUrl(): string {
  return PABX_CALLBACK_URL ?? `${BETTER_AUTH_URL}/api/pabx/calls/webhook`
}

async function publishCall(call: WhatsAppPhoneCall): Promise<void> {
  await publishWhatsAppEvent(call.workspaceId, {
    type: 'phone-call.updated',
    call: toWhatsAppPhoneCallDTO(call),
  })
}

/** Next state for a dialplan report, or `null` when it changes nothing. */
function transition(
  call: WhatsAppPhoneCall,
  report: PabxCallWebhookDTO,
  now: Date,
): Partial<WhatsAppPhoneCall> | null {
  if (FINAL_STATUSES.has(call.status)) return null

  switch (report.event) {
    case 'EXTENSION_ANSWERED':
      return call.status === 'QUEUED' ? { status: 'DIALING' } : null
    case 'ANSWERED':
      return call.status === 'IN_PROGRESS'
        ? null
        : { status: 'IN_PROGRESS', answeredAt: now }
    case 'EXTENSION_FAILED':
      return { status: 'EXTENSION_NO_ANSWER', endedAt: now }
    case 'HANGUP': {
      const status = HANGUP_STATUS[report.dialstatus ?? ''] ?? 'FAILED'
      const duration =
        status === 'COMPLETED' ? (report.answeredtime ?? 0) : null
      return {
        status,
        dialStatus: report.dialstatus ?? null,
        endedAt: now,
        durationSeconds: duration,
        answeredAt:
          status === 'COMPLETED'
            ? (call.answeredAt ??
              new Date(now.getTime() - (duration ?? 0) * 1000))
            : call.answeredAt,
      }
    }
  }
}

export const WhatsAppPhoneCallService = {
  /**
   * Click-to-call: the user's PABX rings their extension and bridges it to
   * the conversation contact. The extension/device come from the profile; the
   * dialplan then reports each step to {@link handleWebhook}.
   */
  async start(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppPhoneCallDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const conversation = await WhatsAppConversationRepository.findById(
      conversationId,
      workspaceId,
    )
    if (!conversation.ok) return conversation
    if (!conversation.value) return err(whatsappConversationNotFound())

    const actor = await UserRepository.findById(actorId)
    if (!actor.ok) return actor
    const { pabxExtension, pabxDeviceId } = actor.value
    if (!pabxExtension || !pabxDeviceId) return err(pabxExtensionRequired())

    const callbackToken = randomBytes(24).toString('base64url')
    const created = await WhatsAppPhoneCallRepository.create({
      workspaceId,
      conversationId,
      userId: actorId,
      deviceId: pabxDeviceId,
      extension: pabxExtension,
      destination: conversation.value.contact.waId,
      callbackTokenHash: hashToken(callbackToken),
    })
    if (!created.ok) return created

    const queued = await placePabxCall({
      deviceId: pabxDeviceId,
      extension: pabxExtension,
      destination: conversation.value.contact.waId,
      callbackUrl: callbackUrl(),
      callbackToken,
    })

    auditMutation({
      entity: 'whatsapp_phone_call',
      action: 'create',
      actorId,
      targetId: created.value.id,
      outcome: queued.ok ? 'success' : 'failure',
      reason: queued.ok ? undefined : queued.error.code,
      meta: { workspaceId, conversationId, deviceId: pabxDeviceId },
    })

    if (!queued.ok) {
      await WhatsAppPhoneCallRepository.update(created.value.id, {
        status: 'FAILED',
        endedAt: new Date(),
      })
      return queued
    }

    const updated = await WhatsAppPhoneCallRepository.update(created.value.id, {
      destination: queued.value.destination,
      job: queued.value.job,
    })
    if (!updated.ok) return updated

    logger.info('whatsapp phone call queued', {
      workspaceId,
      conversationId,
      callId: updated.value.id,
      deviceId: pabxDeviceId,
      job: queued.value.job,
    })
    await publishCall(updated.value)
    return ok(toWhatsAppPhoneCallDTO(updated.value))
  },

  /** Latest call of the conversation (the header shows its live status). */
  async latest(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppPhoneCallDTO | null>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const call = await WhatsAppPhoneCallRepository.findLatestByConversation(
      conversationId,
      workspaceId,
    )
    if (!call.ok) return call
    return ok(call.value ? toWhatsAppPhoneCallDTO(call.value) : null)
  },

  /**
   * Status report from the PABX dialplan. The per-call callback token both
   * authenticates and identifies the call; reports after the final one are
   * ignored, so retries and late hangups are harmless.
   */
  async handleWebhook(
    report: PabxCallWebhookDTO,
  ): Promise<Result<WhatsAppPhoneCallDTO>> {
    const found = await WhatsAppPhoneCallRepository.findByCallbackTokenHash(
      hashToken(report.token),
    )
    if (!found.ok) return found
    if (!found.value) return err(pabxCallbackInvalid())

    const call = found.value
    const next = transition(call, report, new Date())
    if (!next) return ok(toWhatsAppPhoneCallDTO(call))

    const updated = await WhatsAppPhoneCallRepository.update(call.id, next)
    if (!updated.ok) return updated

    logger.info('whatsapp phone call status', {
      workspaceId: call.workspaceId,
      callId: call.id,
      event: report.event,
      dialStatus: report.dialstatus,
      status: updated.value.status,
    })
    await publishCall(updated.value)
    return ok(toWhatsAppPhoneCallDTO(updated.value))
  },
}

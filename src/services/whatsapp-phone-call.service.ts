import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  pabxExtensionRequired,
  whatsappConversationNotFound,
} from '@/src/errors'
import { placePabxCall } from '@/src/lib/pabx/click-to-call'
import { err, ok, type Result } from '@/src/lib/result'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import type {
  StartWhatsAppPhoneCallDTO,
  WhatsAppPhoneCallDTO,
} from '@/src/schemas/whatsapp-phone-call.schema'
import { assertModuleMember } from './authz'

export const WhatsAppPhoneCallService = {
  /**
   * Click-to-call: the PABX rings the actor's extension and bridges it to the
   * conversation contact. The extension/device come from the actor's profile.
   */
  async start(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: StartWhatsAppPhoneCallDTO,
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

    const call = await placePabxCall({
      deviceId: pabxDeviceId,
      extension: pabxExtension,
      destination: conversation.value.contact.waId,
      mode: dto.mode,
    })

    auditMutation({
      entity: 'whatsapp_phone_call',
      action: 'create',
      actorId,
      targetId: conversationId,
      outcome: call.ok ? 'success' : 'failure',
      reason: call.ok ? undefined : call.error.code,
      meta: { workspaceId, extension: pabxExtension, mode: dto.mode },
    })
    if (!call.ok) return call

    logger.info('whatsapp phone call started', {
      workspaceId,
      conversationId,
      extension: pabxExtension,
      mode: dto.mode,
    })

    return ok({
      conversationId,
      extension: pabxExtension,
      destination: call.value.destination,
      mode: dto.mode,
    })
  },
}

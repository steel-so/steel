import { auditMutation } from '@/lib/axiom/audit'
import {
  whatsappConnectionNotFound,
  whatsappGroupNotFound,
  whatsappGroupProviderUnsupported,
  whatsappProviderError,
} from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { consume, whatsappSendLimiter } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import type { ZapiCredentials } from '@/src/lib/whatsapp/zapi-client'
import {
  addZapiGroupParticipants,
  createZapiGroup,
  getZapiGroupInviteLink,
  getZapiGroupMetadata,
  leaveZapiGroup,
  removeZapiGroupParticipants,
  setZapiGroupAdmin,
  updateZapiGroupDescription,
  updateZapiGroupName,
  updateZapiGroupPhoto,
} from '@/src/lib/whatsapp/zapi-groups'
import { toWhatsAppGroupDTO } from '@/src/mappers/whatsapp-group.mapper'
import { toWhatsAppGroupMessageDTO } from '@/src/mappers/whatsapp-group-message.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppGroupRepository } from '@/src/repositories/whatsapp-group.repository'
import { WhatsAppGroupMessageRepository } from '@/src/repositories/whatsapp-group-message.repository'
import type {
  CreateWhatsAppGroupDTO,
  GroupParticipantsDTO,
  SendWhatsAppGroupTextMessageDTO,
  SetGroupAdminDTO,
  UpdateWhatsAppGroupDTO,
} from '@/src/schemas/whatsapp-group.schema'
import type { WhatsAppGroupDTO } from '@/types/whatsapp-group'
import type { WhatsAppGroupMessageDTO } from '@/types/whatsapp-group-message'
import { assertModuleMember } from './authz'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'

async function resolveZapiConnection(
  workspaceId: string,
  connectionId: string,
) {
  const connection = await WhatsAppConnectionRepository.findById(
    connectionId,
    workspaceId,
  )
  if (!connection.ok) return connection
  if (!connection.value) return err(whatsappConnectionNotFound())
  if (connection.value.provider !== 'ZAPI') {
    return err(whatsappGroupProviderUnsupported())
  }
  if (
    !connection.value.zapiInstanceId ||
    !connection.value.encryptedZapiToken
  ) {
    return err(whatsappGroupProviderUnsupported())
  }

  const token = await decryptConnectionSecret(
    connection.value.encryptedZapiToken,
  )
  const clientToken = connection.value.encryptedZapiClientToken
    ? await decryptConnectionSecret(connection.value.encryptedZapiClientToken)
    : undefined

  return ok({
    connection: connection.value,
    credentials: {
      instanceId: connection.value.zapiInstanceId,
      token,
      clientToken,
    },
  })
}

// Z-API's group-metadata endpoint only returns { phone, isAdmin } per
// participant — no name at all — so we cross-reference the workspace's own
// contact book to show a name instead of a raw phone number wherever we can.
async function resolveParticipantNames(
  workspaceId: string,
  waIds: string[],
): Promise<Map<string, string>> {
  const contacts = await WhatsAppContactRepository.findManyByWaIds(
    workspaceId,
    waIds,
  )
  const names = new Map<string, string>()
  if (!contacts.ok) return names
  for (const contact of contacts.value) {
    if (contact.name) names.set(contact.waId, contact.name)
  }
  return names
}

async function loadGroupWithZapi(workspaceId: string, groupId: string) {
  const group = await WhatsAppGroupRepository.findById(groupId, workspaceId)
  if (!group.ok) return group
  if (!group.value) return err(whatsappGroupNotFound())

  const resolved = await resolveZapiConnection(
    workspaceId,
    group.value.connectionId,
  )
  if (!resolved.ok) return resolved

  return ok({ group: group.value, ...resolved.value })
}

export const WhatsAppGroupService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: { archived?: boolean } = {},
  ): Promise<Result<WhatsAppGroupDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result = await WhatsAppGroupRepository.listByWorkspace(
      workspaceId,
      filters,
    )
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppGroupDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppGroupDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const group = await WhatsAppGroupRepository.findById(id, workspaceId)
    if (!group.ok) return group
    if (!group.value) return err(whatsappGroupNotFound())

    return ok(toWhatsAppGroupDTO(group.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppGroupDTO,
  ): Promise<Result<WhatsAppGroupDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const resolved = await resolveZapiConnection(workspaceId, dto.connectionId)
    if (!resolved.ok) return resolved

    const limit = await consume(
      whatsappSendLimiter,
      resolved.value.connection.id,
    )
    if (!limit.ok) return limit

    let created: Awaited<ReturnType<typeof createZapiGroup>>
    try {
      created = await createZapiGroup(resolved.value.credentials, {
        name: dto.name,
        phones: dto.participantWaIds,
      })
    } catch (error) {
      return err(
        whatsappProviderError(
          error instanceof Error ? error.message : 'Falha ao criar grupo',
        ),
      )
    }

    const group = await WhatsAppGroupRepository.create({
      workspaceId,
      connectionId: dto.connectionId,
      groupJid: created.groupJid,
      name: dto.name,
      inviteLink: created.inviteLink,
    })
    if (!group.ok) return group

    const participantNames = await resolveParticipantNames(
      workspaceId,
      dto.participantWaIds,
    )
    await WhatsAppGroupRepository.replaceParticipants(
      group.value.id,
      dto.participantWaIds.map((waId) => ({
        waId,
        name: participantNames.get(waId),
        role: 'MEMBER' as const,
      })),
    )

    const fresh = await WhatsAppGroupRepository.findById(
      group.value.id,
      workspaceId,
    )
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappGroupNotFound())

    auditMutation({
      entity: 'whatsapp_group',
      action: 'create',
      actorId,
      targetId: group.value.id,
    })

    return ok(toWhatsAppGroupDTO(fresh.value))
  },

  async updateInfo(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppGroupDTO,
  ): Promise<Result<WhatsAppGroupDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const loaded = await loadGroupWithZapi(workspaceId, id)
    if (!loaded.ok) return loaded
    const { group, credentials } = loaded.value

    try {
      if (dto.name) {
        await updateZapiGroupName(credentials, {
          groupJid: group.groupJid,
          name: dto.name,
        })
      }
      if (dto.description !== undefined) {
        await updateZapiGroupDescription(credentials, {
          groupJid: group.groupJid,
          description: dto.description,
        })
      }
      if (dto.imageUrl) {
        await updateZapiGroupPhoto(credentials, {
          groupJid: group.groupJid,
          imageUrl: dto.imageUrl,
        })
      }
    } catch {
      return err(whatsappGroupProviderUnsupported())
    }

    const updated = await WhatsAppGroupRepository.update(id, dto)
    if (!updated.ok) return updated

    const fresh = await WhatsAppGroupRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappGroupNotFound())

    auditMutation({
      entity: 'whatsapp_group',
      action: 'update',
      actorId,
      targetId: id,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toWhatsAppGroupDTO(fresh.value))
  },

  async addParticipants(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: GroupParticipantsDTO,
  ): Promise<Result<WhatsAppGroupDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const loaded = await loadGroupWithZapi(workspaceId, id)
    if (!loaded.ok) return loaded
    const { group, credentials } = loaded.value

    try {
      await addZapiGroupParticipants(credentials, {
        groupJid: group.groupJid,
        phones: dto.waIds,
      })
    } catch {
      return err(whatsappGroupProviderUnsupported())
    }

    return syncParticipantsFromProvider(
      workspaceId,
      id,
      credentials,
      group.groupJid,
    )
  },

  async removeParticipants(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: GroupParticipantsDTO,
  ): Promise<Result<WhatsAppGroupDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const loaded = await loadGroupWithZapi(workspaceId, id)
    if (!loaded.ok) return loaded
    const { group, credentials } = loaded.value

    try {
      await removeZapiGroupParticipants(credentials, {
        groupJid: group.groupJid,
        phones: dto.waIds,
      })
    } catch {
      return err(whatsappGroupProviderUnsupported())
    }

    return syncParticipantsFromProvider(
      workspaceId,
      id,
      credentials,
      group.groupJid,
    )
  },

  async setAdmin(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: SetGroupAdminDTO,
  ): Promise<Result<WhatsAppGroupDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const loaded = await loadGroupWithZapi(workspaceId, id)
    if (!loaded.ok) return loaded
    const { group, credentials } = loaded.value

    try {
      await setZapiGroupAdmin(credentials, {
        groupJid: group.groupJid,
        phone: dto.waId,
        admin: dto.admin,
      })
    } catch {
      return err(whatsappGroupProviderUnsupported())
    }

    return syncParticipantsFromProvider(
      workspaceId,
      id,
      credentials,
      group.groupJid,
    )
  },

  async getInviteLink(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<{ inviteLink: string }>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const loaded = await loadGroupWithZapi(workspaceId, id)
    if (!loaded.ok) return loaded
    const { group, credentials } = loaded.value

    let inviteLink: string | null
    try {
      inviteLink = await getZapiGroupInviteLink(credentials, {
        groupJid: group.groupJid,
      })
    } catch {
      return err(whatsappGroupProviderUnsupported())
    }
    if (!inviteLink) {
      return err(whatsappProviderError('Link de convite indisponível'))
    }

    await WhatsAppGroupRepository.update(id, { inviteLink })

    return ok({ inviteLink })
  },

  async leave(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<{ id: string }>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const loaded = await loadGroupWithZapi(workspaceId, id)
    if (!loaded.ok) return loaded
    const { group, credentials } = loaded.value

    try {
      await leaveZapiGroup(credentials, { groupJid: group.groupJid })
    } catch {
      return err(whatsappGroupProviderUnsupported())
    }

    const updated = await WhatsAppGroupRepository.update(id, {
      archivedAt: new Date(),
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_group',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { left: true },
    })

    return ok({ id })
  },

  async listMessages(
    actorId: string,
    workspaceId: string,
    groupId: string,
    options: { cursor?: string; limit: number },
  ): Promise<Result<WhatsAppGroupMessageDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const group = await WhatsAppGroupRepository.findById(groupId, workspaceId)
    if (!group.ok) return group
    if (!group.value) return err(whatsappGroupNotFound())

    const result = await WhatsAppGroupMessageRepository.listByGroup(
      groupId,
      options,
    )
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppGroupMessageDTO))
  },

  async sendText(
    actorId: string,
    workspaceId: string,
    groupId: string,
    dto: SendWhatsAppGroupTextMessageDTO,
  ): Promise<Result<WhatsAppGroupMessageDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'groups', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const open = await WhatsAppBusinessHoursService.assertOpen(workspaceId)
    if (!open.ok) return open

    const loaded = await loadGroupWithZapi(workspaceId, groupId)
    if (!loaded.ok) return loaded
    const { group, connection } = loaded.value

    const sendResult = await WhatsAppSend.text(connection, {
      to: group.groupJid,
      text: dto.text,
      mentionedWaIds: dto.mentionedWaIds,
    })
    if (!sendResult.ok) return sendResult

    const message = await WhatsAppGroupMessageRepository.create({
      workspaceId,
      groupId,
      direction: 'OUT',
      type: 'TEXT',
      text: dto.text,
      providerMessageId: sendResult.value.providerMessageId,
      status: 'SENT',
      senderUserId: actorId,
    })
    if (!message.ok) return message

    await WhatsAppGroupRepository.update(groupId, { lastMessageAt: new Date() })

    auditMutation({
      entity: 'whatsapp_group_message',
      action: 'send',
      actorId,
      targetId: message.value.id,
      meta: { groupId },
    })

    return ok(toWhatsAppGroupMessageDTO(message.value))
  },
}

async function syncParticipantsFromProvider(
  workspaceId: string,
  groupId: string,
  credentials: ZapiCredentials,
  groupJid: string,
): Promise<Result<WhatsAppGroupDTO>> {
  let metadata: Awaited<ReturnType<typeof getZapiGroupMetadata>>
  try {
    metadata = await getZapiGroupMetadata(credentials, { groupJid })
  } catch (error) {
    return err(
      whatsappProviderError(
        error instanceof Error
          ? error.message
          : 'Falha ao sincronizar participantes do grupo',
      ),
    )
  }

  const participantNames = await resolveParticipantNames(
    workspaceId,
    metadata.participants.map((p) => p.phone),
  )
  await WhatsAppGroupRepository.replaceParticipants(
    groupId,
    metadata.participants.map((p) => ({
      waId: p.phone,
      name: participantNames.get(p.phone),
      role: p.isAdmin ? ('ADMIN' as const) : ('MEMBER' as const),
    })),
  )

  const fresh = await WhatsAppGroupRepository.findById(groupId, workspaceId)
  if (!fresh.ok) return fresh
  if (!fresh.value) return err(whatsappGroupNotFound())

  return ok(toWhatsAppGroupDTO(fresh.value))
}

import { auditMutation } from '@/lib/axiom/audit'
import { notFound, validationError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  aiMediaKeyFromName,
  classifyAiMedia,
} from '@/src/lib/whatsapp/ai-media'
import { persistOutboundMedia } from '@/src/lib/whatsapp/media'
import { toWhatsAppAiMediaDTO } from '@/src/mappers/whatsapp-ai-media.mapper'
import { WhatsAppAiMediaRepository } from '@/src/repositories/whatsapp-ai-media.repository'
import type {
  CreateWhatsAppAiMediaDTO,
  UpdateWhatsAppAiMediaDTO,
} from '@/src/schemas/whatsapp-ai-media.schema'
import type { WhatsAppAiMediaDTO } from '@/types/whatsapp-ai-media'
import { assertModulePrivileged } from './authz'

/**
 * Images and videos the AI may send in a conversation (the user uploads the
 * file and writes when to send it). Managed by the Comunicação admins, like
 * the rest of the AI configuration.
 */
export const WhatsAppAiMediaService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAiMediaDTO[]>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const rows = await WhatsAppAiMediaRepository.listByWorkspace(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppAiMediaDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    input: CreateWhatsAppAiMediaDTO & {
      contentType: string
      fileName: string
      byteSize: number
      readBody: () => Promise<Buffer>
    },
  ): Promise<Result<WhatsAppAiMediaDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const key = aiMediaKeyFromName(input.name)
    if (!key) return err(validationError('Dê um nome ao arquivo'))
    const kind = classifyAiMedia(input.contentType, input.byteSize)
    if (!kind.ok) return err(validationError(kind.message))

    const stored = await persistOutboundMedia({
      workspaceId,
      body: await input.readBody(),
      contentType: input.contentType.split(';')[0]?.trim() ?? input.contentType,
    })
    if (!stored.ok) return stored

    const created = await WhatsAppAiMediaRepository.create({
      workspaceId,
      key,
      name: input.name,
      whenToSend: input.whenToSend,
      mediaUrl: stored.value.url,
      mediaType: kind.mediaType,
      mimeType: input.contentType.split(';')[0]?.trim() ?? input.contentType,
      fileName: input.fileName,
      sizeBytes: input.byteSize,
      createdById: actorId,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_ai_media',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, key, mediaType: kind.mediaType },
    })
    return ok(toWhatsAppAiMediaDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppAiMediaDTO,
  ): Promise<Result<WhatsAppAiMediaDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const updated = await WhatsAppAiMediaRepository.update(id, workspaceId, dto)
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_ai_media',
      action: 'update',
      actorId,
      targetId: id,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toWhatsAppAiMediaDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const existing = await WhatsAppAiMediaRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(notFound('Arquivo'))
    const deleted = await WhatsAppAiMediaRepository.delete(id, workspaceId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'whatsapp_ai_media',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { workspaceId, key: existing.value.key },
    })
    return ok(undefined)
  },
}

import { createId } from '@paralleldrive/cuid2'
import { auditMutation } from '@/lib/axiom/audit'
import { storageError, whatsappAiKnowledgeDocumentNotFound } from '@/src/errors'
import {
  removeKnowledgeSource,
  scheduleKnowledgeIndex,
} from '@/src/lib/ai/knowledge/index-hooks'
import { err, ok, type Result } from '@/src/lib/result'
import { deleteObject, ensureBucket, putObject } from '@/src/lib/storage/s3'
import {
  classifyKnowledgeDocument,
  extractKnowledgeDocumentText,
} from '@/src/lib/whatsapp/knowledge-document'
import { toWhatsAppAiKnowledgeDocumentDTO } from '@/src/mappers/whatsapp-ai-knowledge-document.mapper'
import { WhatsAppAiKnowledgeDocumentRepository } from '@/src/repositories/whatsapp-ai-knowledge-document.repository'
import type { WhatsAppAiKnowledgeDocumentDTO } from '@/types/whatsapp-ai-knowledge-document'
import { assertModulePrivileged } from './authz'

const BUCKET = 'whatsapp-ai-knowledge'

export const WhatsAppAiKnowledgeDocumentService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAiKnowledgeDocumentDTO[]>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const result =
      await WhatsAppAiKnowledgeDocumentRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppAiKnowledgeDocumentDTO))
  },

  async upload(
    actorId: string,
    workspaceId: string,
    input: {
      contentType: string
      byteSize: number
      filename: string
      readBody: () => Promise<Buffer>
    },
  ): Promise<Result<WhatsAppAiKnowledgeDocumentDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const classification = classifyKnowledgeDocument(
      input.contentType,
      input.byteSize,
    )
    if (!classification.ok) return classification
    const { ext } = classification.value

    const body = await input.readBody()
    const storageKey = `${workspaceId}/${createId()}.${ext}`

    try {
      await ensureBucket(BUCKET)
      await putObject({
        bucket: BUCKET,
        key: storageKey,
        body,
        contentType: input.contentType,
      })
    } catch {
      return err(storageError('Falha ao armazenar o documento'))
    }

    const created = await WhatsAppAiKnowledgeDocumentRepository.create({
      workspaceId,
      createdById: actorId,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.byteSize,
      storageKey,
    })
    if (!created.ok) return created

    const extraction = await extractKnowledgeDocumentText(
      input.contentType,
      body,
    )
    const updated = await WhatsAppAiKnowledgeDocumentRepository.updateStatus(
      created.value.id,
      extraction.ok
        ? { status: 'READY', extractedText: extraction.value }
        : { status: 'FAILED', errorMessage: extraction.error },
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_ai_knowledge_document',
      action: 'upload',
      actorId,
      targetId: updated.value.id,
      meta: { filename: input.filename, status: updated.value.status },
    })
    if (updated.value.status === 'READY') {
      void scheduleKnowledgeIndex(
        'zap-knowledge-doc',
        workspaceId,
        updated.value.id,
      )
    }

    return ok(toWhatsAppAiKnowledgeDocumentDTO(updated.value))
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

    const existing = await WhatsAppAiKnowledgeDocumentRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappAiKnowledgeDocumentNotFound())

    const deleted = await WhatsAppAiKnowledgeDocumentRepository.delete(id)
    if (!deleted.ok) return deleted

    try {
      await deleteObject({ bucket: BUCKET, key: existing.value.storageKey })
    } catch {
      // Registro já removido do banco; o objeto órfão no MinIO não impede a
      // feature de funcionar e não vale falhar a operação por causa disso.
    }

    auditMutation({
      entity: 'whatsapp_ai_knowledge_document',
      action: 'delete',
      actorId,
      targetId: id,
    })
    void removeKnowledgeSource('zap-knowledge-doc', workspaceId, id)

    return ok(undefined)
  },
}

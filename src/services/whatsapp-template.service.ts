import { auditMutation } from '@/lib/axiom/audit'
import { badRequest, whatsappConnectionNotFound } from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import {
  createMetaTemplate,
  fetchMetaTemplates,
} from '@/src/lib/whatsapp/meta-templates'
import {
  countPlaceholders,
  type MetaTemplateBodyComponent,
  type MetaTemplateComponent,
} from '@/src/lib/whatsapp/template-variables'
import { toWhatsAppTemplateDTO } from '@/src/mappers/whatsapp-template.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type { CreateWhatsAppTemplateInput } from '@/src/schemas/whatsapp-template.schema'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { assertModuleMember } from './authz'
import { notifyWhatsAppUsers, whatsAppAdminIds } from './whatsapp-notify'

const STATUS_MAP: Record<string, 'APPROVED' | 'PENDING' | 'REJECTED'> = {
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
}

function buildComponents(
  input: CreateWhatsAppTemplateInput,
): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = []
  if (input.headerText) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText })
  }

  const variableCount = countPlaceholders(input.body)
  const bodyComponent: MetaTemplateBodyComponent = {
    type: 'BODY',
    text: input.body,
  }
  if (variableCount > 0) {
    bodyComponent.example = {
      body_text: [
        Array.from(
          { length: variableCount },
          (_, i) => input.bodyExample?.[i] || `exemplo${i + 1}`,
        ),
      ],
    }
  }
  components.push(bodyComponent)

  if (input.footer) {
    components.push({ type: 'FOOTER', text: input.footer })
  }
  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((button) =>
        button.type === 'URL'
          ? { type: 'URL', text: button.label, url: button.url }
          : { type: 'QUICK_REPLY', text: button.label },
      ),
    })
  }
  return components
}

export const WhatsAppTemplateService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppTemplateDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'message-templates', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result = await WhatsAppTemplateRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppTemplateDTO))
  },

  async sync(
    actorId: string,
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<WhatsAppTemplateDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'message-templates', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const connection = await WhatsAppConnectionRepository.findById(
      connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())
    if (
      connection.value.provider !== 'META' ||
      !connection.value.metaWabaId ||
      !connection.value.encryptedMetaAccessToken
    ) {
      return err(
        badRequest(
          'Sincronização de templates está disponível apenas para conexões Meta',
        ),
      )
    }

    const accessToken = await decryptConnectionSecret(
      connection.value.encryptedMetaAccessToken,
    )

    let raw: Awaited<ReturnType<typeof fetchMetaTemplates>>
    try {
      raw = await fetchMetaTemplates({
        wabaId: connection.value.metaWabaId,
        accessToken,
      })
    } catch (error) {
      return err(
        badRequest(
          error instanceof Error
            ? error.message
            : 'Falha ao sincronizar templates',
        ),
      )
    }

    // Status before the sync, to spot the templates that *became* REJECTED
    // (one first seen already rejected is old news, not a transition).
    const before = new Map<string, string>()
    const known = await WhatsAppTemplateRepository.listByWorkspace(workspaceId)
    if (known.ok) {
      for (const template of known.value) {
        if (template.connectionId !== connectionId) continue
        before.set(`${template.name}|${template.language}`, template.status)
      }
    }
    const rejected: string[] = []

    const synced: WhatsAppTemplateDTO[] = []
    for (const item of raw) {
      const result = await WhatsAppTemplateRepository.upsertSynced({
        workspaceId,
        connectionId,
        name: item.name,
        language: item.language,
        category: item.category,
        status: STATUS_MAP[item.status] ?? 'PENDING',
        components: item.components as never,
      })
      if (!result.ok) continue
      synced.push(toWhatsAppTemplateDTO(result.value))
      const previous = before.get(`${item.name}|${item.language}`)
      if (
        result.value.status === 'REJECTED' &&
        previous !== undefined &&
        previous !== 'REJECTED'
      ) {
        rejected.push(`${item.name} (${item.language})`)
      }
    }

    if (rejected.length > 0) {
      await notifyWhatsAppUsers({
        workspaceId,
        kind: 'WHATSAPP_TEMPLATE_REJECTED',
        userIds: await whatsAppAdminIds(workspaceId),
        actorId,
        title:
          rejected.length === 1
            ? 'Template reprovado pela Meta'
            : `${rejected.length} templates reprovados pela Meta`,
        body: `Reprovado(s): ${rejected.join(', ')}.`,
        path: '/zap/templates',
        meta: { connectionId, rejected: rejected.length },
      })
    }

    auditMutation({
      entity: 'whatsapp_template',
      action: 'sync',
      actorId,
      targetId: connectionId,
      meta: { count: synced.length },
    })

    return ok(synced)
  },

  async create(
    actorId: string,
    workspaceId: string,
    input: CreateWhatsAppTemplateInput,
  ): Promise<Result<WhatsAppTemplateDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'message-templates', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const connection = await WhatsAppConnectionRepository.findById(
      input.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())
    if (
      connection.value.provider !== 'META' ||
      !connection.value.metaWabaId ||
      !connection.value.encryptedMetaAccessToken
    ) {
      return err(
        badRequest(
          'Criação de templates está disponível apenas para conexões Meta',
        ),
      )
    }

    const accessToken = await decryptConnectionSecret(
      connection.value.encryptedMetaAccessToken,
    )
    const components = buildComponents(input)

    let created: Awaited<ReturnType<typeof createMetaTemplate>>
    try {
      created = await createMetaTemplate({
        wabaId: connection.value.metaWabaId,
        accessToken,
        name: input.name,
        language: input.language,
        category: input.category,
        components: components as unknown[],
      })
    } catch (error) {
      return err(
        badRequest(
          error instanceof Error ? error.message : 'Falha ao criar template',
        ),
      )
    }

    const saved = await WhatsAppTemplateRepository.upsertSynced({
      workspaceId,
      connectionId: input.connectionId,
      name: input.name,
      language: input.language,
      category: input.category,
      status: STATUS_MAP[created.status] ?? 'PENDING',
      components: components as never,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_template',
      action: 'create',
      actorId,
      targetId: saved.value.id,
      meta: { name: input.name, category: input.category },
    })

    return ok(toWhatsAppTemplateDTO(saved.value))
  },
}

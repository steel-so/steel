import type {
  Prisma,
  WhatsAppConnection,
  WhatsAppTemplate,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { WHATSAPP_META_APP_ID } from '@/lib/env/server'
import {
  badRequest,
  validationError,
  whatsappConnectionNotFound,
  whatsappTemplateNotFound,
} from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { readWorkspaceMedia } from '@/src/lib/whatsapp/media'
import {
  createMetaTemplate,
  fetchMetaTemplates,
  uploadMetaTemplateMedia,
} from '@/src/lib/whatsapp/meta-templates'
import { templateButtons } from '@/src/lib/whatsapp/template-send'
import {
  countPlaceholders,
  type MetaTemplateBodyComponent,
  type MetaTemplateComponent,
} from '@/src/lib/whatsapp/template-variables'
import { toWhatsAppTemplateDTO } from '@/src/mappers/whatsapp-template.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type { UpdateWhatsAppTemplateButtonsInput } from '@/src/schemas/whatsapp-button.schema'
import type { CreateWhatsAppTemplateInput } from '@/src/schemas/whatsapp-template.schema'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { assertModuleMember } from './authz'
import { notifyWhatsAppUsers, whatsAppAdminIds } from './whatsapp-notify'

type TemplateStatus = WhatsAppTemplate['status']
type TemplateQuality = WhatsAppTemplate['quality']

const STATUS_MAP: Record<string, TemplateStatus> = {
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
  // Webhook-only events: an appeal won puts the template back in use.
  REINSTATED: 'APPROVED',
}

/** Meta reports GREEN/YELLOW/RED (older payloads: HIGH/MEDIUM/LOW). */
const QUALITY_MAP: Record<string, TemplateQuality> = {
  GREEN: 'GREEN',
  HIGH: 'GREEN',
  YELLOW: 'YELLOW',
  MEDIUM: 'YELLOW',
  RED: 'RED',
  LOW: 'RED',
  UNKNOWN: 'UNKNOWN',
}

const HEADER_FORMATS = new Set(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'])
const TEMPLATES_PATH = '/zap/templates'

function mapQuality(score: string | undefined): TemplateQuality {
  return (score && QUALITY_MAP[score.toUpperCase()]) || 'UNKNOWN'
}

/** Meta says `NONE` when nothing was rejected. */
function cleanReason(reason: string | undefined | null): string | null {
  const value = reason?.trim()
  return value && value.toUpperCase() !== 'NONE' ? value : null
}

function headerFormatOf(
  components: unknown[],
): WhatsAppTemplate['headerFormat'] {
  const header = components.find(
    (c): c is { type: string; format?: string } =>
      typeof c === 'object' &&
      c !== null &&
      (c as { type?: unknown }).type === 'HEADER',
  )
  return header?.format && HEADER_FORMATS.has(header.format)
    ? (header.format as WhatsAppTemplate['headerFormat'])
    : null
}

function label(template: Pick<WhatsAppTemplate, 'name' | 'language'>) {
  return `${template.name} (${template.language})`
}

/** Quality fell to RED or Meta paused/disabled the template: sending more
 * risks the number's own rating, so the admins hear about it. */
async function notifyQualityRisk(
  workspaceId: string,
  templates: string[],
  actorId: string | null,
): Promise<void> {
  if (templates.length === 0) return
  await notifyWhatsAppUsers({
    workspaceId,
    kind: 'WHATSAPP_TEMPLATE_QUALITY',
    userIds: await whatsAppAdminIds(workspaceId),
    actorId,
    title:
      templates.length === 1
        ? 'Template com qualidade em risco'
        : `${templates.length} templates com qualidade em risco`,
    body: `Evite enviar até a qualidade melhorar: ${templates.join(', ')}.`,
    path: TEMPLATES_PATH,
    meta: { templates: templates.length },
  })
}

async function notifyRejected(
  workspaceId: string,
  templates: string[],
  actorId: string | null,
  meta: Record<string, unknown>,
): Promise<void> {
  if (templates.length === 0) return
  await notifyWhatsAppUsers({
    workspaceId,
    kind: 'WHATSAPP_TEMPLATE_REJECTED',
    userIds: await whatsAppAdminIds(workspaceId),
    actorId,
    title:
      templates.length === 1
        ? 'Template reprovado pela Meta'
        : `${templates.length} templates reprovados pela Meta`,
    body: `Reprovado(s): ${templates.join(', ')}.`,
    path: TEMPLATES_PATH,
    meta: { ...meta, rejected: templates.length },
  })
}

function isAtRisk(status: TemplateStatus, quality: TemplateQuality): boolean {
  return quality === 'RED' || status === 'PAUSED' || status === 'DISABLED'
}

function buildComponents(
  input: CreateWhatsAppTemplateInput,
  headerHandle: string | null,
): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = []
  const format = input.headerFormat ?? (input.headerText ? 'TEXT' : undefined)
  if (format === 'TEXT' && input.headerText) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText })
  } else if (format && format !== 'TEXT' && headerHandle) {
    components.push({
      type: 'HEADER',
      format,
      example: { header_handle: [headerHandle] },
    })
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

/** Same buttons as the approved template (type, label, link) — only the
 * ids and the actions of reply buttons may change. */
function sameButtonShape(
  current: WhatsAppButtonDTO[],
  next: WhatsAppButtonDTO[],
): boolean {
  if (current.length !== next.length) return false
  return current.every((button, index) => {
    const other = next[index]
    if (button.type !== other.type || button.label !== other.label) {
      return false
    }
    return button.type === 'URL' && other.type === 'URL'
      ? button.url === other.url
      : true
  })
}

async function metaCredentials(
  connection: WhatsAppConnection,
  unsupportedMessage: string,
): Promise<Result<{ wabaId: string; accessToken: string }>> {
  if (
    connection.provider !== 'META' ||
    !connection.metaWabaId ||
    !connection.encryptedMetaAccessToken
  ) {
    return err(badRequest(unsupportedMessage))
  }
  return ok({
    wabaId: connection.metaWabaId,
    accessToken: await decryptConnectionSecret(
      connection.encryptedMetaAccessToken,
    ),
  })
}

/** Uploads our copy of the header media to Meta (Resumable Upload API). */
async function uploadHeaderSample(
  workspaceId: string,
  accessToken: string,
  input: CreateWhatsAppTemplateInput,
): Promise<Result<string | null>> {
  const format = input.headerFormat
  if (!format || format === 'TEXT' || !input.headerMediaUrl) return ok(null)

  const media = await readWorkspaceMedia(workspaceId, input.headerMediaUrl)
  if (!media.ok) return media
  try {
    const handle = await uploadMetaTemplateMedia({
      accessToken,
      appId: WHATSAPP_META_APP_ID,
      body: media.value.body,
      contentType: media.value.contentType,
      fileName: media.value.fileName,
    })
    return ok(handle)
  } catch (error) {
    return err(
      badRequest(
        error instanceof Error
          ? error.message
          : 'Falha ao enviar a mídia do cabeçalho para a Meta',
      ),
    )
  }
}

/** Value of a `message_template_status_update` webhook change. */
export interface MetaTemplateStatusUpdate {
  event?: string
  message_template_name?: string
  message_template_language?: string
  reason?: string | null
}

/** Value of a `message_template_quality_update` webhook change. */
export interface MetaTemplateQualityUpdate {
  new_quality_score?: string
  message_template_name?: string
  message_template_language?: string
}

export type MetaTemplateWebhookInput =
  | {
      wabaId: string
      field: 'message_template_status_update'
      value: MetaTemplateStatusUpdate
    }
  | {
      wabaId: string
      field: 'message_template_quality_update'
      value: MetaTemplateQualityUpdate
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
    const credentials = await metaCredentials(
      connection.value,
      'Sincronização de templates está disponível apenas para conexões Meta',
    )
    if (!credentials.ok) return credentials

    let raw: Awaited<ReturnType<typeof fetchMetaTemplates>>
    try {
      raw = await fetchMetaTemplates(credentials.value)
    } catch (error) {
      return err(
        badRequest(
          error instanceof Error
            ? error.message
            : 'Falha ao sincronizar templates',
        ),
      )
    }

    // State before the sync, to spot the templates that *became* REJECTED
    // or at risk (one first seen that way is old news, not a transition).
    const before = new Map<
      string,
      { status: TemplateStatus; quality: TemplateQuality }
    >()
    const known = await WhatsAppTemplateRepository.listByWorkspace(workspaceId)
    if (known.ok) {
      for (const template of known.value) {
        if (template.connectionId !== connectionId) continue
        before.set(`${template.name}|${template.language}`, {
          status: template.status,
          quality: template.quality,
        })
      }
    }
    const rejected: string[] = []
    const atRisk: string[] = []
    const now = new Date()

    const synced: WhatsAppTemplateDTO[] = []
    for (const item of raw) {
      const components = Array.isArray(item.components) ? item.components : []
      const result = await WhatsAppTemplateRepository.upsertSynced({
        workspaceId,
        connectionId,
        name: item.name,
        language: item.language,
        category: item.category,
        status: STATUS_MAP[item.status] ?? 'PENDING',
        components: components as Prisma.InputJsonValue,
        quality: mapQuality(item.quality_score?.score),
        qualityUpdatedAt: item.quality_score?.date
          ? new Date(item.quality_score.date * 1000)
          : now,
        statusReason: cleanReason(item.rejected_reason),
        headerFormat: headerFormatOf(components),
      })
      if (!result.ok) continue
      synced.push(toWhatsAppTemplateDTO(result.value))
      const previous = before.get(`${item.name}|${item.language}`)
      if (!previous) continue
      if (
        result.value.status === 'REJECTED' &&
        previous.status !== 'REJECTED'
      ) {
        rejected.push(label(item))
      }
      if (
        isAtRisk(result.value.status, result.value.quality) &&
        !isAtRisk(previous.status, previous.quality)
      ) {
        atRisk.push(label(item))
      }
    }

    await notifyRejected(workspaceId, rejected, actorId, { connectionId })
    await notifyQualityRisk(workspaceId, atRisk, actorId)

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
    const credentials = await metaCredentials(
      connection.value,
      'Criação de templates está disponível apenas para conexões Meta',
    )
    if (!credentials.ok) return credentials

    const handle = await uploadHeaderSample(
      workspaceId,
      credentials.value.accessToken,
      input,
    )
    if (!handle.ok) return handle
    const components = buildComponents(input, handle.value)

    let created: Awaited<ReturnType<typeof createMetaTemplate>>
    try {
      created = await createMetaTemplate({
        ...credentials.value,
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

    const mediaHeader = handle.value !== null
    const saved = await WhatsAppTemplateRepository.upsertSynced({
      workspaceId,
      connectionId: input.connectionId,
      name: input.name,
      language: input.language,
      category: input.category,
      status: STATUS_MAP[created.status] ?? 'PENDING',
      components: components as never,
      headerFormat: headerFormatOf(components),
      headerMediaUrl: mediaHeader ? (input.headerMediaUrl ?? null) : null,
      ...(input.buttons && input.buttons.length > 0
        ? { buttons: input.buttons as Prisma.InputJsonValue }
        : {}),
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_template',
      action: 'create',
      actorId,
      targetId: saved.value.id,
      meta: {
        name: input.name,
        category: input.category,
        headerFormat: saved.value.headerFormat,
        buttons: input.buttons?.length ?? 0,
      },
    })

    return ok(toWhatsAppTemplateDTO(saved.value))
  },

  /**
   * Configures the click actions of a template's reply buttons (also on a
   * template synced from Meta). The buttons themselves are fixed by the
   * approval: same types, labels and links, in the same order.
   */
  async updateButtons(
    actorId: string,
    workspaceId: string,
    templateId: string,
    input: UpdateWhatsAppTemplateButtonsInput,
  ): Promise<Result<WhatsAppTemplateDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'message-templates', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const template = await WhatsAppTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!template.ok) return template
    if (!template.value) return err(whatsappTemplateNotFound())

    if (!sameButtonShape(templateButtons(template.value), input.buttons)) {
      return err(
        validationError(
          'Os botões precisam ser os mesmos do template aprovado — só as ações podem mudar',
        ),
      )
    }

    const updated = await WhatsAppTemplateRepository.update(templateId, {
      buttons: input.buttons as Prisma.InputJsonValue,
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_template',
      action: 'update',
      actorId,
      targetId: templateId,
      meta: {
        buttons: input.buttons.length,
        actions: input.buttons.reduce(
          (sum, button) =>
            sum + (button.type === 'REPLY' ? button.actions.length : 0),
          0,
        ),
      },
    })

    return ok(toWhatsAppTemplateDTO(updated.value))
  },

  /**
   * Meta webhook `message_template_status_update` /
   * `message_template_quality_update` (system flow — the WABA id identifies
   * the connections). Unknown templates are ignored until the next sync.
   */
  async applyWebhookUpdate(
    input: MetaTemplateWebhookInput,
  ): Promise<Result<{ updated: number }>> {
    const name = input.value.message_template_name
    const language = input.value.message_template_language
    if (!name || !language) return ok({ updated: 0 })

    const connections = await WhatsAppConnectionRepository.listByMetaWabaId(
      input.wabaId,
    )
    if (!connections.ok) return connections

    let updated = 0
    for (const connection of connections.value) {
      const found = await WhatsAppTemplateRepository.findByConnectionAndName(
        connection.id,
        name,
        language,
      )
      if (!found.ok) return found
      const template = found.value
      if (!template) continue

      let data: Prisma.WhatsAppTemplateUpdateInput
      if (input.field === 'message_template_status_update') {
        const status = STATUS_MAP[input.value.event?.toUpperCase() ?? '']
        if (!status) continue
        data = { status, statusReason: cleanReason(input.value.reason) }
      } else {
        data = {
          quality: mapQuality(input.value.new_quality_score),
          qualityUpdatedAt: new Date(),
        }
      }

      const saved = await WhatsAppTemplateRepository.update(template.id, data)
      if (!saved.ok) return saved
      updated++

      logger.info('whatsapp.template.webhook_update', {
        workspaceId: template.workspaceId,
        templateId: template.id,
        field: input.field,
        status: saved.value.status,
        quality: saved.value.quality,
      })

      // Notices only for the zap's templates (ServiceDesk has its own UI).
      if (connection.module !== 'COMMUNICATION') continue
      if (saved.value.status === 'REJECTED' && template.status !== 'REJECTED') {
        await notifyRejected(template.workspaceId, [label(template)], null, {
          templateId: template.id,
        })
      }
      if (
        isAtRisk(saved.value.status, saved.value.quality) &&
        !isAtRisk(template.status, template.quality)
      ) {
        await notifyQualityRisk(template.workspaceId, [label(template)], null)
      }
    }

    return ok({ updated })
  },
}

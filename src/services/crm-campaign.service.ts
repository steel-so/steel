import type { CrmCampaign, CrmLeadStage, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  crmCampaignIncomplete,
  crmCampaignLocked,
  crmCampaignNoRecipients,
  crmCampaignWhatsappUnavailable,
  validationError,
} from '@/src/errors'
import { emailChecklist } from '@/src/lib/canvas-email/checklist'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import { buildCampaignAudience } from '@/src/lib/crm-campaign/audience'
import {
  buildDestinationUrl,
  slugifyCampaignName,
} from '@/src/lib/crm-campaign/campaign-url'
import { renderCampaignEmail } from '@/src/lib/crm-campaign/email-renderer'
import { toCampaignWaId } from '@/src/lib/crm-campaign/phone'
import { publishedSitePages } from '@/src/lib/crm-campaign/site-destination'
import {
  templateBlockedReason,
  templateFields,
  validateCampaignWhatsApp,
} from '@/src/lib/crm-campaign/whatsapp-rules'
import { sendEmail } from '@/src/lib/mail/send'
import { err, ok, type Result } from '@/src/lib/result'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import { parseSiteSnapshot } from '@/src/lib/sites/snapshot'
import { parseStoredButtons } from '@/src/lib/whatsapp/buttons'
import {
  templateButtons,
  templateHeaderMedia,
} from '@/src/lib/whatsapp/template-send'
import {
  toCrmCampaignAudienceDTO,
  toCrmCampaignDTO,
  toCrmCampaignKpisDTO,
  toCrmCampaignLinks,
  toCrmCampaignRecipientDTO,
  toCrmCampaignStatsDTO,
} from '@/src/mappers/crm-campaign.mapper'
import {
  CrmCampaignConversionRepository,
  CrmCampaignRecipientRepository,
  CrmCampaignRepository,
} from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignAudienceRepository } from '@/src/repositories/crm-campaign-audience.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import type {
  ControlCrmCampaignDTO,
  CreateCrmCampaignDTO,
  CrmCampaignAudience,
  CrmCampaignAudiencePreviewInput,
  CrmCampaignTestSendDTO,
  CrmCampaignWhatsAppVariables,
  ListCrmCampaignRecipientsQuery,
  UpdateCrmCampaignDTO,
} from '@/src/schemas/crm-campaign.schema'
import type {
  CrmCampaignAudiencePreviewDTO,
  CrmCampaignChecklistItemDTO,
  CrmCampaignDetailDTO,
  CrmCampaignDTO,
  CrmCampaignEmailPreviewDTO,
  CrmCampaignFormEmbedDTO,
  CrmCampaignIssueDTO,
  CrmCampaignListItemDTO,
  CrmCampaignOptionsDTO,
  CrmCampaignRecipientPageDTO,
  CrmCampaignStatsDTO,
  CrmCampaignTemplateButtonDTO,
  CrmCampaignTestSendResultDTO,
} from '@/types/crm-campaign'
import { assertModuleEnabled, assertModuleMember } from './authz'
import {
  resolveCampaignDestination,
  siteDestination,
} from './crm-campaign-destination'
import {
  buildCampaignEmail,
  CrmCampaignSendService,
  sendCampaignWhatsApp,
} from './crm-campaign-send.service'

type Action = 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE'

function authorize(actorId: string, workspaceId: string, action: Action) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'email',
    action,
  })
}

const RECENT_CONVERSIONS = 50

async function toDetail(
  campaign: CrmCampaign,
): Promise<Result<CrmCampaignDetailDTO>> {
  const destination = await resolveCampaignDestination(campaign)
  if (!destination.ok) return destination
  const checklist = await emailChecklistOf(campaign)
  if (!checklist.ok) return checklist
  const issues = await computeCampaignIssues(campaign)
  if (!issues.ok) return issues
  return ok({
    ...toCrmCampaignDTO(
      campaign,
      toCrmCampaignLinks(
        campaign,
        BETTER_AUTH_URL,
        destination.value?.ref ?? null,
      ),
      destination.value?.summary ?? null,
    ),
    issues: issues.value,
    emailChecklist: checklist.value,
  })
}

/**
 * Pre-send checklist of the chosen e-mail template (`emailChecklist`, the
 * editor's own list) with the campaign's subject and preheader, which win
 * over the template's. Free-HTML templates have no document to check.
 */
export async function emailChecklistOf(
  campaign: CrmCampaign,
): Promise<Result<CrmCampaignChecklistItemDTO[]>> {
  if (!campaign.emailTemplateId) return ok([])
  const template = await CrmCampaignLookupRepository.findEmailTemplateContent(
    campaign.workspaceId,
    campaign.emailTemplateId,
  )
  if (!template.ok) return template
  const doc =
    template.value?.kind === 'BUILDER'
      ? openEmailDocument(template.value.builderDocument)
      : null
  if (!template.value || !doc) return ok([])
  return ok(
    emailChecklist({
      doc,
      subject: campaign.emailSubject || template.value.subject,
    })
      // The campaign asks for its own subject; its preheader replaces the
      // template's.
      .filter(
        (item) =>
          item.code !== 'SUBJECT_EMPTY' &&
          !(item.code === 'PREHEADER_EMPTY' && campaign.emailPreheader),
      )
      .map((item) => ({ level: item.level, message: item.message })),
  )
}

/** Comunicação is usable by campaigns: module on + a live connection. */
async function whatsappAvailability(
  workspaceId: string,
): Promise<Result<{ available: boolean; reason: string | null }>> {
  const enabled = await assertModuleEnabled(workspaceId, 'COMMUNICATION')
  if (!enabled.ok) {
    return enabled.error.code === 'MODULE_DISABLED'
      ? ok({
          available: false,
          reason: 'O módulo Comunicação não está ativo neste workspace',
        })
      : enabled
  }
  return ok({ available: true, reason: null })
}

/**
 * What still blocks the launch, per wizard step (pt-BR). Pure reads — the
 * UI shows the same list on the review step.
 */
export async function computeCampaignIssues(
  campaign: CrmCampaign,
): Promise<Result<CrmCampaignIssueDTO[]>> {
  const issues: CrmCampaignIssueDTO[] = []

  // Destino
  if (!campaign.destinationType) {
    issues.push({
      step: 'destination',
      message: 'Escolha o site, o formulário ou a landing page de destino',
    })
  } else {
    const destination = await resolveCampaignDestination(campaign)
    if (!destination.ok) return destination
    if (!destination.value) {
      issues.push({
        step: 'destination',
        message: MISSING_DESTINATION[campaign.destinationType],
      })
    } else if (destination.value.issue) {
      issues.push({ step: 'destination', message: destination.value.issue })
    }
  }

  // Conteúdo — e-mail
  if (!campaign.emailFrom) {
    issues.push({ step: 'content', message: 'Informe o remetente do e-mail' })
  }
  if (!campaign.emailSubject) {
    issues.push({ step: 'content', message: 'Informe o assunto do e-mail' })
  }
  if (!campaign.emailTemplateId) {
    issues.push({ step: 'content', message: 'Escolha o visual do e-mail' })
  } else {
    const template = await CrmCampaignLookupRepository.findEmailTemplate(
      campaign.workspaceId,
      campaign.emailTemplateId,
    )
    if (!template.ok) return template
    if (!template.value) {
      issues.push({
        step: 'content',
        message: 'O visual escolhido não existe mais',
      })
    } else {
      // Hard errors of the e-mail checklist block the launch.
      const checklist = await emailChecklistOf(campaign)
      if (!checklist.ok) return checklist
      for (const item of checklist.value) {
        if (item.level === 'error') {
          issues.push({ step: 'content', message: `E-mail: ${item.message}` })
        }
      }
    }
  }

  // Conteúdo — WhatsApp (opcional)
  if (campaign.whatsappEnabled) {
    const whatsapp = await whatsappIssues(campaign)
    if (!whatsapp.ok) return whatsapp
    issues.push(
      ...whatsapp.value.map((message) => ({
        step: 'content' as const,
        message,
      })),
    )
  }

  // Público
  const audience = toCrmCampaignAudienceDTO(campaign.audience)
  if (
    audience.mailingListIds.length === 0 &&
    !audience.allPeople &&
    audience.leadStages.length === 0
  ) {
    issues.push({ step: 'audience', message: 'Escolha quem recebe a campanha' })
  }
  if (!campaign.emailLegalBasis) {
    issues.push({
      step: 'audience',
      message: 'Informe a base legal (LGPD) do envio por e-mail',
    })
  }
  if (campaign.whatsappEnabled && !campaign.whatsappLegalBasis) {
    issues.push({
      step: 'audience',
      message: 'Informe a base legal (LGPD) do envio por WhatsApp',
    })
  }

  return ok(issues)
}

async function whatsappIssues(
  campaign: CrmCampaign,
): Promise<Result<string[]>> {
  const availability = await whatsappAvailability(campaign.workspaceId)
  if (!availability.ok) return availability
  if (!availability.value.available) {
    return ok([availability.value.reason as string])
  }
  if (!campaign.whatsappConnectionId) {
    return ok(['Escolha a conexão de WhatsApp'])
  }
  const connection = await CrmCampaignLookupRepository.findConnection(
    campaign.workspaceId,
    campaign.whatsappConnectionId,
  )
  if (!connection.ok) return connection
  if (connection.value?.status !== 'CONNECTED') {
    return ok(['A conexão de WhatsApp escolhida não está conectada'])
  }
  let template: {
    status: string
    components: unknown
    quality: string
    statusReason: string | null
  } | null = null
  if (connection.value.provider === 'META' && campaign.whatsappTemplateId) {
    const found = await CrmCampaignLookupRepository.findWhatsAppTemplate(
      campaign.workspaceId,
      connection.value.id,
      campaign.whatsappTemplateId,
    )
    if (!found.ok) return found
    template = found.value
  }
  let quickReply:
    | { buttons: { type: string; url?: string }[] }
    | null
    | undefined
  if (connection.value.provider === 'ZAPI' && campaign.whatsappQuickReplyId) {
    const found = await CrmCampaignLookupRepository.findQuickReply(
      campaign.workspaceId,
      campaign.whatsappQuickReplyId,
    )
    if (!found.ok) return found
    quickReply = found.value
      ? { buttons: parseStoredButtons(found.value.buttons) }
      : null
  }
  return ok(
    validateCampaignWhatsApp({
      provider: connection.value.provider,
      template,
      quickReply,
      variables:
        (campaign.whatsappVariables as CrmCampaignWhatsAppVariables | null) ??
        null,
      text: campaign.whatsappText,
      mediaUrl: campaign.whatsappMediaUrl,
    }),
  )
}

async function resolveAudience(
  workspaceId: string,
  audience: CrmCampaignAudience,
  whatsappEnabled: boolean,
) {
  const candidates = await CrmCampaignAudienceRepository.collectCandidates(
    workspaceId,
    {
      mailingListIds: audience.mailingListIds,
      allPeople: audience.allPeople,
      leadStages: audience.leadStages as CrmLeadStage[],
    },
  )
  if (!candidates.ok) return candidates
  const emailOptOuts =
    await CrmCampaignAudienceRepository.emailOptOuts(workspaceId)
  if (!emailOptOuts.ok) return emailOptOuts
  const waOptOuts = whatsappEnabled
    ? await CrmCampaignAudienceRepository.whatsappOptOuts(workspaceId)
    : ok(new Set<string>())
  if (!waOptOuts.ok) return waOptOuts
  return ok(
    buildCampaignAudience(
      candidates.value,
      { ...emailOptOuts.value, waIds: waOptOuts.value },
      { whatsappEnabled },
    ),
  )
}

async function uniqueSlug(
  workspaceId: string,
  name: string,
): Promise<Result<string>> {
  const base = slugifyCampaignName(name)
  const taken = await CrmCampaignRepository.listSlugsLike(workspaceId, base)
  if (!taken.ok) return taken
  const used = new Set(taken.value)
  if (!used.has(base)) return ok(base)
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return ok(`${base}-${n}`)
}

/** Checks that every referenced record belongs to the workspace. */
async function validateReferences(
  workspaceId: string,
  dto: UpdateCrmCampaignDTO,
  current: CrmCampaign,
): Promise<Result<void>> {
  const invalid = (message: string) => err(validationError(message))

  if (dto.landingPageId) {
    const page = await CrmCampaignLookupRepository.findLandingPage(
      workspaceId,
      dto.landingPageId,
    )
    if (!page.ok) return page
    if (!page.value) return invalid('Landing page não encontrada')
  }
  if (dto.formId) {
    const form = await CrmCampaignLookupRepository.findForm(
      workspaceId,
      dto.formId,
    )
    if (!form.ok) return form
    if (!form.value) return invalid('Formulário não encontrado')
  }
  const siteId = dto.siteId === undefined ? current.siteId : dto.siteId
  if (dto.siteId || dto.sitePageId) {
    if (!siteId) return invalid('Escolha o site antes da página')
    const site = await CrmCampaignLookupRepository.findSite(workspaceId, siteId)
    if (!site.ok) return site
    if (!site.value) return invalid('Site não encontrado')
    const pageId =
      dto.sitePageId === undefined ? current.sitePageId : dto.sitePageId
    if (pageId && !site.value.pages.some((page) => page.id === pageId)) {
      return invalid('Página do site não encontrada')
    }
  }
  if (dto.whatsappQuickReplyId) {
    const reply = await CrmCampaignLookupRepository.findQuickReply(
      workspaceId,
      dto.whatsappQuickReplyId,
    )
    if (!reply.ok) return reply
    if (!reply.value) return invalid('Resposta rápida não encontrada')
  }
  if (dto.emailTemplateId) {
    const template = await CrmCampaignLookupRepository.findEmailTemplate(
      workspaceId,
      dto.emailTemplateId,
    )
    if (!template.ok) return template
    if (!template.value) return invalid('Visual de e-mail não encontrado')
  }
  if (dto.audience) {
    const lists = await CrmCampaignLookupRepository.mailingListsExist(
      workspaceId,
      dto.audience.mailingListIds,
    )
    if (!lists.ok) return lists
    if (!lists.value) return invalid('Lista de e-mail não encontrada')
  }
  const connectionId =
    dto.whatsappConnectionId === undefined
      ? current.whatsappConnectionId
      : dto.whatsappConnectionId
  if (dto.whatsappConnectionId) {
    const connection = await CrmCampaignLookupRepository.findConnection(
      workspaceId,
      dto.whatsappConnectionId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return invalid('Conexão de WhatsApp não encontrada')
  }
  if (dto.whatsappTemplateId) {
    if (!connectionId) return invalid('Escolha a conexão antes do template')
    const template = await CrmCampaignLookupRepository.findWhatsAppTemplate(
      workspaceId,
      connectionId,
      dto.whatsappTemplateId,
    )
    if (!template.ok) return template
    if (!template.value) return invalid('Template de WhatsApp não encontrado')
  }
  return ok(undefined)
}

function toUpdateData(
  dto: UpdateCrmCampaignDTO,
  actorId: string,
): Prisma.CrmCampaignUncheckedUpdateInput {
  const { whatsappVariables, audience, ...rest } = dto
  const data: Prisma.CrmCampaignUncheckedUpdateInput = {
    ...rest,
    updatedById: actorId,
  }
  if (audience !== undefined) data.audience = audience
  if (whatsappVariables !== undefined) {
    data.whatsappVariables =
      whatsappVariables === null
        ? (null as unknown as Prisma.InputJsonValue)
        : whatsappVariables
  }
  // One destination at a time: picking a type clears the other ids.
  const clear = (keep: 'LANDING_PAGE' | 'FORM' | 'SITE_PAGE' | null) => {
    if (keep !== 'LANDING_PAGE') data.landingPageId = null
    if (keep !== 'FORM') data.formId = null
    if (keep !== 'SITE_PAGE') {
      data.siteId = null
      data.sitePageId = null
    }
  }
  if (dto.destinationType !== undefined) clear(dto.destinationType)
  // Another site: its pages are not the old site's.
  if (dto.siteId !== undefined && dto.sitePageId === undefined) {
    data.sitePageId = null
  }
  return data
}

const MISSING_DESTINATION: Record<
  'LANDING_PAGE' | 'FORM' | 'SITE_PAGE',
  string
> = {
  LANDING_PAGE: 'Escolha a landing page de destino',
  FORM: 'Escolha o formulário de destino',
  SITE_PAGE: 'Escolha o site e a página de destino',
}

/** A WhatsApp button as the wizard shows it. */
function toButtonOption(
  button: ReturnType<typeof parseStoredButtons>[number],
): CrmCampaignTemplateButtonDTO {
  return button.type === 'URL'
    ? {
        type: 'URL',
        label: button.label,
        url: button.url,
        dynamic: /\{\{\s*1\s*\}\}|\{link\}/.test(button.url),
        actionCount: 0,
      }
    : {
        type: 'REPLY',
        label: button.label,
        url: null,
        dynamic: false,
        actionCount: button.actions.length,
      }
}

export const CrmCampaignService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmCampaignListItemDTO[]>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaigns = await CrmCampaignRepository.listByWorkspace(workspaceId)
    if (!campaigns.ok) return campaigns

    const funnel = await CrmCampaignRepository.funnel(
      campaigns.value.map((c) => c.id),
    )
    if (!funnel.ok) return funnel
    const sites = await CrmCampaignLookupRepository.findSites(workspaceId, [
      ...new Set(
        campaigns.value.flatMap((c) =>
          c.destinationType === 'SITE_PAGE' && c.siteId ? [c.siteId] : [],
        ),
      ),
    ])
    if (!sites.ok) return sites
    const siteById = new Map(sites.value.map((site) => [site.id, site]))
    const tokens = await CrmCampaignLookupRepository.destinationTokens(
      workspaceId,
      {
        landingPageIds: campaigns.value.flatMap((c) =>
          c.landingPageId ? [c.landingPageId] : [],
        ),
        formIds: campaigns.value.flatMap((c) => (c.formId ? [c.formId] : [])),
      },
    )
    if (!tokens.ok) return tokens

    return ok(
      campaigns.value.map((campaign) => {
        const site =
          campaign.destinationType === 'SITE_PAGE' && campaign.siteId
            ? siteById.get(campaign.siteId)
            : undefined
        const onSite = site ? siteDestination(site, campaign.sitePageId) : null
        const destinationId =
          campaign.destinationType === 'FORM'
            ? campaign.formId
            : campaign.landingPageId
        return {
          ...toCrmCampaignDTO(
            campaign,
            toCrmCampaignLinks(
              campaign,
              BETTER_AUTH_URL,
              campaign.destinationType === 'SITE_PAGE'
                ? (onSite?.ref ?? null)
                : (destinationId && tokens.value.get(destinationId)) || null,
            ),
            onSite?.summary ?? null,
          ),
          kpis: toCrmCampaignKpisDTO(funnel.value.get(campaign.id)),
        }
      }),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    campaignId: string,
  ): Promise<Result<CrmCampaignDetailDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaign = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign
    return toDetail(campaign.value)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmCampaignDTO,
  ): Promise<Result<CrmCampaignDetailDTO>> {
    const membership = await authorize(actorId, workspaceId, 'CREATE')
    if (!membership.ok) return membership

    const slug = await uniqueSlug(workspaceId, dto.name)
    if (!slug.ok) return slug

    const created = await CrmCampaignRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      slug: slug.value,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'crm_campaign',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId },
    })
    return toDetail(created.value)
  },

  async update(
    actorId: string,
    workspaceId: string,
    campaignId: string,
    dto: UpdateCrmCampaignDTO,
  ): Promise<Result<CrmCampaignDetailDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (existing.value.status !== 'DRAFT') return err(crmCampaignLocked())

    // WhatsApp is an add-on: it can only be switched on with Comunicação.
    if (dto.whatsappEnabled === true && !existing.value.whatsappEnabled) {
      const availability = await whatsappAvailability(workspaceId)
      if (!availability.ok) return availability
      if (!availability.value.available) {
        return err(
          crmCampaignWhatsappUnavailable(availability.value.reason as string),
        )
      }
    }

    const references = await validateReferences(
      workspaceId,
      dto,
      existing.value,
    )
    if (!references.ok) return references

    const updated = await CrmCampaignRepository.update(
      campaignId,
      toUpdateData(dto, actorId),
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_campaign',
      action: 'update',
      actorId,
      targetId: campaignId,
      meta: { fields: Object.keys(dto) },
    })
    return toDetail(updated.value)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    campaignId: string,
  ): Promise<Result<void>> {
    const membership = await authorize(actorId, workspaceId, 'DELETE')
    if (!membership.ok) return membership

    const existing = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (['SCHEDULED', 'SENDING', 'PAUSED'].includes(existing.value.status)) {
      return err(crmCampaignLocked('Cancele a campanha antes de excluí-la'))
    }

    const deleted = await CrmCampaignRepository.softDelete(campaignId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'crm_campaign',
      action: 'delete',
      actorId,
      targetId: campaignId,
    })
    return ok(undefined)
  },

  async options(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmCampaignOptionsDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const options = await CrmCampaignLookupRepository.listOptions(workspaceId)
    if (!options.ok) return options
    const availability = await whatsappAvailability(workspaceId)
    if (!availability.ok) return availability

    const connections = availability.value.available
      ? options.value.connections
      : []
    const reason = !availability.value.available
      ? availability.value.reason
      : connections.length === 0
        ? 'Nenhuma conexão de WhatsApp ativa na Comunicação'
        : null

    const sites = options.value.sites.map((site) => {
      const snapshot = site.snapshot ? parseSiteSnapshot(site.snapshot) : null
      const baseUrl = publicSiteUrl(site.slug)
      return {
        site,
        baseUrl,
        pages: snapshot?.ok ? publishedSitePages(snapshot.value, baseUrl) : [],
      }
    })
    const embedsByToken = new Map<string, CrmCampaignFormEmbedDTO[]>()
    for (const { site, pages } of sites) {
      for (const page of pages) {
        for (const token of page.formTokens) {
          const list = embedsByToken.get(token) ?? []
          list.push({
            siteId: site.id,
            siteName: site.name,
            pageId: page.id,
            pageTitle: page.title,
            url: page.url,
          })
          embedsByToken.set(token, list)
        }
      }
    }

    return ok({
      baseUrl: BETTER_AUTH_URL,
      sites: sites.map(({ site, baseUrl, pages }) => ({
        id: site.id,
        name: site.name,
        slug: site.slug,
        url: baseUrl,
        published: pages.length > 0,
        updatedAt: site.updatedAt.toISOString(),
        pages: pages.map(({ formTokens: _tokens, ...page }) => page),
      })),
      // Migrated landing pages live on as sites (a draft still pointing to
      // one shows it from its own `destination` summary).
      landingPages: options.value.landingPages
        .filter((page) => page.migratedSiteId === null)
        .map((page) => ({
          id: page.id,
          title: page.title,
          published: page.status === 'PUBLISHED',
          shareToken: page.shareToken,
        })),
      forms: options.value.forms.map((form) => ({
        id: form.id,
        name: form.name,
        published: form.status === 'PUBLISHED',
        publicToken: form.publicToken,
        url: buildDestinationUrl(BETTER_AUTH_URL, {
          type: 'FORM',
          token: form.publicToken,
        }),
        embeds: embedsByToken.get(form.publicToken) ?? [],
      })),
      emailTemplates: options.value.emailTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        subject: template.subject,
        editor: template.canvas
          ? ('v2' as const)
          : template.kind === 'BUILDER'
            ? ('v1' as const)
            : ('html' as const),
        updatedAt: template.updatedAt.toISOString(),
      })),
      mailingLists: options.value.mailingLists,
      whatsapp: {
        available: reason === null,
        reason,
        connections: connections.map((connection) => ({
          id: connection.id,
          label: connection.label,
          provider: connection.provider,
          phoneNumber: connection.phoneNumber,
          templates:
            connection.provider === 'META'
              ? connection.templates.map((template) => {
                  const fields = templateFields(template.components)
                  return {
                    id: template.id,
                    name: template.name,
                    language: template.language,
                    category: template.category,
                    status: template.status as
                      | 'APPROVED'
                      | 'PAUSED'
                      | 'DISABLED',
                    quality: template.quality,
                    headerFormat: template.headerFormat,
                    headerMediaUrl: templateHeaderMedia(template)?.url ?? null,
                    buttons: templateButtons(template).map(toButtonOption),
                    blockedReason: templateBlockedReason(template),
                    fields: {
                      headerVariables: fields.header.variableCount,
                      bodyVariables: fields.body.variableCount,
                      bodyText: fields.body.text,
                      urlButtons: fields.urlButtonVariables,
                    },
                  }
                })
              : [],
        })),
        quickReplies: connections.some((c) => c.provider === 'ZAPI')
          ? options.value.quickReplies.map((reply) => ({
              id: reply.id,
              shortcut: reply.shortcut,
              title: reply.title,
              body: reply.body,
              mediaUrl: reply.mediaUrl,
              buttons: parseStoredButtons(reply.buttons).map(toButtonOption),
            }))
          : [],
      },
    })
  },

  async audiencePreview(
    actorId: string,
    workspaceId: string,
    input: CrmCampaignAudiencePreviewInput,
  ): Promise<Result<CrmCampaignAudiencePreviewDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const audience = await resolveAudience(
      workspaceId,
      input.audience,
      input.whatsappEnabled,
    )
    if (!audience.ok) return audience
    return ok(audience.value.counts)
  },

  async previewEmail(
    actorId: string,
    workspaceId: string,
    campaignId: string,
  ): Promise<Result<CrmCampaignEmailPreviewDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaign = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign
    if (!campaign.value.emailTemplateId) {
      return err(validationError('Escolha o visual do e-mail'))
    }
    const detail = await toDetail(campaign.value)
    if (!detail.ok) return detail

    const rendered = await renderCampaignEmail(campaign.value.emailTemplateId, {
      workspaceId,
      name: 'Maria Silva',
      email: 'maria@exemplo.com.br',
      campaignLink: detail.value.links.email ?? BETTER_AUTH_URL,
    })
    if (!rendered.ok) return rendered
    return ok({
      ...rendered.value,
      subject: campaign.value.emailSubject || rendered.value.subject,
    })
  },

  async testSend(
    actorId: string,
    workspaceId: string,
    campaignId: string,
    dto: CrmCampaignTestSendDTO,
  ): Promise<Result<CrmCampaignTestSendResultDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign
    const detail = await toDetail(campaign.value)
    if (!detail.ok) return detail

    const result: CrmCampaignTestSendResultDTO = {
      email: null,
      whatsapp: null,
      errors: [],
    }
    const contactName = 'Contato de teste'

    if (dto.email) {
      if (!campaign.value.emailTemplateId || !campaign.value.emailFrom) {
        result.email = 'failed'
        result.errors.push('Complete remetente e visual do e-mail')
      } else {
        const email = await buildCampaignEmail(campaign.value, {
          name: contactName,
          email: dto.email,
          link: detail.value.links.email ?? BETTER_AUTH_URL,
          openPixelUrl: null,
          unsubscribePageUrl: null,
        })
        if (!email.ok) {
          result.email = 'failed'
          result.errors.push(email.error.message)
        } else {
          try {
            await sendEmail({
              from: campaign.value.emailFrom,
              to: dto.email,
              subject: `[Teste] ${email.value.subject}`,
              html: email.value.html,
              text: email.value.text,
            })
            result.email = 'sent'
          } catch (error) {
            result.email = 'failed'
            result.errors.push(
              error instanceof Error ? error.message : 'Falha ao enviar',
            )
          }
        }
      }
    }

    if (dto.phone) {
      const waId = toCampaignWaId(dto.phone)
      const problems = campaign.value.whatsappEnabled
        ? await whatsappIssues(campaign.value)
        : ok(['Ative o WhatsApp na campanha para testar'])
      if (!problems.ok) return problems
      if (!waId) {
        result.whatsapp = 'failed'
        result.errors.push('Número de WhatsApp inválido')
      } else if (problems.value.length > 0) {
        result.whatsapp = 'failed'
        result.errors.push(...problems.value)
      } else {
        const sent = await sendCampaignWhatsApp(campaign.value, {
          waId,
          name: contactName,
          link: detail.value.links.whatsapp ?? BETTER_AUTH_URL,
          linkCode: 'teste',
        })
        result.whatsapp = sent.ok ? 'sent' : 'failed'
        if (!sent.ok) result.errors.push(sent.error.message)
      }
    }

    auditMutation({
      entity: 'crm_campaign',
      action: 'test',
      actorId,
      targetId: campaignId,
      meta: { email: result.email, whatsapp: result.whatsapp },
    })
    return ok(result)
  },

  async launch(
    actorId: string,
    workspaceId: string,
    campaignId: string,
    now: Date = new Date(),
  ): Promise<Result<CrmCampaignDetailDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign
    if (campaign.value.status !== 'DRAFT') return err(crmCampaignLocked())

    const issues = await computeCampaignIssues(campaign.value)
    if (!issues.ok) return issues
    if (issues.value.length > 0) {
      return err(crmCampaignIncomplete(issues.value))
    }

    const audience = await resolveAudience(
      workspaceId,
      toCrmCampaignAudienceDTO(campaign.value.audience) as CrmCampaignAudience,
      campaign.value.whatsappEnabled,
    )
    if (!audience.ok) return audience
    const { rows, counts } = audience.value
    if (counts.email.reachable + counts.whatsapp.reachable === 0) {
      auditMutation({
        entity: 'crm_campaign',
        action: 'start',
        actorId,
        targetId: campaignId,
        outcome: 'failure',
        reason: 'CRM_CAMPAIGN_NO_RECIPIENTS',
      })
      return err(crmCampaignNoRecipients())
    }

    const scheduled =
      campaign.value.scheduledAt && campaign.value.scheduledAt > now
        ? campaign.value.scheduledAt
        : null
    const launched = await CrmCampaignRepository.transition(
      campaignId,
      ['DRAFT'],
      {
        status: scheduled ? 'SCHEDULED' : 'SENDING',
        launchedAt: now,
        startAt: scheduled ?? now,
        consentConfirmedAt: now,
        consentConfirmedById: actorId,
        updatedById: actorId,
      },
    )
    if (!launched.ok) return launched
    if (!launched.value) return err(crmCampaignLocked())

    const created = await CrmCampaignRecipientRepository.createMany(
      campaignId,
      workspaceId,
      rows.map((row) => ({
        personId: row.personId,
        leadId: row.leadId,
        name: row.name,
        email: row.email,
        waId: row.waId,
        emailStatus: row.emailState.status,
        emailSkipReason: row.emailState.skipReason,
        whatsappStatus: row.whatsappState.status,
        whatsappSkipReason: row.whatsappState.skipReason,
      })),
    )
    if (!created.ok) {
      // Back to draft: a launched campaign without its snapshot is useless.
      await CrmCampaignRepository.transition(
        campaignId,
        ['SCHEDULED', 'SENDING'],
        { status: 'DRAFT', launchedAt: null, startAt: null },
      )
      return created
    }

    await CrmCampaignSendService.enqueueDispatch(launched.value, now)

    auditMutation({
      entity: 'crm_campaign',
      action: 'start',
      actorId,
      targetId: campaignId,
      meta: {
        workspaceId,
        scheduled: Boolean(scheduled),
        recipients: counts.total,
        emailReachable: counts.email.reachable,
        whatsappReachable: counts.whatsapp.reachable,
        emailLegalBasis: campaign.value.emailLegalBasis,
        whatsappLegalBasis: campaign.value.whatsappLegalBasis,
      },
    })
    logger.info('crm.campaign.launched', {
      component: 'CrmCampaignService',
      campaignId,
      workspaceId,
      recipients: counts.total,
    })
    return toDetail(launched.value)
  },

  async control(
    actorId: string,
    workspaceId: string,
    campaignId: string,
    dto: ControlCrmCampaignDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmCampaignDetailDTO>> {
    const membership = await authorize(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const campaign = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign

    let updated: Result<CrmCampaign | null>
    if (dto.action === 'pause') {
      updated = await CrmCampaignRepository.transition(
        campaignId,
        ['SCHEDULED', 'SENDING'],
        { status: 'PAUSED', updatedById: actorId },
      )
    } else if (dto.action === 'resume') {
      const due = !campaign.value.startAt || campaign.value.startAt <= now
      updated = await CrmCampaignRepository.transition(campaignId, ['PAUSED'], {
        status: due ? 'SENDING' : 'SCHEDULED',
        updatedById: actorId,
      })
    } else {
      updated = await CrmCampaignRepository.transition(
        campaignId,
        ['SCHEDULED', 'SENDING', 'PAUSED'],
        { status: 'CANCELED', completedAt: now, updatedById: actorId },
      )
    }
    if (!updated.ok) return updated
    if (!updated.value) {
      return err(
        crmCampaignLocked(
          'Esta ação não vale para a situação atual da campanha',
        ),
      )
    }

    if (dto.action === 'cancel') {
      const skipped =
        await CrmCampaignRecipientRepository.skipAllOpen(campaignId)
      if (!skipped.ok) return skipped
    }
    if (dto.action === 'resume') {
      await CrmCampaignSendService.enqueueDispatch(updated.value, now)
    }

    auditMutation({
      entity: 'crm_campaign',
      action:
        dto.action === 'pause'
          ? 'suspend'
          : dto.action === 'resume'
            ? 'reactivate'
            : 'cancel',
      actorId,
      targetId: campaignId,
      meta: { workspaceId, from: campaign.value.status },
    })
    return toDetail(updated.value)
  },

  async stats(
    actorId: string,
    workspaceId: string,
    campaignId: string,
  ): Promise<Result<CrmCampaignStatsDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaign = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign

    const funnel = await CrmCampaignRepository.funnel([campaignId])
    if (!funnel.ok) return funnel
    const counts = await CrmCampaignConversionRepository.countBy(campaignId)
    if (!counts.ok) return counts
    const recent = await CrmCampaignConversionRepository.listRecent(
      campaignId,
      RECENT_CONVERSIONS,
    )
    if (!recent.ok) return recent

    return ok(
      toCrmCampaignStatsDTO(
        funnel.value.get(campaignId) as NonNullable<
          ReturnType<typeof funnel.value.get>
        >,
        counts.value,
        recent.value,
      ),
    )
  },

  async listRecipients(
    actorId: string,
    workspaceId: string,
    campaignId: string,
    query: ListCrmCampaignRecipientsQuery,
  ): Promise<Result<CrmCampaignRecipientPageDTO>> {
    const membership = await authorize(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const campaign = await CrmCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign

    const page = await CrmCampaignRecipientRepository.listPage(
      campaignId,
      query,
    )
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toCrmCampaignRecipientDTO),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },
}

export type { CrmCampaignDTO }

import type { CrmEmailBrand, CrmEmailTemplate } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  crmEmailBuilderStructureLocked,
  crmEmailCanvasHtmlForbidden,
  crmEmailCanvasInvalid,
  mailError,
  notFound,
} from '@/src/errors'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  isEmailCanvasDocument,
  openEmailDocument,
} from '@/src/lib/canvas-email/convert-v1'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import {
  changesHtmlBlocks,
  normalizeEmailDocument,
  productIdsOf,
  validateEmailDocument,
} from '@/src/lib/canvas-email/validate'
import {
  type EmailBrand,
  resolveEmailBrand,
} from '@/src/lib/crm-email-builder/brand'
import { validateLayoutStructure } from '@/src/lib/crm-email-builder/layouts'
import {
  emailHtmlToText,
  personalizeEmail,
  type RenderedEmail,
  renderBuilderEmail,
} from '@/src/lib/crm-email-builder/render'
import { sanitizeRichText } from '@/src/lib/crm-email-builder/rich-text'
import {
  contactToVariables,
  SAMPLE_CONTACT,
  UNSUBSCRIBE_URL,
} from '@/src/lib/crm-email-builder/variables'
import {
  buildCrmUnsubscribeUrls,
  createCrmUnsubscribeToken,
  withCrmUnsubscribeFooter,
} from '@/src/lib/crm-email-unsubscribe'
import { defaultFrom } from '@/src/lib/mail/client'
import { sendEmail } from '@/src/lib/mail/send'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmEmailBrandDTO,
  toCrmEmailLinkTargetsDTO,
  toEmailProductData,
} from '@/src/mappers/crm-email-builder.mapper'
import {
  CrmEmailBuilderRepository,
  type PersonalizationContact,
} from '@/src/repositories/crm-email-builder.repository'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import {
  type CrmEmailBrandInput,
  type EmailBuilderContact,
  type EmailBuilderDocument,
  EmailBuilderDocumentSchema,
  type EmailCanvasDocument,
  type RenderCrmEmailTemplateDTO,
} from '@/src/schemas/crm-email-builder.schema'
import type {
  CrmEmailBrandDTO,
  CrmEmailLinkTargetsDTO,
  CrmEmailRenderDTO,
  CrmEmailTestSendDTO,
} from '@/types/crm-email-marketing'
import { assertModuleMember } from './authz'
import { persistCrmEmailImage } from './media/crm-email-media.service'

/**
 * Visual e-mail builder (CRM): brand, rendering, test sends and the render
 * API used by campaigns. Rendering happens in two steps — the base render
 * keeps `{{variables}}` and is cached per template version + brand; each
 * contact then only gets a string substitution.
 */

const RENDER_CACHE_LIMIT = 200
const renderCache = new Map<string, RenderedEmail>()

/** Test hook: drops the in-process base render cache. */
export function clearEmailRenderCache() {
  renderCache.clear()
}

function remember(key: string, value: RenderedEmail) {
  if (renderCache.size >= RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value
    if (oldest !== undefined) renderCache.delete(oldest)
  }
  renderCache.set(key, value)
}

async function loadBrand(
  workspaceId: string,
): Promise<Result<{ brand: EmailBrand; saved: CrmEmailBrand | null }>> {
  const [saved, workspace] = await Promise.all([
    CrmEmailBuilderRepository.findBrand(workspaceId),
    CrmEmailBuilderRepository.findWorkspaceIdentity(workspaceId),
  ])
  if (!saved.ok) return saved
  if (!workspace.ok) return workspace
  return ok({
    brand: resolveEmailBrand(saved.value, workspace.value),
    saved: saved.value,
  })
}

async function resolveBrand(workspaceId: string): Promise<Result<EmailBrand>> {
  const loaded = await loadBrand(workspaceId)
  if (!loaded.ok) return loaded
  return ok(loaded.value.brand)
}

/** Sanitizes the rich-text fields of a document (stored and rendered). */
function sanitizeDocument(
  document: EmailBuilderDocument,
): EmailBuilderDocument {
  return {
    ...document,
    sections: document.sections.map((section) =>
      section.type === 'hero' || section.type === 'text'
        ? {
            ...section,
            props: {
              ...section.props,
              body: sanitizeRichText(section.props.body),
            },
          }
        : section,
    ),
  } as EmailBuilderDocument
}

export type BuilderTemplateDocument = EmailBuilderDocument | EmailCanvasDocument

export type BuildBuilderContentOptions = {
  /** Workspace OWNER/ADMIN — may add or change HTML blocks (v2). */
  privileged?: boolean
  /** Document stored before this save (v1 or v2), to tell which HTML
   * blocks are new or changed. */
  previous?: unknown
}

/**
 * Validates, sanitizes and renders a document with the workspace brand.
 * Used when a builder template is created or saved. v1 documents keep the
 * locked-layout rules; v2 (Steel Canvas) documents are checked against the
 * e-mail catalog, and only admins may add or change HTML blocks.
 */
export async function buildBuilderTemplateContent(
  workspaceId: string,
  document: BuilderTemplateDocument,
  subject: string,
  options: BuildBuilderContentOptions = {},
): Promise<
  Result<{ document: BuilderTemplateDocument; html: string; text: string }>
> {
  if (isEmailCanvasDocument(document)) {
    return buildCanvasContent(workspaceId, document, subject, options)
  }
  const v1 = document as EmailBuilderDocument
  const violation = validateLayoutStructure(v1)
  if (violation) return err(crmEmailBuilderStructureLocked(violation))

  const brand = await resolveBrand(workspaceId)
  if (!brand.ok) return brand

  const clean = sanitizeDocument(v1)
  const rendered = await renderBuilderEmail(clean, brand.value, { subject })
  return ok({ document: clean, html: rendered.html, text: rendered.text })
}

async function buildCanvasContent(
  workspaceId: string,
  input: unknown,
  subject: string,
  options: BuildBuilderContentOptions,
): Promise<
  Result<{ document: BuilderTemplateDocument; html: string; text: string }>
> {
  const validated = validateEmailDocument(normalizeEmailDocument(input))
  if (!validated.ok) return err(crmEmailCanvasInvalid(validated.error))
  const doc = validated.value

  if (!options.privileged) {
    const before = openEmailDocument(options.previous)
    if (changesHtmlBlocks(before && normalizeEmailDocument(before), doc)) {
      return err(crmEmailCanvasHtmlForbidden())
    }
  }

  const rendered = await renderCanvas(workspaceId, doc, subject)
  if (!rendered.ok) return rendered
  return ok({
    document: doc as unknown as EmailCanvasDocument,
    html: rendered.value.html,
    text: rendered.value.text,
  })
}

/** Brand + CRM products of a v2 document, then the shared render. */
async function renderCanvas(
  workspaceId: string,
  doc: CanvasDocument,
  subject: string,
  cacheKey?: string,
): Promise<Result<RenderedEmail>> {
  const brand = await resolveBrand(workspaceId)
  if (!brand.ok) return brand
  const rows = await CrmEmailBuilderRepository.findProducts(
    workspaceId,
    productIdsOf(doc),
  )
  if (!rows.ok) return rows
  const products = toEmailProductData(rows.value)

  const key = cacheKey
    ? `${cacheKey}:${JSON.stringify(brand.value)}:${JSON.stringify(products)}`
    : null
  const cached = key ? renderCache.get(key) : undefined
  if (cached) return ok(cached)

  const rendered = await renderEmailDocument(doc, {
    brand: brand.value,
    subject,
    products,
  })
  if (key) remember(key, rendered)
  return ok(rendered)
}

/** Base render (variables intact) of any template, cached per version. */
async function renderTemplateBase(
  template: CrmEmailTemplate,
  workspaceId: string,
): Promise<Result<RenderedEmail>> {
  if (template.kind !== 'BUILDER') {
    const html = template.contentHtml.includes(UNSUBSCRIBE_URL)
      ? template.contentHtml
      : withCrmUnsubscribeFooter(template.contentHtml, UNSUBSCRIBE_URL)
    return ok({
      subject: template.subject,
      html,
      text: template.contentText ?? emailHtmlToText(html),
    })
  }

  if (isEmailCanvasDocument(template.builderDocument)) {
    const validated = validateEmailDocument(template.builderDocument)
    if (!validated.ok) {
      logger.warn('crm_email_builder.invalid_canvas_document', {
        component: 'CrmEmailBuilderService',
        templateId: template.id,
        issues: validated.error.slice(0, 5),
      })
      return err(crmEmailCanvasInvalid(validated.error))
    }
    return renderCanvas(
      workspaceId,
      validated.value,
      template.subject,
      `${template.id}:${template.updatedAt.getTime()}`,
    )
  }

  const parsed = EmailBuilderDocumentSchema.safeParse(template.builderDocument)
  if (!parsed.success) {
    logger.warn('crm_email_builder.invalid_document', {
      component: 'CrmEmailBuilderService',
      templateId: template.id,
    })
    return err(
      crmEmailBuilderStructureLocked(
        'O conteúdo salvo deste template é inválido — abra-o no editor e salve de novo',
      ),
    )
  }

  const brand = await resolveBrand(workspaceId)
  if (!brand.ok) return brand

  const key = `${template.id}:${template.updatedAt.getTime()}:${JSON.stringify(brand.value)}`
  const cached = renderCache.get(key)
  if (cached) return ok(cached)

  const rendered = await renderBuilderEmail(
    sanitizeDocument(parsed.data),
    brand.value,
    { subject: template.subject },
  )
  remember(key, rendered)
  return ok(rendered)
}

/** Base render of a template for a campaign snapshot (variables intact). */
export async function renderTemplateForCampaign(
  templateId: string,
  workspaceId: string,
): Promise<Result<RenderedEmail>> {
  const template = await CrmEmailTemplateRepository.findById(
    templateId,
    workspaceId,
  )
  if (!template.ok) return template
  return renderTemplateBase(template.value, workspaceId)
}

export type RenderCampaignEmailOptions = {
  /** Tenant scope — the template must belong to this workspace. */
  workspaceId: string
  /** Tracked campaign URL (UTMs) that replaces `{{campaign_link}}`. */
  campaignLink?: string
  /** `CrmEmailCampaignRecipient.id` → signed unsubscribe link. */
  recipientId?: string
  /** Explicit unsubscribe URL (wins over `recipientId`). */
  unsubscribeUrl?: string
}

function unsubscribeUrlFor(options: {
  recipientId?: string
  unsubscribeUrl?: string
}): string {
  if (options.unsubscribeUrl) return options.unsubscribeUrl
  if (options.recipientId) {
    return buildCrmUnsubscribeUrls(
      BETTER_AUTH_URL,
      createCrmUnsubscribeToken(options.recipientId),
    ).pageUrl
  }
  // Previews and test sends: the generic page answers "link inválido".
  return `${BETTER_AUTH_URL.replace(/\/$/, '')}/unsubscribe/teste`
}

/**
 * Render API for campaigns (e-mail and multichannel flows): the template
 * rendered for one contact, with the campaign link and the unsubscribe
 * link resolved. Always includes the unsubscribe footer (LGPD).
 */
export async function renderCampaignEmail(
  templateId: string,
  contact: EmailBuilderContact,
  options: RenderCampaignEmailOptions,
): Promise<Result<CrmEmailRenderDTO>> {
  const base = await renderTemplateForCampaign(templateId, options.workspaceId)
  if (!base.ok) return base
  return ok(
    personalizeEmail(
      base.value,
      contactToVariables(contact, {
        campaignLink: options.campaignLink,
        unsubscribeUrl: unsubscribeUrlFor(options),
      }),
    ),
  )
}

/** CRM person → contact used by the variables. */
export function personToContact(
  person: PersonalizationContact,
): EmailBuilderContact {
  return {
    email: person.emails[0] ?? '',
    name: person.name,
    company: person.companyName ?? undefined,
    jobTitle: person.jobTitle ?? undefined,
    phone: person.phones[0],
    city: person.city ?? undefined,
  }
}

async function resolveContact(
  workspaceId: string,
  dto: RenderCrmEmailTemplateDTO,
): Promise<Result<EmailBuilderContact>> {
  if (dto.personId) {
    const people = await CrmEmailBuilderRepository.findContacts(workspaceId, [
      dto.personId,
    ])
    if (!people.ok) return people
    const [person] = people.value
    if (!person) return err(notFound('CrmPerson'))
    return ok(personToContact(person))
  }
  return ok(dto.sample ?? SAMPLE_CONTACT)
}

export const CrmEmailBuilderService = {
  async getBrand(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailBrandDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const loaded = await loadBrand(workspaceId)
    if (!loaded.ok) return loaded
    return ok(toCrmEmailBrandDTO(loaded.value.brand, loaded.value.saved))
  },

  async updateBrand(
    actorId: string,
    workspaceId: string,
    input: CrmEmailBrandInput,
  ): Promise<Result<CrmEmailBrandDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const saved = await CrmEmailBuilderRepository.upsertBrand(
      workspaceId,
      input,
      actorId,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'crm_email_brand',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, fields: Object.keys(input) },
    })

    const { companyName, logoUrl, primaryColor, address, website } = saved.value
    return ok(
      toCrmEmailBrandDTO(
        { companyName, logoUrl, primaryColor, address, website },
        saved.value,
      ),
    )
  },

  /** Template rendered for a CRM person or a sample contact (preview). */
  async render(
    actorId: string,
    workspaceId: string,
    templateId: string,
    dto: RenderCrmEmailTemplateDTO,
  ): Promise<Result<CrmEmailRenderDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const contact = await resolveContact(workspaceId, dto)
    if (!contact.ok) return contact

    return renderCampaignEmail(templateId, contact.value, {
      workspaceId,
      campaignLink: dto.campaignLink,
    })
  },

  /** "Enviar teste": the rendered e-mail to the actor's own address. */
  async testSend(
    actorId: string,
    workspaceId: string,
    templateId: string,
    dto: RenderCrmEmailTemplateDTO,
  ): Promise<Result<CrmEmailTestSendDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const actor = await CrmEmailBuilderRepository.findUserIdentity(actorId)
    if (!actor.ok) return actor

    const contact = await resolveContact(workspaceId, dto)
    if (!contact.ok) return contact

    const email = await renderCampaignEmail(templateId, contact.value, {
      workspaceId,
      campaignLink: dto.campaignLink,
    })
    if (!email.ok) return email

    try {
      await sendEmail({
        from: defaultFrom,
        to: actor.value.email,
        subject: `[Teste] ${email.value.subject}`,
        html: email.value.html,
        text: email.value.text,
      })
    } catch (error) {
      logger.error('crm_email_builder.test_send_failed', {
        component: 'CrmEmailBuilderService',
        templateId,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(mailError('Não foi possível enviar o e-mail de teste'))
    }

    auditMutation({
      entity: 'crm_email_template',
      action: 'test',
      actorId,
      targetId: templateId,
      meta: { workspaceId },
    })

    return ok({ to: actor.value.email })
  },

  /** Published landing pages and forms for the link picker. */
  async linkTargets(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailLinkTargetsDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const targets =
      await CrmEmailBuilderRepository.listPublishedLinkTargets(workspaceId)
    if (!targets.ok) return targets
    return ok(toCrmEmailLinkTargetsDTO(targets.value, baseEmailUrl))
  },

  async uploadImage(
    actorId: string,
    workspaceId: string,
    input: {
      contentType: string
      byteSize: number
      readBody: () => Promise<Buffer>
    },
  ): Promise<Result<{ url: string }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const stored = await persistCrmEmailImage({ workspaceId, ...input })
    if (!stored.ok) return stored

    auditMutation({
      entity: 'storage_object',
      action: 'upload',
      actorId,
      meta: { workspaceId, kind: 'crm_email_image' },
    })
    return ok(stored.value)
  },
}

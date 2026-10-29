import { crmNewsletterIssueIncomplete } from '@/src/errors'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  type EmailChecklistItem,
  emailChecklist,
} from '@/src/lib/canvas-email/checklist'
import {
  applyEmailConditions,
  needsListMembership,
} from '@/src/lib/canvas-email/conditions'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import {
  NEWSLETTER_LINKS_ATTRIBUTE,
  NEWSLETTER_PREFERENCES_URL,
} from '@/src/lib/canvas-email/theme'
import {
  normalizeEmailDocument,
  productIdsOf,
  validateEmailDocument,
} from '@/src/lib/canvas-email/validate'
import {
  type EmailBrand,
  resolveEmailBrand,
} from '@/src/lib/crm-email-builder/brand'
import {
  emailHtmlToText,
  personalizeEmail,
  type RenderedEmail,
} from '@/src/lib/crm-email-builder/render'
import {
  contactToVariables,
  escapeHtml,
} from '@/src/lib/crm-email-builder/variables'
import { err, ok, type Result } from '@/src/lib/result'
import { toEmailProductData } from '@/src/mappers/crm-email-builder.mapper'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { CrmEmailConditionRepository } from '@/src/repositories/crm-email-condition.repository'
import type { EmailBuilderContact } from '@/src/schemas/crm-email-builder.schema'
import { personToContact } from './crm-email-builder.service'

/**
 * Rendering of a newsletter issue (ADR 0054). The canvas document is
 * rendered once per batch with the workspace brand ("base", variables
 * intact); each subscriber then gets the "Mostrar se" conditions, a string
 * substitution of the variables and the subscriber's links in the canvas
 * footer (rendered as the newsletter's subscription footer: reason,
 * "Preferências" and "Descadastrar", plus the brand address).
 */

export type IssueRenderBase = {
  email: RenderedEmail
  brand: EmailBrand
  doc: CanvasDocument
}

/** Validated v2 document of an issue, or the first problem as an error. */
export function validateIssueDocument(
  builderDocument: unknown,
): Result<CanvasDocument> {
  const validated = validateEmailDocument(
    normalizeEmailDocument(builderDocument),
  )
  if (!validated.ok) {
    return err(
      crmNewsletterIssueIncomplete(
        validated.error[0] ?? 'O conteúdo da edição é inválido',
      ),
    )
  }
  return ok(validated.value)
}

export async function renderIssueBase(
  workspaceId: string,
  builderDocument: unknown,
  subject: string,
  newsletterName: string,
): Promise<Result<IssueRenderBase>> {
  const doc = validateIssueDocument(builderDocument)
  if (!doc.ok) return doc
  const [saved, identity, products] = await Promise.all([
    CrmEmailBuilderRepository.findBrand(workspaceId),
    CrmEmailBuilderRepository.findWorkspaceIdentity(workspaceId),
    CrmEmailBuilderRepository.findProducts(
      workspaceId,
      productIdsOf(doc.value),
    ),
  ])
  if (!saved.ok) return saved
  if (!identity.ok) return identity
  if (!products.ok) return products
  const brand = resolveEmailBrand(saved.value, identity.value)
  const email = await renderEmailDocument(doc.value, {
    brand,
    subject,
    products: toEmailProductData(products.value),
    subscription: { newsletterName },
  })
  return ok({ email, brand, doc: doc.value })
}

/** Editor checklist of the issue (subject + document + rendered size). */
export function issueChecklist(
  base: IssueRenderBase,
  subject: string,
): EmailChecklistItem[] {
  return emailChecklist({ doc: base.doc, subject, html: base.email.html })
}

export type IssueRecipientLinks = {
  unsubscribeUrl?: string
  preferencesUrl?: string
}

const LINKS_PARAGRAPH = new RegExp(
  `<p\\b[^>]*\\b${NEWSLETTER_LINKS_ATTRIBUTE}\\b[^>]*>[\\s\\S]*?</p>`,
  'gi',
)

/**
 * The issue as one subscriber gets it. The canvas footer (rendered with the
 * newsletter's name) already says why the reader gets it and links
 * "Preferências" and "Descadastrar": the preferences placeholder becomes
 * this subscriber's link and `{{unsubscribe_url}}` the unsubscribe page.
 * Without links (web version) the links paragraph is dropped.
 */
export function personalizeIssue(
  base: IssueRenderBase,
  input: {
    newsletterName: string
    contact: EmailBuilderContact
    links: IssueRecipientLinks
    listIds?: readonly string[]
  },
): RenderedEmail {
  const values = contactToVariables(input.contact, {
    unsubscribeUrl: input.links.unsubscribeUrl ?? '',
  })
  const hasLinks = Boolean(
    input.links.unsubscribeUrl || input.links.preferencesUrl,
  )
  const html = hasLinks
    ? base.email.html
        .split(NEWSLETTER_PREFERENCES_URL)
        .join(escapeHtml(input.links.preferencesUrl ?? ''))
    : base.email.html.replace(LINKS_PARAGRAPH, '')
  const conditioned = applyEmailConditions(
    { ...base.email, html, text: emailHtmlToText(html) },
    { values, listIds: input.listIds ?? [] },
  )
  return personalizeEmail(conditioned, values)
}

/**
 * Web version for the public archive: no personal data (variables fall
 * back to their defaults, "Mostrar se" evaluated for an anonymous reader),
 * no unsubscribe/preferences links.
 */
export function webVersionOf(
  base: IssueRenderBase,
  newsletterName: string,
): RenderedEmail {
  return personalizeIssue(base, {
    newsletterName,
    contact: { email: '', name: '' },
    links: {},
  })
}

/**
 * Personalization data of a batch: CRM profile fields of the subscribers
 * linked to a person, and their mailing lists when the e-mail has list
 * conditions. Keyed by person id / lower-case e-mail.
 */
export async function loadRecipientFacts(
  workspaceId: string,
  base: IssueRenderBase,
  recipients: { email: string; personId: string | null }[],
): Promise<
  Result<{
    people: Map<string, EmailBuilderContact>
    lists: Map<string, string[]>
  }>
> {
  const personIds = [
    ...new Set(
      recipients
        .map((recipient) => recipient.personId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const contacts = await CrmEmailBuilderRepository.findContacts(
    workspaceId,
    personIds,
  )
  if (!contacts.ok) return contacts
  const people = new Map(
    contacts.value.map((person) => [person.id, personToContact(person)]),
  )

  let lists = new Map<string, string[]>()
  if (needsListMembership(base.email.html)) {
    const memberships = await CrmEmailConditionRepository.findListMemberships(
      workspaceId,
      recipients,
    )
    if (!memberships.ok) return memberships
    lists = memberships.value
  }
  return ok({ people, lists })
}

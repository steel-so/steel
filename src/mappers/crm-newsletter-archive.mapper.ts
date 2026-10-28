import { newsletterArchiveUrl } from '@/src/lib/newsletter/urls'
import type {
  ArchiveIssueSummaryRow,
  ArchiveNewsletterRow,
  SiteNewsletterRow,
} from '@/src/repositories/crm-newsletter-archive.repository'
import type {
  PublicNewsletterArchivePageDTO,
  PublicNewsletterIssueSummaryDTO,
  SiteNewsletterOptionDTO,
} from '@/src/schemas/crm-newsletter-archive.schema'

/** Rows of the public archive → DTOs (nothing personal goes out). */

export function toPublicArchiveNewsletter(
  row: ArchiveNewsletterRow,
): PublicNewsletterArchivePageDTO['newsletter'] {
  const brand = row.workspace.crmEmailBrand
  return {
    name: row.name,
    slug: row.slug,
    description: row.description?.trim() || null,
    cadenceLabel: row.cadenceLabel?.trim() || null,
    logoUrl: brand?.logoUrl.trim() || null,
    primaryColor: brand?.primaryColor.trim() || null,
    doubleOptIn: row.doubleOptIn,
  }
}

/** Issue card. The repository only returns rows with a number and a send
 * date; the fallbacks keep the type honest. */
export function toPublicIssueSummary(
  row: ArchiveIssueSummaryRow,
): PublicNewsletterIssueSummaryDTO {
  return {
    number: row.number ?? 0,
    subject: row.subject,
    slug: row.slug,
    excerpt: row.excerpt?.trim() || null,
    sentAt: (row.sentAt ?? new Date(0)).toISOString(),
  }
}

export function toSiteNewsletterOption(
  row: SiteNewsletterRow,
  baseUrl: string,
): SiteNewsletterOptionDTO {
  return {
    id: row.id,
    workspaceSlug: row.workspace.slug,
    slug: row.slug,
    name: row.name,
    doubleOptIn: row.doubleOptIn,
    archiveEnabled: row.archiveEnabled,
    archiveUrl: newsletterArchiveUrl(baseUrl, row.workspace.slug, row.slug),
    // Without the archive the issue pages 404: a site lists nothing.
    issues: row.archiveEnabled ? row.issues.map(toPublicIssueSummary) : [],
  }
}

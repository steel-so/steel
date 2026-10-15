import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { EmailProductRow } from './crm-email-builder.repository'
import { dbError } from './db-error'

/** Most products and testimonials the generator reads. */
export const SITE_AI_PRODUCT_LIMIT = 30
export const SITE_AI_TESTIMONIAL_LIMIT = 6

/**
 * Workspace data the AI site generator prefills the brief with: active
 * CRM products and the testimonials already written in landing pages.
 * Brand and forms come from their own repositories.
 */
export const SiteAiRepository = {
  /** Active products, in the CRM order; `ids` narrows to a selection. */
  async listProducts(
    workspaceId: string,
    ids?: string[],
  ): Promise<Result<EmailProductRow[]>> {
    if (ids && ids.length === 0) return ok([])
    try {
      const products = await prisma.crmProduct.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          active: true,
          ...(ids ? { id: { in: ids } } : {}),
        },
        select: {
          id: true,
          name: true,
          description: true,
          unitPrice: true,
          currency: true,
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        take: SITE_AI_PRODUCT_LIMIT,
      })
      return ok(products)
    } catch (error) {
      return err(dbError('Failed to list CRM products for the site AI', error))
    }
  },

  /** Raw `content` of enabled testimonial sections of live landing pages,
   * newest first. */
  async listTestimonialContents(
    workspaceId: string,
  ): Promise<Result<unknown[]>> {
    try {
      const sections = await prisma.crmLandingPageSection.findMany({
        where: {
          type: 'TESTIMONIAL',
          enabled: true,
          landingPage: { workspaceId, deletedAt: null },
        },
        select: { content: true },
        orderBy: { updatedAt: 'desc' },
        take: SITE_AI_TESTIMONIAL_LIMIT,
      })
      return ok(sections.map((section) => section.content))
    } catch (error) {
      return err(
        dbError(
          'Failed to list landing page testimonials for the site AI',
          error,
        ),
      )
    }
  },
}

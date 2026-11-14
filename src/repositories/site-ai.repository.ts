import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { EmailProductRow } from './crm-email-builder.repository'
import { dbError } from './db-error'

/** Most products the generator reads. */
export const SITE_AI_PRODUCT_LIMIT = 30

/**
 * Workspace data the AI site generator prefills the brief with: active
 * CRM products. Brand and forms come from their own repositories.
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
}

import type { CrmEmailBrand } from '@prisma/client'
import type { EmailProductData } from '@/src/lib/canvas-email/theme'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import type {
  EmailLinkTargets,
  EmailProductRow,
} from '@/src/repositories/crm-email-builder.repository'
import type {
  CrmEmailBrandDTO,
  CrmEmailLinkTargetsDTO,
} from '@/types/crm-email-marketing'

/** Resolved brand (with defaults) + whether the workspace saved one. */
export function toCrmEmailBrandDTO(
  brand: EmailBrand,
  saved: CrmEmailBrand | null,
): CrmEmailBrandDTO {
  return {
    ...brand,
    saved: saved !== null,
    updatedAt: saved ? saved.updatedAt.toISOString() : null,
  }
}

/** Public URLs of the link picker quick picks (`/l/<token>`, `/f/<token>`). */
export function toCrmEmailLinkTargetsDTO(
  targets: EmailLinkTargets,
  baseUrl: string,
): CrmEmailLinkTargetsDTO {
  const base = baseUrl.replace(/\/$/, '')
  return {
    landingPages: targets.landingPages.map((page) => ({
      id: page.id,
      title: page.title,
      url: `${base}/l/${page.shareToken}`,
    })),
    forms: targets.forms.map((form) => ({
      id: form.id,
      name: form.name,
      url: `${base}/f/${form.publicToken}`,
    })),
  }
}

/** CRM products → what product blocks show, by id (price in pt-BR). */
export function toEmailProductData(
  products: EmailProductRow[],
): Record<string, EmailProductData> {
  return Object.fromEntries(
    products.map((product) => [
      product.id,
      {
        name: product.name,
        description: product.description ?? '',
        price: new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: /^[A-Z]{3}$/.test(product.currency)
            ? product.currency
            : 'BRL',
        }).format(Number(product.unitPrice)),
      },
    ]),
  )
}

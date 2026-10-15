'use client'

import { createContext, type ReactNode, useContext } from 'react'
import {
  DEFAULT_EMAIL_BRAND,
  type EmailProductData,
} from '@/src/lib/canvas-email/theme'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import type { CrmEmailBrandDTO } from '@/types/crm-email-marketing'
import type { CrmProductDTO } from '@/types/crm-product'
import {
  createTemplateMetaStore,
  type TemplateMetaStore,
} from './template-meta'

/**
 * Data the e-mail editor's own chrome needs (inspector product picker, top
 * bar actions, sidebar tabs). React context is fine here: these components
 * render in the editor chrome, never in the e-mail output.
 */
export interface EmailEditorData {
  workspaceId: string
  slug: string
  templateId: string
  products: CrmProductDTO[]
  productsLoading: boolean
  /** Workspace e-mail brand as currently previewed (unsaved edits too). */
  brand: EmailBrand
  /** Template name and subject (saved apart from the document). */
  meta: TemplateMetaStore
  /** Saves pending name/subject edits now; `true` when nothing is left. */
  flushMeta: () => Promise<boolean>
}

const EmailEditorDataContext = createContext<EmailEditorData>({
  workspaceId: '',
  slug: '',
  templateId: '',
  products: [],
  productsLoading: false,
  brand: DEFAULT_EMAIL_BRAND,
  meta: createTemplateMetaStore({ name: '', subject: '' }),
  flushMeta: async () => true,
})

export function EmailEditorDataProvider({
  value,
  children,
}: {
  value: EmailEditorData
  children: ReactNode
}) {
  return (
    <EmailEditorDataContext.Provider value={value}>
      {children}
    </EmailEditorDataContext.Provider>
  )
}

export function useEmailEditorData(): EmailEditorData {
  return useContext(EmailEditorDataContext)
}

const priceFormats = new Map<string, Intl.NumberFormat>()

/** Price as the e-mail shows it ("R$ 1.290,00"), same rule as the server. */
export function formatProductPrice(product: {
  unitPrice: number
  currency: string
}): string {
  const currency = /^[A-Z]{3}$/.test(product.currency)
    ? product.currency
    : 'BRL'
  let format = priceFormats.get(currency)
  if (!format) {
    format = new Intl.NumberFormat('pt-BR', { style: 'currency', currency })
    priceFormats.set(currency, format)
  }
  return format.format(Number(product.unitPrice))
}

/** CRM products → what product blocks show, by id (editor and preview). */
export function toProductData(
  products: CrmProductDTO[],
): Record<string, EmailProductData> {
  return Object.fromEntries(
    products.map((product) => [
      product.id,
      {
        name: product.name,
        description: product.description ?? '',
        price: formatProductPrice(product),
      },
    ]),
  )
}

export function toEmailBrand(dto: CrmEmailBrandDTO): EmailBrand {
  const { companyName, logoUrl, primaryColor, address, website } = dto
  return { companyName, logoUrl, primaryColor, address, website }
}

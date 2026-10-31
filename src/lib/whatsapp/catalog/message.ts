import type { WhatsAppOutboundProducts } from '../types'

/** Meta limits: 30 products and 10 sections in a multi-product message. */
export const PRODUCT_LIST_MAX_ITEMS = 30
export const PRODUCT_LIST_MAX_SECTIONS = 10

/** `interactive` block of a product (single) or product_list message. */
export function buildMetaProductsMessage(
  input: WhatsAppOutboundProducts,
): Record<string, unknown> {
  const footer = input.footerText ? { footer: { text: input.footerText } } : {}
  if (input.retailerIds.length === 1) {
    return {
      type: 'product',
      body: { text: input.bodyText },
      ...footer,
      action: {
        catalog_id: input.catalogId,
        product_retailer_id: input.retailerIds[0],
      },
    }
  }
  return {
    type: 'product_list',
    header: { type: 'text', text: input.headerText ?? 'Nossos produtos' },
    body: { text: input.bodyText },
    ...footer,
    action: {
      catalog_id: input.catalogId,
      sections: [
        {
          title: (input.sectionTitle ?? 'Produtos').slice(0, 24),
          product_items: input.retailerIds.map((id) => ({
            product_retailer_id: id,
          })),
        },
      ],
    },
  }
}

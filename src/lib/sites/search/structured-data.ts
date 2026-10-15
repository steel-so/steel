import type {
  SiteBusinessProfileDTO,
  StructuredDataItem,
  StructuredDataType,
} from '@/src/schemas/site-search.schema'

/**
 * Structured data chosen per page ("Dados estruturados"): what each type
 * requires for a rich result, the validation the editor shows, and the
 * schema.org node the public runtime publishes. FAQPage and LocalBusiness
 * carry no fields of their own: they come from the page's questions and
 * from the business profile. Pure.
 */

type JsonLdNode = Record<string, unknown>

export const STRUCTURED_DATA_LABELS: Record<StructuredDataType, string> = {
  Article: 'Artigo',
  Product: 'Produto',
  Service: 'Serviço',
  Event: 'Evento',
  HowTo: 'Passo a passo (HowTo)',
  FAQPage: 'Perguntas frequentes (FAQ)',
  LocalBusiness: 'Negócio local',
}

export const STRUCTURED_DATA_HINTS: Record<StructuredDataType, string> = {
  Article:
    'Conteúdo editorial: notícia, guia ou post. Mostra autor e data nos resultados.',
  Product: 'Um produto com preço. Pode vir de um produto do CRM.',
  Service: 'Um serviço que a empresa presta, com área atendida.',
  Event: 'Data, local (ou link) e ingresso de um evento.',
  HowTo: 'Instruções em passos numerados.',
  FAQPage:
    'Usa os acordeões da página e as perguntas cadastradas em "Perguntas que este conteúdo responde".',
  LocalBusiness: 'Usa o Perfil do negócio (endereço, telefone e horário).',
}

/** What the validation needs besides the item itself. */
export interface StructuredDataContext {
  pageTitle: string
  description?: string
  faqCount: number
  business: SiteBusinessProfileDTO
}

/** Missing required properties (pt-BR labels); empty when valid. */
export function validateStructuredData(
  item: StructuredDataItem,
  context: StructuredDataContext,
): string[] {
  const missing: string[] = []
  const need = (ok: unknown, label: string) => {
    if (!ok) missing.push(label)
  }
  switch (item.type) {
    case 'Article':
      need(item.headline || context.pageTitle, 'título')
      need(item.authorName, 'autor')
      need(item.datePublished, 'data de publicação')
      break
    case 'Product':
      need(item.name, 'nome')
      need(item.price !== undefined, 'preço')
      need(item.description || context.description, 'descrição')
      break
    case 'Service':
      need(item.name, 'nome')
      need(item.description || context.description, 'descrição')
      need(item.serviceType || context.business.category, 'tipo de serviço')
      break
    case 'Event':
      need(item.name, 'nome')
      need(item.startDate, 'data de início')
      need(
        item.attendance === 'online'
          ? item.url
          : item.locationName || item.locationAddress,
        item.attendance === 'online' ? 'link do evento' : 'local',
      )
      if (item.startDate && item.endDate && item.endDate < item.startDate) {
        missing.push('data de término depois do início')
      }
      break
    case 'HowTo':
      need(item.name || context.pageTitle, 'nome')
      need((item.steps?.length ?? 0) >= 2, 'pelo menos 2 passos')
      break
    case 'FAQPage':
      need(context.faqCount > 0, 'perguntas com resposta')
      break
    case 'LocalBusiness':
      need(context.business.name, 'nome do negócio')
      need(context.business.address?.city, 'cidade')
      need(context.business.phone, 'telefone')
      break
  }
  return missing
}

function offers(
  item: { price?: number; currency?: string },
  url: string,
  extra: JsonLdNode = {},
): JsonLdNode {
  if (item.price === undefined) return {}
  return {
    offers: {
      '@type': 'Offer',
      price: item.price.toFixed(2),
      priceCurrency: item.currency ?? 'BRL',
      url,
      ...extra,
    },
  }
}

/** What the published node takes from the page. */
export interface StructuredDataNodeContext {
  pageUrl: string
  pageTitle: string
  description?: string
  image: string
  organizationId: string
  dateModified?: string
}

/**
 * The schema.org node of an item, or `null` for the types assembled
 * elsewhere (FAQPage, LocalBusiness) and for invalid items.
 */
export function structuredDataNode(
  item: StructuredDataItem,
  index: number,
  context: StructuredDataNodeContext,
): JsonLdNode | null {
  const id = `${context.pageUrl}#${item.type.toLowerCase()}-${index + 1}`
  const description = (value?: string) =>
    value || context.description
      ? { description: value || context.description }
      : {}
  switch (item.type) {
    case 'Article':
      return {
        '@type': 'Article',
        '@id': id,
        headline: item.headline || context.pageTitle,
        mainEntityOfPage: context.pageUrl,
        image: item.image || context.image,
        ...(item.authorName
          ? { author: { '@type': 'Person', name: item.authorName } }
          : {}),
        ...(item.datePublished ? { datePublished: item.datePublished } : {}),
        ...(context.dateModified ? { dateModified: context.dateModified } : {}),
        publisher: { '@id': context.organizationId },
        ...description(),
      }
    case 'Product':
      return {
        '@type': 'Product',
        '@id': id,
        name: item.name || context.pageTitle,
        ...description(item.description),
        image: item.image || context.image,
        ...(item.sku ? { sku: item.sku } : {}),
        ...(item.brand
          ? { brand: { '@type': 'Brand', name: item.brand } }
          : {}),
        ...offers(item, context.pageUrl, {
          availability: `https://schema.org/${item.availability ?? 'InStock'}`,
        }),
      }
    case 'Service':
      return {
        '@type': 'Service',
        '@id': id,
        name: item.name || context.pageTitle,
        ...description(item.description),
        ...(item.serviceType ? { serviceType: item.serviceType } : {}),
        ...(item.areaServed ? { areaServed: item.areaServed } : {}),
        provider: { '@id': context.organizationId },
        ...offers(item, context.pageUrl),
      }
    case 'Event': {
      const online = item.attendance === 'online'
      const place = {
        '@type': 'Place',
        name: item.locationName || item.locationAddress,
        ...(item.locationAddress ? { address: item.locationAddress } : {}),
      }
      const virtual = { '@type': 'VirtualLocation', url: item.url }
      const location =
        item.attendance === 'mixed'
          ? [place, virtual]
          : online
            ? virtual
            : place
      return {
        '@type': 'Event',
        '@id': id,
        name: item.name || context.pageTitle,
        ...description(item.description),
        ...(item.startDate ? { startDate: item.startDate } : {}),
        ...(item.endDate ? { endDate: item.endDate } : {}),
        eventAttendanceMode: `https://schema.org/${
          online
            ? 'OnlineEventAttendanceMode'
            : item.attendance === 'mixed'
              ? 'MixedEventAttendanceMode'
              : 'OfflineEventAttendanceMode'
        }`,
        eventStatus: 'https://schema.org/EventScheduled',
        location,
        image: item.image || context.image,
        organizer: { '@id': context.organizationId },
        ...offers(item, item.url ?? context.pageUrl),
      }
    }
    case 'HowTo':
      return {
        '@type': 'HowTo',
        '@id': id,
        name: item.name || context.pageTitle,
        ...description(item.description),
        ...(item.totalTime ? { totalTime: item.totalTime } : {}),
        step: (item.steps ?? []).map((step, position) => ({
          '@type': 'HowToStep',
          position: position + 1,
          ...(step.name ? { name: step.name } : {}),
          text: step.text,
        })),
      }
    default:
      return null
  }
}

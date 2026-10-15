import { sectionAnchors } from '@/app/_components/crm/landing-page/section-anchors'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
  CanvasProps,
} from '@/src/lib/canvas/types'
import { ROOT_ID } from '@/src/lib/canvas/types'
import {
  type CrmLandingPageSectionContent,
  CrmLandingPageSectionContentSchema,
  type CrmLandingPageSectionType,
} from '@/src/schemas/crm-landing-page-section.schema'
import {
  SITE_CATALOG_ID,
  SITE_CATALOG_VERSION,
  SITE_ROOT_TYPE,
} from './document'

/**
 * Landing page (fixed template + typed sections) → one-page site.
 *
 * Every section becomes a `site.section` band holding containers and basic
 * elements (heading, text, button, image, list, form, menu), with the same
 * pt-BR anchor ids the landing page used, so `#servicos` links keep working.
 * The first HEADER/FOOTER become the site's header/footer globals.
 *
 * TODO(sites-integration): once src/lib/canvas-site lands, rebuild each
 * section from the catalog's "Seções prontas" preset of the same type (and
 * the style closest to `templateKey`) and align the props below with the
 * catalog's schemas. The template-specific copy overrides (`texts`/`hrefs`)
 * and decorative dropdowns are not carried over.
 */

export interface LandingSource {
  title: string
  templateKey: string
  sections: Array<{
    type: CrmLandingPageSectionType
    order: number
    enabled: boolean
    content: unknown
  }>
}

export interface ConvertedLanding {
  page: CanvasDocument
  header: CanvasDocument | null
  footer: CanvasDocument | null
  /** Sections skipped because their stored content no longer parses. */
  skipped: number
}

class DocBuilder {
  private readonly nodes: Record<CanvasNodeId, CanvasNode> = {}
  private counter = 0

  constructor() {
    this.nodes[ROOT_ID] = {
      id: ROOT_ID,
      type: SITE_ROOT_TYPE,
      props: {},
      children: [],
    }
  }

  add(parentId: CanvasNodeId, type: string, props: CanvasProps): CanvasNodeId {
    this.counter += 1
    const id = `lp${this.counter}`
    const leaf = LEAF_TYPES.has(type)
    this.nodes[id] = leaf
      ? { id, type, props }
      : { id, type, props, children: [] }
    this.nodes[parentId].children?.push(id)
    return id
  }

  get isEmpty(): boolean {
    return (this.nodes[ROOT_ID].children ?? []).length === 0
  }

  build(): CanvasDocument {
    return {
      catalog: SITE_CATALOG_ID,
      version: SITE_CATALOG_VERSION,
      rootId: ROOT_ID,
      nodes: this.nodes,
    }
  }
}

const LEAF_TYPES = new Set([
  'site.heading',
  'site.text',
  'site.button',
  'site.image',
  'site.video',
  'site.list',
  'site.form',
  'site.menu',
  'site.social',
  'site.divider',
  'site.spacer',
])

type Parent = { builder: DocBuilder; id: CanvasNodeId }

function heading(parent: Parent, text: string | undefined, level: number) {
  if (text) parent.builder.add(parent.id, 'site.heading', { text, level })
}

function text(
  parent: Parent,
  value: string | undefined,
  variant: 'body' | 'lead' | 'eyebrow' | 'quote' | 'small' = 'body',
) {
  if (value)
    parent.builder.add(parent.id, 'site.text', { text: value, variant })
}

function button(
  parent: Parent,
  label: string | undefined,
  href: string | undefined,
) {
  if (label) {
    parent.builder.add(parent.id, 'site.button', {
      label,
      href: href || '#',
      variant: 'primary',
    })
  }
}

function image(parent: Parent, src: string | undefined, alt: string) {
  if (src) parent.builder.add(parent.id, 'site.image', { src, alt })
}

function media(
  parent: Parent,
  content: { imageUrl?: string; videoUrl?: string },
  alt: string,
) {
  if (content.videoUrl) {
    parent.builder.add(parent.id, 'site.video', {
      url: content.videoUrl,
      poster: content.imageUrl,
    })
  } else {
    image(parent, content.imageUrl, alt)
  }
}

function stack(parent: Parent, align: 'start' | 'center' = 'start'): Parent {
  return {
    builder: parent.builder,
    id: parent.builder.add(parent.id, 'site.container', {
      layout: 'flex',
      direction: 'column',
      gap: 16,
      align,
    }),
  }
}

function grid(parent: Parent, items: number, max = 3): Parent {
  return {
    builder: parent.builder,
    id: parent.builder.add(parent.id, 'site.container', {
      layout: 'grid',
      columns: Math.max(1, Math.min(items, max)),
      gap: 24,
    }),
  }
}

function row(parent: Parent): Parent {
  return {
    builder: parent.builder,
    id: parent.builder.add(parent.id, 'site.container', {
      layout: 'flex',
      direction: 'row',
      gap: 24,
      align: 'center',
      justify: 'space-between',
      wrap: true,
    }),
  }
}

/** Title + subtitle block opening most sections. */
function intro(
  parent: Parent,
  content: { title?: string; subtitle?: string; eyebrow?: string },
) {
  const block = stack(parent, 'center')
  text(block, content.eyebrow, 'eyebrow')
  heading(block, content.title, 2)
  text(block, content.subtitle, 'lead')
}

function convertSection(
  content: CrmLandingPageSectionContent,
  band: Parent,
): void {
  switch (content.type) {
    case 'HEADER': {
      const bar = row(band)
      text(bar, content.logoText, 'lead')
      if (content.navLinks.length > 0) {
        bar.builder.add(bar.id, 'site.menu', {
          source: 'links',
          links: content.navLinks,
        })
      }
      button(bar, content.ctaLabel, content.ctaHref)
      return
    }
    case 'HERO': {
      const body = stack(band, 'center')
      text(body, content.eyebrow, 'eyebrow')
      heading(body, content.title, 1)
      text(body, content.subtitle, 'lead')
      button(body, content.ctaLabel, content.ctaHref)
      media(body, content, content.title)
      return
    }
    case 'SERVICES':
    case 'FEATURES':
    case 'WORKS': {
      intro(band, content)
      const cards = grid(band, content.items.length)
      for (const item of content.items) {
        const card = stack(cards)
        if ('imageUrl' in item) image(card, item.imageUrl, item.title)
        heading(card, item.title, 3)
        if ('category' in item) text(card, item.category, 'small')
        if ('description' in item) text(card, item.description)
      }
      if (content.type === 'SERVICES') media(band, content, content.title)
      if (content.type === 'FEATURES') {
        const cta = stack(band, 'center')
        heading(cta, content.ctaTitle, 3)
        text(cta, content.ctaDescription)
        button(cta, content.ctaLabel, content.ctaHref)
      }
      return
    }
    case 'FACTS': {
      const cards = grid(band, content.items.length, 4)
      for (const item of content.items) {
        const card = stack(cards, 'center')
        heading(card, item.value, 3)
        text(card, item.label)
      }
      return
    }
    case 'ABOUT': {
      const columns = grid(band, 2)
      const body = stack(columns)
      text(body, content.eyebrow, 'eyebrow')
      heading(body, content.title, 2)
      text(body, content.description)
      const pictures = stack(columns)
      image(pictures, content.imageUrl, content.title)
      for (const url of content.imageUrls) image(pictures, url, content.title)
      return
    }
    case 'TESTIMONIAL': {
      const body = stack(band, 'center')
      image(body, content.avatarUrl, content.authorName)
      text(body, content.quote, 'quote')
      text(
        body,
        content.authorRole
          ? `${content.authorName} — ${content.authorRole}`
          : content.authorName,
        'small',
      )
      return
    }
    case 'FOOTER': {
      const columns = grid(band, content.linkGroups.length + 1, 4)
      const brand = stack(columns)
      text(brand, content.logoText, 'lead')
      text(brand, content.text, 'small')
      for (const group of content.linkGroups) {
        const column = stack(columns)
        heading(column, group.title, 4)
        if (group.links.length > 0) {
          column.builder.add(column.id, 'site.menu', {
            source: 'links',
            links: group.links,
            direction: 'column',
          })
        }
      }
      if (content.socialLinks.length > 0) {
        band.builder.add(band.id, 'site.social', { links: content.socialLinks })
      }
      const cta = stack(band, 'center')
      heading(cta, content.ctaTitle, 3)
      text(cta, content.ctaDescription)
      button(cta, content.ctaLabel, content.ctaHref)
      return
    }
    case 'PRICING': {
      intro(band, content)
      const cards = grid(band, content.plans.length)
      for (const plan of content.plans) {
        const card = stack(cards)
        heading(card, plan.name, 3)
        heading(card, plan.price, 4)
        text(card, plan.period, 'small')
        if (plan.features.length > 0) {
          card.builder.add(card.id, 'site.list', { items: plan.features })
        }
        button(card, plan.ctaLabel, plan.ctaHref)
      }
      return
    }
    case 'FAQ': {
      intro(band, content)
      const list = stack(band)
      for (const item of content.items) {
        heading(list, item.question, 3)
        text(list, item.answer)
      }
      return
    }
    case 'STEPS': {
      intro(band, content)
      const cards = grid(band, content.items.length, 4)
      content.items.forEach((item, index) => {
        const card = stack(cards)
        text(card, String(index + 1).padStart(2, '0'), 'eyebrow')
        heading(card, item.title, 3)
        text(card, item.description)
      })
      media(band, content, content.title)
      return
    }
    case 'NEWSLETTER': {
      const body = stack(band, 'center')
      heading(body, content.title, 2)
      text(body, content.description)
      if (content.formId) {
        body.builder.add(body.id, 'site.form', { formId: content.formId })
      }
      return
    }
    case 'LOGOS': {
      const body = stack(band, 'center')
      text(body, content.title, 'eyebrow')
      const logos = grid(body, content.logos.length, 6)
      for (const logo of content.logos) {
        if (logo.imageUrl) image(logos, logo.imageUrl, logo.name)
        else text(logos, logo.name, 'lead')
      }
      return
    }
    case 'PRODUCTS': {
      intro(band, content)
      const cards = grid(band, content.items.length, 4)
      for (const item of content.items) {
        const card = stack(cards)
        image(card, item.imageUrl, item.title)
        heading(card, item.title, 3)
        text(
          card,
          item.originalPrice
            ? `${item.price} (de ${item.originalPrice})`
            : item.price,
          'lead',
        )
      }
      return
    }
  }
}

export function convertLandingPage(source: LandingSource): ConvertedLanding {
  const enabled = [...source.sections]
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order)
  const anchors = sectionAnchors(enabled)

  const page = new DocBuilder()
  let header: DocBuilder | null = null
  let footer: DocBuilder | null = null
  let skipped = 0

  enabled.forEach((section, index) => {
    const parsed = CrmLandingPageSectionContentSchema.safeParse(section.content)
    if (!parsed.success || parsed.data.type !== section.type) {
      skipped += 1
      return
    }
    let target = page
    if (section.type === 'HEADER' && !header) {
      header = new DocBuilder()
      target = header
    } else if (section.type === 'FOOTER' && !footer) {
      footer = new DocBuilder()
      target = footer
    }
    const band = target.add(ROOT_ID, 'site.section', {
      anchorId: anchors[index].id,
      tone: section.type === 'TESTIMONIAL' ? 'accent' : 'default',
    })
    convertSection(parsed.data, { builder: target, id: band })
  })

  if (page.isEmpty) {
    const band = page.add(ROOT_ID, 'site.section', { anchorId: 'inicio' })
    page.add(band, 'site.heading', { text: source.title, level: 1 })
  }

  return {
    page: page.build(),
    header: (header as DocBuilder | null)?.build() ?? null,
    footer: (footer as DocBuilder | null)?.build() ?? null,
    skipped,
  }
}

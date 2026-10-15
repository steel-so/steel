import { sectionAnchors } from '@/app/_components/crm/landing-page/section-anchors'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { CanvasLink } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '@/src/lib/canvas-site'
import type { SocialNetwork } from '@/src/lib/canvas-site/icons'
import { SOCIAL_NETWORKS } from '@/src/lib/canvas-site/icons'
import {
  SECTION_BUILDERS,
  SITE_KITS,
  type SiteKitId,
} from '@/src/lib/canvas-site/presets'
import {
  anchor,
  box,
  button as buttonSpec,
  grid as gridSpec,
  heading as headingSpec,
  image as imageSpec,
  list,
  type NodeSpec,
  overline,
  row,
  section,
  spec,
  text as textSpec,
  toDocument,
  url,
  video as videoSpec,
} from '@/src/lib/canvas-site/presets/builder'
import type { SiteTheme } from '@/src/lib/canvas-site/theme'
import {
  type CrmLandingPageSectionContent,
  CrmLandingPageSectionContentSchema,
  type CrmLandingPageSectionType,
} from '@/src/schemas/crm-landing-page-section.schema'

/**
 * Landing page (fixed template + typed sections) → one-page site of the
 * `site` catalog.
 *
 * Every section becomes a `site.section` band built with the catalog's
 * preset builder (so every node starts from the component's defaults and
 * passes `validateSiteDocument`), carrying the landing page's copy, links,
 * images and forms, with the same pt-BR anchor ids (`#servicos` keeps
 * working). The first HEADER/FOOTER become the site's header/footer globals.
 * The look comes from the catalog's "Seções prontas": each band takes the
 * section props (background, padding, text color, landmark tag) of the
 * preset of the same type in the kit closest to the old template, and the
 * site gets that kit's theme. The template-specific copy overrides
 * (`texts`/`hrefs`) and decorative dropdowns are not carried over.
 */

/** Kit of the catalog closest to each landing page template. */
const TEMPLATE_KITS: Record<string, SiteKitId> = {
  agency: 'agency',
  b2b: 'b2b',
  consultation: 'b2b',
  coworking: 'b2b',
  'job-site': 'b2b',
}

export function kitForTemplate(templateKey: string): SiteKitId {
  return TEMPLATE_KITS[templateKey] ?? 'saas'
}

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
  /** Theme of the kit the sections were styled with. */
  theme: SiteTheme
  /** Sections skipped because their stored content no longer parses. */
  skipped: number
}

type Maybe = NodeSpec | null | false | '' | undefined

const compact = (nodes: Maybe[]): NodeSpec[] =>
  nodes.filter((node): node is NodeSpec => Boolean(node))

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** `#secao` → anchor link; anything else is kept as a URL. */
export function toLink(href: string | undefined): CanvasLink {
  const value = href?.trim() || '#'
  if (value.startsWith('#')) return anchor(value.slice(1))
  return url(value)
}

function videoSource(value: string): 'youtube' | 'vimeo' | 'upload' {
  if (/youtu\.?be/i.test(value)) return 'youtube'
  if (/vimeo\.com/i.test(value)) return 'vimeo'
  return 'upload'
}

const heading = (
  level: 'h1' | 'h2' | 'h3' | 'h4',
  value: string | undefined,
): Maybe => (value ? headingSpec(level, value) : null)

const text = (
  value: string | undefined,
  preset: 'lead' | 'body' | 'small' = 'body',
): Maybe => (value ? textSpec(`<p>${escapeHtml(value)}</p>`, { preset }) : null)

const eyebrow = (value: string | undefined): Maybe =>
  value ? overline(`<p>${escapeHtml(value)}</p>`) : null

const button = (label: string | undefined, href: string | undefined): Maybe =>
  label ? buttonSpec(label, toLink(href)) : null

const image = (src: string | undefined, alt: string): Maybe =>
  src ? imageSpec(src, alt) : null

function media(
  content: { imageUrl?: string; videoUrl?: string },
  title: string,
): Maybe {
  if (content.videoUrl) {
    return videoSpec(content.videoUrl, {
      source: videoSource(content.videoUrl),
      title,
      ...(content.imageUrl ? { poster: content.imageUrl } : {}),
    })
  }
  return image(content.imageUrl, title)
}

const stack = (children: Maybe[], center = false): NodeSpec =>
  box(
    {
      direction: 'column',
      gap: 16,
      ...(center ? { alignItems: 'center', textAlign: 'center' } : {}),
    },
    compact(children),
  )

const grid = (items: NodeSpec[], max = 3): NodeSpec =>
  gridSpec(Math.max(1, Math.min(items.length, max)), items)

/** Title + subtitle block opening most sections. */
const intro = (content: {
  title?: string
  subtitle?: string
  eyebrow?: string
}): NodeSpec =>
  stack(
    [
      eyebrow(content.eyebrow),
      heading('h2', content.title),
      text(content.subtitle, 'lead'),
    ],
    true,
  )

function linkMenu(
  links: Array<{ label: string; href: string }>,
  vertical = false,
): Maybe {
  if (links.length === 0) return null
  return spec(SITE_TYPES.menu, {
    source: 'custom',
    items: links.map((link) => ({
      label: link.label,
      link: toLink(link.href),
    })),
    ...(vertical ? { orientation: 'vertical', collapse: 'never' } : {}),
  })
}

function isNetwork(value: string): value is SocialNetwork {
  return Object.hasOwn(SOCIAL_NETWORKS, value)
}

function socialLinks(links: Array<{ platform: string; href: string }>): Maybe {
  const items = links
    .map((link) => ({
      network: link.platform.toLowerCase().replace('twitter', 'x'),
      url: link.href,
    }))
    .filter((item) => isNetwork(item.network))
  return items.length > 0 ? spec(SITE_TYPES.social, { items }) : null
}

/** Children of the section band for one landing page section. */
function convertSection(content: CrmLandingPageSectionContent): Maybe[] {
  switch (content.type) {
    case 'HEADER':
      return [
        row(
          compact([
            text(content.logoText, 'lead'),
            linkMenu(content.navLinks),
            button(content.ctaLabel, content.ctaHref),
          ]),
          { justify: 'between' },
        ),
      ]
    case 'HERO':
      return [
        stack(
          [
            eyebrow(content.eyebrow),
            heading('h1', content.title),
            text(content.subtitle, 'lead'),
            button(content.ctaLabel, content.ctaHref),
            media(content, content.title),
          ],
          true,
        ),
      ]
    case 'SERVICES':
    case 'FEATURES':
    case 'WORKS': {
      const cards = content.items.map((item) =>
        stack([
          'imageUrl' in item ? image(item.imageUrl, item.title) : null,
          heading('h3', item.title),
          'category' in item ? text(item.category, 'small') : null,
          'description' in item ? text(item.description) : null,
        ]),
      )
      return [
        intro(content),
        cards.length > 0 && grid(cards),
        content.type === 'SERVICES' && media(content, content.title),
        content.type === 'FEATURES' &&
          (content.ctaTitle || content.ctaLabel) &&
          stack(
            [
              heading('h3', content.ctaTitle),
              text(content.ctaDescription),
              button(content.ctaLabel, content.ctaHref),
            ],
            true,
          ),
      ]
    }
    case 'FACTS': {
      const cards = content.items.map((item) =>
        stack([heading('h3', item.value), text(item.label)], true),
      )
      return [cards.length > 0 && grid(cards, 4)]
    }
    case 'ABOUT':
      return [
        gridSpec(2, [
          stack([
            eyebrow(content.eyebrow),
            heading('h2', content.title),
            text(content.description),
          ]),
          stack([
            image(content.imageUrl, content.title),
            ...content.imageUrls.map((src) => image(src, content.title)),
          ]),
        ]),
      ]
    case 'TESTIMONIAL':
      return [
        stack(
          [
            image(content.avatarUrl, content.authorName),
            text(content.quote, 'lead'),
            text(
              content.authorRole
                ? `${content.authorName} — ${content.authorRole}`
                : content.authorName,
              'small',
            ),
          ],
          true,
        ),
      ]
    case 'FOOTER': {
      const columns = [
        stack([text(content.logoText, 'lead'), text(content.text, 'small')]),
        ...content.linkGroups.map((group) =>
          stack([heading('h4', group.title), linkMenu(group.links, true)]),
        ),
      ]
      return [
        grid(columns, 4),
        socialLinks(content.socialLinks),
        (content.ctaTitle || content.ctaLabel) &&
          stack(
            [
              heading('h3', content.ctaTitle),
              text(content.ctaDescription),
              button(content.ctaLabel, content.ctaHref),
            ],
            true,
          ),
      ]
    }
    case 'PRICING': {
      const cards = content.plans.map((plan) =>
        stack([
          heading('h3', plan.name),
          heading('h4', plan.price),
          text(plan.period, 'small'),
          plan.features.length > 0 && list(plan.features),
          button(plan.ctaLabel, plan.ctaHref),
        ]),
      )
      return [intro(content), cards.length > 0 && grid(cards)]
    }
    case 'FAQ':
      return [
        intro(content),
        content.items.length > 0 &&
          stack(
            content.items.flatMap((item) => [
              heading('h3', item.question),
              text(item.answer),
            ]),
          ),
      ]
    case 'STEPS': {
      const cards = content.items.map((item, index) =>
        stack([
          eyebrow(String(index + 1).padStart(2, '0')),
          heading('h3', item.title),
          text(item.description),
        ]),
      )
      return [
        intro(content),
        cards.length > 0 && grid(cards, 4),
        media(content, content.title),
      ]
    }
    case 'NEWSLETTER':
      return [
        stack(
          [
            heading('h2', content.title),
            text(content.description),
            content.formId && spec(SITE_TYPES.form, { formId: content.formId }),
          ],
          true,
        ),
      ]
    case 'LOGOS': {
      const logos = content.logos.map((logo) =>
        logo.imageUrl
          ? imageSpec(logo.imageUrl, logo.name)
          : textSpec(`<p>${escapeHtml(logo.name)}</p>`, { preset: 'lead' }),
      )
      return [
        stack(
          [eyebrow(content.title), logos.length > 0 && grid(logos, 6)],
          true,
        ),
      ]
    }
    case 'PRODUCTS': {
      const cards = content.items.map((item) =>
        stack([
          image(item.imageUrl, item.title),
          heading('h3', item.title),
          text(
            item.originalPrice
              ? `${item.price} (de ${item.originalPrice})`
              : item.price,
            'lead',
          ),
        ]),
      )
      return [intro(content), cards.length > 0 && grid(cards, 4)]
    }
  }
}

/** Section props of the kit's preset for this type (look, landmark tag),
 * without its content-specific anchor. */
function presetLook(
  type: CrmLandingPageSectionType,
  kit: SiteKitId,
): Record<string, unknown> {
  const builder =
    SECTION_BUILDERS[type.toLowerCase() as keyof typeof SECTION_BUILDERS]
  const { anchor: _anchor, ...props } = builder(SITE_KITS[kit]).props
  return props
}

export function convertLandingPage(source: LandingSource): ConvertedLanding {
  const enabled = [...source.sections]
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order)
  const anchors = sectionAnchors(enabled)
  const kit = kitForTemplate(source.templateKey)

  const page: NodeSpec[] = []
  let header: NodeSpec | null = null
  let footer: NodeSpec | null = null
  let skipped = 0

  enabled.forEach((item, index) => {
    const parsed = CrmLandingPageSectionContentSchema.safeParse(item.content)
    if (!parsed.success || parsed.data.type !== item.type) {
      skipped += 1
      return
    }
    const band = section(
      { ...presetLook(item.type, kit), anchor: anchors[index].id },
      compact(convertSection(parsed.data)),
    )
    if (item.type === 'HEADER' && !header) header = band
    else if (item.type === 'FOOTER' && !footer) footer = band
    else page.push(band)
  })

  if (page.length === 0) {
    page.push(section({ anchor: 'inicio' }, [headingSpec('h1', source.title)]))
  }

  return {
    page: toDocument(page),
    header: header ? toDocument([header], { tag: 'div' }) : null,
    footer: footer ? toDocument([footer], { tag: 'div' }) : null,
    theme: SITE_KITS[kit].theme,
    skipped,
  }
}

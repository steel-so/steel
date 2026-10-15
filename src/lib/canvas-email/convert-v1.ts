import type {
  CanvasDocument,
  CanvasFragment,
  CanvasNode,
} from '@/src/lib/canvas/types'
import { ROOT_ID } from '@/src/lib/canvas/types'
import type { CanvasSpacing, CanvasTypography } from '@/src/lib/canvas/values'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import {
  type EmailBuilderDocument,
  EmailBuilderDocumentSchema,
  type EmailBuilderLayoutId,
  type EmailBuilderSection,
} from '@/src/schemas/crm-email-builder.schema'
import { EMAIL_CATALOG_ID, EMAIL_CATALOG_VERSION } from './catalog'
import {
  BODY,
  COLUMN,
  defaultBodyProps,
  defaultColumnProps,
  defaultFooterProps,
  defaultSectionProps,
  FOOTER,
  SECTION,
} from './components/layout'
import { SHOWN } from './primitives'
import type { EmailLink } from './schemas'

/**
 * v1 → v2 converter. A v1 document is a locked list of sections; each
 * becomes one `email.section` with one `email.column` holding the blocks
 * that reproduce it (same texts, links, images and order). Ids are derived
 * from the v1 section ids, so converting twice gives the same document.
 * Hidden optional sections stay in the document with `meta.hidden`.
 */

type Nodes = Record<string, CanvasNode>

const pad = (
  top: number,
  right = 0,
  bottom = 0,
  left = right,
): CanvasSpacing => ({ top, right, bottom, left })

const shown = () => ({ ...SHOWN })
const url = (value: string): EmailLink => ({ type: 'url', value })

const SMALL: CanvasTypography = { fontSize: 13, lineHeight: 1.5 }

function block(
  id: string,
  type: string,
  props: Record<string, unknown>,
): CanvasNode {
  return { id, type, props: { visibility: shown(), ...props } }
}

/** Blocks of one v1 section (ids prefixed with `prefix`). */
function sectionBlocks(section: EmailBuilderSection, prefix: string) {
  const blocks: CanvasNode[] = []
  let n = 0
  const add = (type: string, props: Record<string, unknown>) => {
    blocks.push(block(`${prefix}-b${n++}`, type, props))
  }
  const heading = (
    text: string,
    level: 'h1' | 'h2' | 'h3',
    extra: Record<string, unknown> = {},
  ) => {
    if (!text.trim()) return
    add('email.heading', {
      text,
      level,
      align: 'left',
      padding: pad(0, 0, 12),
      ...extra,
    })
  }
  const smallText = (text: string, align: 'left' | 'center') => {
    if (!text.trim()) return
    add('email.text', {
      html: `<p>${escapeText(text)}</p>`,
      align,
      color: 'token:text-subtle',
      typography: SMALL,
      padding: pad(8, 0, 0),
    })
  }
  const button = (label: string, link: string, align: 'left' | 'center') => {
    if (!label.trim()) return
    add('email.button', {
      label,
      link: url(link),
      align,
      backgroundColor: 'token:primary',
      textColor: 'token:on-primary',
      radius: 8,
      buttonPadding: pad(12, 24, 12),
      fullWidth: false,
      padding: pad(8, 0, 0),
    })
  }

  switch (section.type) {
    case 'header':
      add('email.logo', {
        image: { src: '', alt: '' },
        height: 36,
        align: 'left',
        padding: pad(0),
      })
      break
    case 'hero': {
      const p = section.props
      if (p.imageSrc.trim()) {
        add('email.image', {
          image: { src: p.imageSrc, alt: p.imageAlt },
          width: null,
          align: 'center',
          radius: 12,
          mobileFullWidth: true,
          padding: pad(0, 0, 24),
        })
      }
      heading(p.eyebrow, 'h3', {
        color: 'token:primary',
        typography: {
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: 'uppercase',
          lineHeight: 1.5,
        },
        padding: pad(0, 0, 8),
      })
      heading(p.heading, 'h1')
      add('email.text', { html: p.body, align: 'left', padding: pad(0) })
      button(p.buttonLabel, p.buttonUrl, 'left')
      break
    }
    case 'text':
      heading(section.props.heading, 'h2')
      add('email.text', {
        html: section.props.body,
        align: 'left',
        padding: pad(0),
      })
      break
    case 'image': {
      const p = section.props
      add('email.image', {
        image: { src: p.imageSrc, alt: p.imageAlt },
        ...(p.linkUrl.trim() ? { link: url(p.linkUrl) } : {}),
        width: null,
        align: 'center',
        radius: 12,
        mobileFullWidth: true,
        padding: pad(0),
      })
      smallText(p.caption, 'center')
      break
    }
    case 'button':
      if (section.props.label.trim()) {
        button(section.props.label, section.props.url, 'center')
      } else {
        add('email.button', {
          label: '',
          link: url(section.props.url),
          align: 'center',
          backgroundColor: 'token:primary',
          textColor: 'token:on-primary',
          radius: 8,
          buttonPadding: pad(12, 24, 12),
          fullWidth: false,
          padding: pad(0),
        })
      }
      smallText(section.props.note, 'center')
      break
    case 'products':
      heading(section.props.heading, 'h2')
      for (const item of section.props.items) {
        add('email.product', {
          productId: null,
          name: item.name,
          description: item.description,
          price: item.price,
          oldPrice: item.oldPrice,
          image: { src: item.imageSrc, alt: item.imageAlt },
          link: url(item.url),
          buttonLabel: section.props.buttonLabel,
          layout: 'horizontal',
          accentColor: 'token:primary',
          padding: pad(0, 0, 12),
        })
      }
      break
    case 'features':
      heading(section.props.heading, 'h2')
      add('email.list', {
        items: section.props.items.map((item) => ({
          title: item.title,
          text: item.text,
        })),
        marker: 'number',
        markerColor: 'token:primary',
        padding: pad(0),
      })
      break
    case 'event': {
      const p = section.props
      add('email.event', {
        heading: p.heading,
        date: p.date,
        time: p.time,
        location: p.location,
        buttonLabel: p.buttonLabel,
        link: url(p.buttonUrl),
        backgroundColor: 'token:primary-soft',
        accentColor: 'token:primary',
        padding: pad(0),
      })
      break
    }
    case 'nps':
      add('email.nps', {
        question: section.props.question,
        lowLabel: section.props.lowLabel,
        highLabel: section.props.highLabel,
        link: url(section.props.url),
        accentColor: 'token:primary',
        padding: pad(0),
      })
      break
    case 'quote':
      add('email.quote', {
        text: section.props.text,
        author: section.props.author,
        role: section.props.role,
        accentColor: 'token:primary',
        padding: pad(0),
      })
      break
    case 'coupon':
      add('email.coupon', {
        label: section.props.label,
        code: section.props.code,
        expiry: section.props.expiry,
        accentColor: 'token:primary',
        padding: pad(0),
      })
      break
    case 'signature':
      add('email.signature', {
        closing: section.props.closing,
        name: section.props.name,
        role: section.props.role,
        contact: section.props.contact,
        photo: { src: '', alt: '' },
        align: 'left',
        padding: pad(0),
      })
      break
    case 'footer':
      break
  }
  return blocks
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** One v1 section as a v2 fragment (`email.section` → column → blocks). */
export function convertSection(
  section: EmailBuilderSection,
  prefix = section.id,
): CanvasFragment {
  const sectionId = `${prefix}-s`
  const columnId = `${prefix}-c`
  const blocks = sectionBlocks(section, prefix)
  const nodes: Nodes = {
    [sectionId]: {
      id: sectionId,
      type: SECTION,
      props: {
        ...defaultSectionProps(),
        ...(section.type === 'header' ? { padding: pad(32, 40, 8) } : {}),
      },
      children: [columnId],
      ...(section.hidden ? { meta: { hidden: true } } : {}),
    },
    [columnId]: {
      id: columnId,
      type: COLUMN,
      props: defaultColumnProps(),
      children: blocks.map((b) => b.id),
    },
  }
  for (const b of blocks) nodes[b.id] = b
  return { rootId: sectionId, nodes }
}

/** Converts a v1 document (already validated) to an e-mail canvas document. */
export function convertV1Document(v1: EmailBuilderDocument): CanvasDocument {
  const nodes: Nodes = {}
  const children: string[] = []
  let footerNote: string | null = null
  for (const section of v1.sections) {
    if (section.type === 'footer') {
      footerNote = section.props.note
      continue
    }
    const fragment = convertSection(section)
    Object.assign(nodes, fragment.nodes)
    children.push(fragment.rootId)
  }
  const footerId = 'footer'
  nodes[footerId] = {
    id: footerId,
    type: FOOTER,
    props: { ...defaultFooterProps(), note: footerNote ?? '' },
  }
  children.push(footerId)
  nodes[ROOT_ID] = {
    id: ROOT_ID,
    type: BODY,
    props: { ...defaultBodyProps(), preheader: v1.previewText },
    children,
  }
  return {
    catalog: EMAIL_CATALOG_ID,
    version: EMAIL_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes,
  }
}

/** A v2 document with a gallery layout's default content. */
export function createEmailDocumentFromLayout(
  layoutId: EmailBuilderLayoutId,
): CanvasDocument {
  return convertV1Document(createBuilderDocument(layoutId))
}

export function isEmailCanvasDocument(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { catalog?: unknown }).catalog === EMAIL_CATALOG_ID &&
    (value as { version?: unknown }).version === EMAIL_CATALOG_VERSION
  )
}

/**
 * What the editor opens: a v2 document as stored, a v1 document converted,
 * `null` for anything else. Does not validate a v2 document — run
 * `validateEmailDocument` when it comes from outside.
 */
export function openEmailDocument(stored: unknown): CanvasDocument | null {
  if (isEmailCanvasDocument(stored)) return stored as CanvasDocument
  const v1 = EmailBuilderDocumentSchema.safeParse(stored)
  return v1.success ? convertV1Document(v1.data) : null
}

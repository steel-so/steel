import { render } from '@react-email/render'
import type { ReactNode } from 'react'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import {
  emailHtmlToText,
  type RenderedEmail,
} from '@/src/lib/crm-email-builder/render'
import { createEmailCatalog, MSO_FONT_MARKER } from './catalog'
import {
  BODY,
  FOOTER,
  MSO_CLOSE_MARKER,
  MSO_OPEN_MARKER,
} from './components/layout'
import {
  applyConditionMarkers,
  CONDITION_CLOSE_ATTR,
  CONDITION_OPEN_ATTR,
  conditionMarkers,
  conditionOf,
} from './conditions'
import { collectMobileCss } from './mobile'
import type { EmailBodyProps } from './schemas'
import { createEmailRenderContext, type EmailProductData } from './theme'

/**
 * Final render of an e-mail canvas document: the very same catalog
 * components the editor shows, with `editing: false` — no `data-canvas-id`,
 * no hints, hidden nodes dropped — then `@react-email/render`. Variables stay
 * as `{{key}}`; per recipient, run `applyEmailConditions` ("Mostrar se")
 * and then `personalizeEmail`.
 */

/** Children in output order: the footer always closes the e-mail. */
export function orderedChildren(node: CanvasNode, doc: CanvasDocument) {
  const children = node.children ?? []
  if (node.type !== BODY) return children
  const footers = children.filter((id) => getNode(doc, id)?.type === FOOTER)
  return [...children.filter((id) => !footers.includes(id)), ...footers]
}

function NodeTree({
  doc,
  id,
  catalog,
}: {
  doc: CanvasDocument
  id: CanvasNodeId
  catalog: CanvasCatalog
}): ReactNode {
  const node = getNode(doc, id)
  if (!node || node.meta?.hidden) return null
  const definition = catalog.components[node.type]
  if (!definition) return null
  const children = orderedChildren(node, doc).map((child) => (
    <NodeTree key={child} doc={doc} id={child} catalog={catalog} />
  ))
  const output = definition.render({
    node,
    children,
    breakpoint: 'base',
    editing: false,
  })
  const condition = conditionOf(node)
  if (!condition || output == null) return output
  // "Mostrar se": markers around the node, evaluated per recipient.
  const markers = conditionMarkers(node.id, condition)
  return (
    <>
      <span {...{ [CONDITION_OPEN_ATTR]: markers.open }} />
      {output}
      <span {...{ [CONDITION_CLOSE_ATTR]: markers.close }} />
    </>
  )
}

const MSO_FONT_FALLBACK =
  '<!--[if mso]><style>body,table,td,th,p,a,span,div,h1,h2,h3{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->'

/** React cannot emit conditional comments: swap the markers the components
 * leave for Outlook's ghost table and font fallback. */
export function applyOutlookMarkers(html: string, width: number): string {
  return html
    .replace(
      new RegExp(`<span data-ec-mso="${MSO_OPEN_MARKER}"></span>`, 'g'),
      `<!--[if mso]><table role="presentation" width="${width}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
    )
    .replace(
      new RegExp(`<span data-ec-mso="${MSO_CLOSE_MARKER}"></span>`, 'g'),
      '<!--[if mso]></td></tr></table><![endif]-->',
    )
    .replace(
      new RegExp(`<meta name="${MSO_FONT_MARKER}" content=""\\s*/?>`, 'g'),
      MSO_FONT_FALLBACK,
    )
}

export type RenderEmailDocumentOptions = {
  brand: EmailBrand
  subject: string
  /** CRM products referenced by `email.product` blocks, by id. */
  products?: Record<string, EmailProductData>
  /** Newsletter issue: subscription footer (see `EmailRenderContext`). */
  subscription?: { newsletterName: string }
}

/** Renders a validated v2 document to e-mail HTML + plain text. */
export async function renderEmailDocument(
  doc: CanvasDocument,
  options: RenderEmailDocumentOptions,
): Promise<RenderedEmail> {
  const root = getNode(doc, doc.rootId) as CanvasNode
  const rootProps = root.props as EmailBodyProps
  const ctx = createEmailRenderContext({
    brand: options.brand,
    subject: options.subject,
    products: options.products,
    mobileCss: collectMobileCss(doc, rootProps.width),
    doc: () => doc,
    subscription: options.subscription,
  })
  const catalog = createEmailCatalog({ context: ctx })
  const element = catalog.renderDocument({
    children: <NodeTree doc={doc} id={doc.rootId} catalog={catalog} />,
    rootProps,
    editing: false,
  })
  const html = applyConditionMarkers(
    applyOutlookMarkers(await render(element), rootProps.width),
  )
  return { subject: options.subject, html, text: emailHtmlToText(html) }
}

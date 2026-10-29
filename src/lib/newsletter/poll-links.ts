import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { RenderedEmail } from '@/src/lib/crm-email-builder/render'

/**
 * Links of the "Enquete" e-mail block (`email.poll`, slice nl2-engage).
 *
 * The block renders each option with a placeholder href on a reserved
 * `.invalid` host (never resolvable, never `{{…}}` so the variable pass
 * leaves it alone). Per recipient, `applyPollLinks` swaps each placeholder
 * for that recipient's signed vote link; without a link builder (web
 * version, archive, test send, any non-newsletter e-mail) the placeholders
 * are stripped and the options stay as static, non-clickable buttons.
 */

export const POLL_BLOCK = 'email.poll'
export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 5

const MARKER_ORIGIN = 'https://enquete.steel.invalid'

export function pollMarkerHref(blockId: string, optionIndex: number): string {
  return `${MARKER_ORIGIN}/${blockId}/${optionIndex}`
}

const MARKER = /https:\/\/enquete\.steel\.invalid\/([A-Za-z0-9_-]+)\/(\d+)/g
const HREF_MARKER =
  / href="https:\/\/enquete\.steel\.invalid\/([A-Za-z0-9_-]+)\/(\d+)"/g
const TEXT_MARKER = / ?https:\/\/enquete\.steel\.invalid\/[A-Za-z0-9_-]+\/\d+/g

export type PollLinkBuilder = (blockId: string, optionIndex: number) => string

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** True when a rendered e-mail carries at least one poll option. */
export function hasPollLinks(html: string): boolean {
  return new RegExp(MARKER.source).test(html)
}

/**
 * Personal vote links (`link` given) or static options (no `link`): the
 * placeholder `href` is dropped from the HTML and the bare URL from the
 * plain-text part.
 */
export function applyPollLinks(
  email: RenderedEmail,
  link?: PollLinkBuilder,
): RenderedEmail {
  if (!hasPollLinks(email.html) && !hasPollLinks(email.text)) return email
  if (!link) {
    return {
      subject: email.subject,
      html: email.html.replace(HREF_MARKER, ''),
      text: email.text.replace(TEXT_MARKER, ''),
    }
  }
  const resolve = (_match: string, blockId: string, index: string) =>
    link(blockId, Number(index))
  return {
    subject: email.subject,
    html: email.html.replace(
      HREF_MARKER,
      (_match, blockId: string, index: string) =>
        ` href="${escapeAttribute(link(blockId, Number(index)))}"`,
    ),
    text: email.text.replace(MARKER, resolve),
  }
}

export type PollBlock = {
  blockId: string
  question: string
  options: string[]
  showResults: boolean
}

type PollProps = {
  question?: unknown
  options?: unknown
  showResults?: unknown
}

function toPollBlock(id: string, props: PollProps): PollBlock {
  const options = Array.isArray(props.options) ? props.options : []
  return {
    blockId: id,
    question: typeof props.question === 'string' ? props.question : '',
    options: options.map((option) =>
      typeof option === 'object' &&
      option !== null &&
      typeof (option as { label?: unknown }).label === 'string'
        ? (option as { label: string }).label
        : '',
    ),
    showResults: props.showResults !== false,
  }
}

/** Visible poll blocks of a document, in reading order. */
export function extractPolls(doc: CanvasDocument): PollBlock[] {
  const polls: PollBlock[] = []
  const stack = [doc.rootId]
  while (stack.length > 0) {
    const node = getNode(doc, stack.pop() as string)
    if (!node || node.meta?.hidden) continue
    if (node.type === POLL_BLOCK) {
      polls.push(toPollBlock(node.id, node.props as PollProps))
    }
    for (const child of [...(node.children ?? [])].reverse()) stack.push(child)
  }
  return polls
}

/** Public thank-you page of a vote. */
export function newsletterPollUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/newsletter/enquete/${token}`
}

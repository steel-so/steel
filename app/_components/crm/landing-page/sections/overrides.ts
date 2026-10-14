import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'

/**
 * Read/write helpers for the per-section `texts`/`hrefs` override maps
 * (see `SectionOverridesShape` in the section schema). Any copy or link the
 * Figma port renders that has no typed field goes through these, so every
 * visible text and link in a template stays editable:
 *
 *   <GhostInput
 *     value={textOf(content, 'badge', 'New Invitation!')}
 *     onCommit={(v) => onChange?.(withText(content, 'badge', v))}
 *     readOnly={readOnly}
 *   />
 *
 * The fallback is the template's original copy — what the page shows until
 * the user edits it. Committing an empty string keeps the slot empty (the
 * user deleted the text on purpose); it does not bring the default back.
 */

type Overridable = Pick<CrmLandingPageSectionContent, 'texts' | 'hrefs'>

export function textOf(
  content: Overridable,
  key: string,
  fallback: string,
): string {
  return content.texts?.[key] ?? fallback
}

export function withText<T extends Overridable>(
  content: T,
  key: string,
  value: string,
): T {
  return { ...content, texts: { ...content.texts, [key]: value } }
}

export function hrefOf(
  content: Overridable,
  key: string,
  fallback = '#',
): string {
  return content.hrefs?.[key] ?? fallback
}

export function withHref<T extends Overridable>(
  content: T,
  key: string,
  value: string,
): T {
  return { ...content, hrefs: { ...content.hrefs, [key]: value } }
}

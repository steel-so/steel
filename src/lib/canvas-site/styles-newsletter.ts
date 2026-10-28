import { resolveColor, spacingToCss } from '@/src/lib/canvas/values'
import { SITE_TYPES } from './constants'
import type {
  SiteNewsletterIssuesProps,
  SiteNewsletterSubscribeProps,
} from './schemas-newsletter'
import type { Resolved, SiteRuleSet, SiteStyleFn } from './styles'

/**
 * Style functions of the newsletter elements (same contract as
 * `styles.ts`). Their structural CSS is the `NEWSLETTER` block of
 * `static-css-elements.ts`.
 */

const color = (value: string | undefined) => resolveColor(value)

const subscribe = (p: Resolved<SiteNewsletterSubscribeProps>): SiteRuleSet => {
  const inline = p.layout === 'inline'
  return {
    '': {
      'grid-template-columns': 'minmax(0, 1fr)',
      margin: spacingToCss(p.margin),
    },
    ' .s-nl-row': {
      'flex-direction': inline ? 'row' : 'column',
      'align-items': inline ? 'flex-end' : 'stretch',
    },
    ' .s-input': { 'background-color': color(p.fieldBackground) },
  }
}

const issues = (p: Resolved<SiteNewsletterIssuesProps>): SiteRuleSet => ({
  '': { margin: spacingToCss(p.margin) },
  ' .s-nl-items': {
    'grid-template-columns':
      p.layout === 'cards'
        ? `repeat(${p.columns}, minmax(0, 1fr))`
        : 'minmax(0, 1fr)',
  },
  ' .s-nl-number': { color: color(p.accentColor) },
  ' .s-nl-card': {
    'background-color':
      p.layout === 'cards' ? color(p.cardBackground) : undefined,
  },
})

export const NEWSLETTER_STYLE_FNS: Record<string, SiteStyleFn> = {
  [SITE_TYPES.newsletterSubscribe]: subscribe as SiteStyleFn,
  [SITE_TYPES.newsletterIssues]: issues as SiteStyleFn,
}

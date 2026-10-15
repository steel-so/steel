import {
  borderToCss,
  radiusToCss,
  resolveColor,
  shadowToCss,
  sizeToCss,
  spacingToCss,
} from '@/src/lib/canvas/values'
import { SITE_ROOT_CLASS, SITE_TYPES } from './constants'
import type {
  SiteBlogSearchProps,
  SiteCollectionFieldProps,
  SiteCollectionListProps,
  SitePostAuthorProps,
  SitePostListProps,
  SitePostProps,
  SitePostTermsProps,
} from './schemas-cms'
import type { Resolved, SiteDecls, SiteRuleSet, SiteStyleFn } from './styles'

/**
 * Style functions and structural CSS of the blog and collection elements
 * (same contract as `styles-elements.ts` / `static-css-elements.ts`).
 */

const margin = (value: Parameters<typeof spacingToCss>[0]): SiteDecls => ({
  margin: spacingToCss(value),
})
const columns = (count: number) => `repeat(${count}, minmax(0, 1fr))`

const SELF_ALIGN = {
  left: { 'margin-left': '0', 'margin-right': 'auto' },
  center: { 'margin-left': 'auto', 'margin-right': 'auto' },
  right: { 'margin-left': 'auto', 'margin-right': '0' },
} as const

function card(p: {
  radius?: Parameters<typeof radiusToCss>[0]
  border?: Parameters<typeof borderToCss>[0]
  shadow?: Parameters<typeof shadowToCss>[0]
  background?: string
}): SiteDecls {
  return {
    'border-radius': radiusToCss(p.radius),
    border: borderToCss(p.border),
    'box-shadow': shadowToCss(p.shadow),
    'background-color': resolveColor(p.background),
  }
}

function listRules(p: {
  layout: string
  columns: number
  gap: number
  aspectRatio: string
  radius?: SitePostListProps['radius']
  border?: SitePostListProps['border']
  shadow?: SitePostListProps['shadow']
  background?: string
  margin?: Parameters<typeof spacingToCss>[0]
}): SiteRuleSet {
  const grid = p.layout !== 'list'
  return {
    '': { ...margin(p.margin) },
    ' .s-plist-items': {
      gap: `${p.gap}px`,
      'grid-template-columns': grid ? columns(p.columns) : undefined,
    },
    ' .s-pcard': card(p),
    ' .s-pcard-media img': {
      'aspect-ratio': p.aspectRatio === 'auto' ? undefined : p.aspectRatio,
    },
  }
}

const postList = (p: Resolved<SitePostListProps>): SiteRuleSet => listRules(p)

const collectionList = (p: Resolved<SiteCollectionListProps>): SiteRuleSet =>
  listRules({ ...p, layout: p.layout === 'grid' ? 'cards' : 'list' })

const post = (p: Resolved<SitePostProps>): SiteRuleSet => ({
  '': { ...margin(p.margin) },
  ' > *': {
    'max-width': sizeToCss(p.maxWidth),
    ...(p.align ? SELF_ALIGN[p.align] : {}),
  },
})

const postTerms = (p: Resolved<SitePostTermsProps>): SiteRuleSet => ({
  '': { ...margin(p.margin) },
  ' ul': { gap: p.gap === undefined ? undefined : `${p.gap}px` },
})

const blogSearch = (p: Resolved<SiteBlogSearchProps>): SiteRuleSet => ({
  '': { 'max-width': sizeToCss(p.maxWidth), ...margin(p.margin) },
})

const postAuthor = (p: Resolved<SitePostAuthorProps>): SiteRuleSet => ({
  '': { ...card(p), ...margin(p.margin) },
})

const collectionField = (
  p: Resolved<SiteCollectionFieldProps>,
): SiteRuleSet => ({
  '': {
    'text-align': p.align,
    color: resolveColor(p.color),
    ...margin(p.margin),
  },
})

export const CMS_STYLE_FNS: Record<string, SiteStyleFn> = {
  [SITE_TYPES.postList]: postList as SiteStyleFn,
  [SITE_TYPES.post]: post as SiteStyleFn,
  [SITE_TYPES.postTerms]: postTerms as SiteStyleFn,
  [SITE_TYPES.blogSearch]: blogSearch as SiteStyleFn,
  [SITE_TYPES.postAuthor]: postAuthor as SiteStyleFn,
  [SITE_TYPES.collectionList]: collectionList as SiteStyleFn,
  [SITE_TYPES.collectionField]: collectionField as SiteStyleFn,
}

// ─── structural CSS ───────────────────────────────────────────────────────

const r = `.${SITE_ROOT_CLASS}`

const SHARED = [
  `${r} .s-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,
  `${r} .s-pmeta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;margin:0;font-size:14px;color:var(--canvas-muted)}`,
  `${r} .s-pmeta a{color:inherit;font-weight:600}`,
  `${r} .s-pcats,${r} .s-ptags{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}`,
  `${r} .s-pcats a,${r} .s-ptags a{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--canvas-surface);color:var(--canvas-primary);font-size:13px;font-weight:600;text-decoration:none}`,
  `${r} .s-ptags a::before{content:"#"}`,
]

const LIST = [
  `${r} .s-plist{display:flex;flex-direction:column;gap:32px}`,
  `${r} .s-plist-head{display:flex;flex-direction:column;gap:8px}`,
  `${r} .s-plist-head>*{margin:0}`,
  `${r} .s-plist-head p{color:var(--canvas-muted)}`,
  `${r} .s-plist-items{display:grid;list-style:none;margin:0;padding:0}`,
  `${r} .s-plist-items>li{display:flex;min-width:0}`,
  `${r} .s-pcard{display:flex;flex:1;flex-direction:column;min-width:0;overflow:hidden}`,
  `${r} .s-pcard-media{display:block;overflow:hidden}`,
  `${r} .s-pcard-media img{display:block;width:100%;height:auto;object-fit:cover;transition:transform .3s}`,
  `${r} .s-pcard:hover .s-pcard-media img{transform:scale(1.03)}`,
  `${r} .s-pcard-body{display:flex;flex:1;flex-direction:column;gap:10px;padding:16px 0 0}`,
  `${r} .s-pcard-title{margin:0;font-family:var(--s-font-heading);font-size:22px;line-height:1.3}`,
  `${r} .s-pcard-title a{color:inherit;text-decoration:none}`,
  `${r} .s-pcard-title a:hover{text-decoration:underline}`,
  `${r} .s-pcard-excerpt{margin:0;color:var(--canvas-muted)}`,
  `${r} .s-plist-cards .s-pcard{border:1px solid var(--canvas-border);border-radius:var(--s-radius-lg);background:var(--canvas-background)}`,
  `${r} .s-plist-cards .s-pcard-body{padding:20px}`,
  `${r} .s-plist-list .s-plist-items{grid-template-columns:1fr}`,
  `${r} .s-plist-list .s-pcard{flex-direction:row;gap:24px}`,
  `${r} .s-plist-list .s-pcard-media{flex:0 0 38%}`,
  `${r} .s-plist-list .s-pcard-body{padding:0}`,
  `${r} .s-pcard-lead .s-pcard-title{font-size:32px}`,
  `${r} .s-plist-items>li:has(.s-pcard-lead){grid-column:1/-1}`,
  `${r} .s-plist-grid .s-pcard-lead,${r} .s-plist-cards .s-pcard-lead{flex-direction:row;gap:32px}`,
  `${r} .s-plist-grid .s-pcard-lead .s-pcard-media,${r} .s-plist-cards .s-pcard-lead .s-pcard-media{flex:0 0 55%}`,
  `${r} .s-plist-empty{margin:0;color:var(--canvas-muted)}`,
  `${r} .s-ccard-btn{align-self:flex-start;margin-top:auto}`,
  `${r} .s-pager{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 16px}`,
  `${r} .s-pager ol{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0}`,
  `${r} .s-pager a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 12px;border:1px solid var(--canvas-border);border-radius:var(--s-radius-sm);color:inherit;text-decoration:none}`,
  `${r} .s-pager a[aria-current=page]{background:var(--canvas-primary);border-color:var(--canvas-primary);color:var(--canvas-inverse);font-weight:700}`,
  `@media (max-width:767.98px){${r} .s-plist-list .s-pcard,${r} .s-plist-grid .s-pcard-lead,${r} .s-plist-cards .s-pcard-lead{flex-direction:column;gap:0}${r} .s-plist-list .s-pcard-body{padding:16px 0 0}${r} .s-pcard-lead .s-pcard-title{font-size:24px}}`,
]

const POST = [
  `${r} .s-post{display:flex;flex-direction:column;gap:32px;width:100%}`,
  `${r} .s-post>*{width:100%;margin-left:auto;margin-right:auto}`,
  `${r} .s-post-head{display:flex;flex-direction:column;gap:16px}`,
  `${r} .s-post-head>*{margin:0}`,
  `${r} .s-post-cover{margin:0}`,
  `${r} .s-post-cover img{display:block;width:100%;height:auto;border-radius:var(--s-radius-lg)}`,
  `${r} .s-post-body{font-size:18px;line-height:1.75;overflow-wrap:break-word}`,
  `${r} .s-post-body>*{margin:0 0 1.2em}`,
  `${r} .s-post-body h2,${r} .s-post-body h3,${r} .s-post-body h4,${r} .s-post-body h5,${r} .s-post-body h6{margin:1.8em 0 .6em;font-family:var(--s-font-heading);line-height:1.25;scroll-margin-top:96px}`,
  `${r} .s-post-body h2{font-size:1.75em}`,
  `${r} .s-post-body h3{font-size:1.4em}`,
  `${r} .s-post-body h4{font-size:1.2em}`,
  `${r} .s-post-body ul,${r} .s-post-body ol{padding-left:1.4em}`,
  `${r} .s-post-body li{margin:.3em 0}`,
  `${r} .s-post-body li>ul,${r} .s-post-body li>ol{margin:.3em 0}`,
  `${r} .s-post-body .s-todo{list-style:none;padding-left:0}`,
  `${r} .s-post-body a{color:var(--canvas-primary)}`,
  `${r} .s-post-body blockquote{padding:4px 0 4px 20px;border-left:4px solid var(--canvas-primary);font-style:italic;color:var(--canvas-muted)}`,
  `${r} .s-post-body code{padding:.15em .4em;border-radius:6px;background:var(--canvas-surface);font-size:.9em}`,
  `${r} .s-post-body pre{overflow:auto;padding:16px 20px;border-radius:var(--s-radius-md);background:#0f172a;color:#e2e8f0;font-size:15px;line-height:1.6}`,
  `${r} .s-post-body pre code{padding:0;background:none;color:inherit}`,
  `${r} .s-post-body mark{background:#fef08a;color:inherit}`,
  `${r} .s-post-body hr{border:0;border-top:1px solid var(--canvas-border);margin:2em 0}`,
  `${r} .s-post-figure{margin:1.6em 0}`,
  `${r} .s-post-figure img{display:block;max-width:100%;height:auto;margin:0 auto;border-radius:var(--s-radius-md)}`,
  `${r} .s-post-figure figcaption{margin-top:8px;text-align:center;font-size:14px;color:var(--canvas-muted)}`,
  `${r} .s-post-embed{position:relative;aspect-ratio:16/9;margin:1.6em 0;overflow:hidden;border-radius:var(--s-radius-md);background:#000}`,
  `${r} .s-post-embed>iframe,${r} .s-post-embed>video{position:absolute;inset:0;width:100%;height:100%;border:0}`,
  `${r} .s-post-table{overflow-x:auto}`,
  `${r} .s-post-table table{width:100%;border-collapse:collapse;font-size:16px}`,
  `${r} .s-post-table th,${r} .s-post-table td{padding:10px 12px;border:1px solid var(--canvas-border);text-align:left;vertical-align:top}`,
  `${r} .s-post-table th{background:var(--canvas-surface)}`,
  `${r} .s-post-table td>*:last-child,${r} .s-post-table th>*:last-child{margin-bottom:0}`,
  `${r} .s-callout{display:flex;gap:12px;padding:16px 20px;border-radius:var(--s-radius-md);background:var(--canvas-surface);border-left:4px solid var(--canvas-primary)}`,
  `${r} .s-callout-warning{border-left-color:#d97706}`,
  `${r} .s-callout-success{border-left-color:#16a34a}`,
  `${r} .s-callout-error{border-left-color:#dc2626}`,
  `${r} .s-callout>div>*:last-child{margin-bottom:0}`,
  `${r} .s-post-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}`,
  `${r} .s-post-toc{padding:16px 20px;border:1px solid var(--canvas-border);border-radius:var(--s-radius-md)}`,
  `${r} .s-post-toc ol{margin:0;padding-left:1.2em}`,
  `${r} .s-post-toc .s-toc-3{margin-left:1em}`,
  `${r} .s-post-toc .s-toc-4,${r} .s-post-toc .s-toc-5,${r} .s-post-toc .s-toc-6{margin-left:2em}`,
  `${r} .s-al-center{text-align:center}`,
  `${r} .s-al-right{text-align:right}`,
  `${r} .s-al-justify{text-align:justify}`,
  `${r} .s-post-faq{display:flex;flex-direction:column;gap:12px}`,
  `${r} .s-post-faq h2{margin:0 0 8px;font-family:var(--s-font-heading)}`,
  `${r} .s-post-faq details{padding:14px 18px;border:1px solid var(--canvas-border);border-radius:var(--s-radius-md)}`,
  `${r} .s-post-faq summary{cursor:pointer;font-weight:600}`,
  `${r} .s-post-faq details p{margin:10px 0 0}`,
  `@media (max-width:767.98px){${r} .s-post-body{font-size:17px}}`,
]

const TERMS = [
  `${r} .s-pterms-title{margin:0 0 12px;font-weight:700}`,
  `${r} .s-pterms ul{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}`,
  `${r} .s-pterms a{color:inherit;text-decoration:none}`,
  `${r} .s-pterms a:hover{color:var(--canvas-primary)}`,
  `${r} .s-pterms-count{color:var(--canvas-muted)}`,
  `${r} .s-pterms-chips ul{flex-direction:row;flex-wrap:wrap}`,
  `${r} .s-pterms-chips a{display:inline-block;padding:6px 14px;border:1px solid var(--canvas-border);border-radius:999px;font-size:14px}`,
]

const SEARCH = [
  `${r} .s-bsearch{display:flex;gap:8px;width:100%}`,
  `${r} .s-bsearch .s-input{flex:1;min-width:0}`,
]

const AUTHOR = [
  `${r} .s-author{display:flex;gap:16px;padding:20px;border-radius:var(--s-radius-lg);background:var(--canvas-surface)}`,
  `${r} .s-author-column{flex-direction:column;align-items:center;text-align:center}`,
  `${r} .s-author-photo{flex:none;width:72px;height:72px;border-radius:50%;object-fit:cover}`,
  `${r} .s-author-body{display:flex;flex-direction:column;gap:6px;min-width:0}`,
  `${r} .s-author-body>p{margin:0}`,
  `${r} .s-author-name{font-weight:700;font-size:18px}`,
  `${r} .s-author-name a{color:inherit;text-decoration:none}`,
  `${r} .s-author-bio{color:var(--canvas-muted)}`,
  `${r} .s-author-links{gap:10px}`,
  `${r} .s-author-links svg{width:20px;height:20px}`,
  `${r} .s-author-column .s-author-links{justify-content:center}`,
]

const FIELD = [
  `${r} .s-cfield-label{font-weight:600}`,
  `${r} .s-cfield-image img{display:block;max-width:100%;height:auto;border-radius:var(--s-radius-md)}`,
]

const BY_TYPE: Array<[string[], string[]]> = [
  [[SITE_TYPES.postList, SITE_TYPES.collectionList], LIST],
  [[SITE_TYPES.post], POST],
  [[SITE_TYPES.postTerms], TERMS],
  [[SITE_TYPES.blogSearch], SEARCH],
  [[SITE_TYPES.postAuthor], AUTHOR],
  [[SITE_TYPES.collectionField], FIELD],
]

const ALL = BY_TYPE.flatMap(([types]) => types)

/** Structural rules of the blog/collection elements the page uses (`''`
 * when none). */
export function cmsCss(types: Set<string>): string {
  if (!ALL.some((type) => types.has(type))) return ''
  const rules = [...SHARED]
  for (const [list, block] of BY_TYPE) {
    if (list.some((type) => types.has(type))) rules.push(...block)
  }
  return rules.join('\n')
}

import { SITE_MEDIA, SITE_RANGE, SITE_ROOT_CLASS } from './constants'

/**
 * Rules shared by every site, independent of the document and the theme:
 * the structural part of each component (node classes only carry what the
 * props change), the per-breakpoint visibility utilities and the menu's
 * hamburger. `EDITOR_CSS` is added only inside the editor canvas.
 */

const r = `.${SITE_ROOT_CLASS}`

const COMPONENTS = [
  `${r} .s-inner{position:relative;display:flex;flex-direction:column;margin-left:auto;margin-right:auto}`,
  `${r} .s-bg-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;pointer-events:none}`,
  `${r} .s-rich{overflow-wrap:break-word}`,
  `${r} .s-btn-icon{width:1.15em;height:1.15em;flex:none}`,
  `${r} .s-media{display:block;max-width:100%}`,
  `${r} .s-caption{margin-top:8px;color:var(--canvas-muted)}`,
  `${r} .s-icon-box{display:inline-flex;align-items:center;justify-content:center;flex:none}`,
  `${r} .s-video-frame{position:relative;overflow:hidden;background:#000;width:100%}`,
  `${r} .s-video-frame>iframe,${r} .s-video-frame>video{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover}`,
  `${r} .s-list{list-style:none;padding:0}`,
  `${r} .s-list>li{display:flex;align-items:flex-start;gap:.6em}`,
  `${r} .s-list .s-marker{flex:none;display:inline-flex;width:1.25em;height:1.25em;margin-top:.2em}`,
  `${r} .s-list .s-marker>svg{width:100%;height:100%}`,
  `${r} .s-list-dot>li::before{content:"";flex:none;width:.45em;height:.45em;margin-top:.65em;border-radius:50%;background:currentColor}`,
  `${r} .s-list-number{counter-reset:s-li}`,
  `${r} .s-list-number>li{counter-increment:s-li}`,
  `${r} .s-list-number>li::before{content:counter(s-li) ".";flex:none;min-width:1.4em;font-weight:700}`,
  `${r} .s-form{display:grid;gap:16px}`,
  `${r} .s-field{display:flex;flex-direction:column;gap:6px;min-width:0}`,
  `${r} .s-field-wide,${r} .s-form-actions,${r} .s-form-status,${r} .s-form-empty{grid-column:1/-1}`,
  `${r} .s-label{font-size:14px;font-weight:600}`,
  `${r} .s-input{width:100%;padding:12px 14px;border:1px solid var(--canvas-border);border-radius:var(--s-radius-sm);background:var(--canvas-background);color:var(--canvas-text);font-size:16px;line-height:1.4}`,
  `${r} textarea.s-input{min-height:120px;resize:vertical}`,
  `${r} .s-check{display:flex;align-items:flex-start;gap:10px;font-size:15px}`,
  `${r} .s-check>input{width:18px;height:18px;margin-top:2px;accent-color:var(--canvas-primary)}`,
  `${r} .s-form-actions{display:flex}`,
  `${r} .s-form-status{font-size:15px}`,
  `${r} .s-form-status[data-state=error]{color:var(--canvas-accent)}`,
  `${r} .s-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}`,
  `${r} .s-form-empty{padding:16px;border:1px dashed var(--canvas-border);border-radius:var(--s-radius-sm);color:var(--canvas-muted);font-size:14px}`,
  `${r} .s-menu{position:relative}`,
  `${r} .s-menu-list{display:flex;list-style:none;margin:0;padding:0}`,
  `${r} .s-menu-link{display:inline-block;padding:6px 0;color:inherit;text-decoration:none}`,
  `${r} .s-menu-link[aria-current=page]{font-weight:700}`,
  `${r} .s-menu-burger{display:none}`,
  `${r} .s-menu-burger>summary{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;cursor:pointer;list-style:none;border-radius:var(--s-radius-sm)}`,
  `${r} .s-menu-burger>summary::-webkit-details-marker{display:none}`,
  `${r} .s-menu-burger>summary>svg{width:26px;height:26px}`,
  `${r} .s-menu-burger .s-menu-list{position:absolute;top:100%;right:0;z-index:50;flex-direction:column;gap:4px;min-width:220px;padding:12px 20px;background:var(--canvas-background);color:var(--canvas-text);border-radius:var(--s-radius-md);box-shadow:var(--s-shadow-md)}`,
  `${r} .s-social{display:flex;flex-wrap:wrap;list-style:none;padding:0}`,
  `${r} .s-social a{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}`,
  `${r} .s-embed iframe{display:block;width:100%;border:0}`,
]

function collapse(name: 'tablet' | 'mobile') {
  return `@media ${SITE_MEDIA[name]}{${r} .s-menu-collapse-${name} .s-menu-inline{display:none}${r} .s-menu-collapse-${name} .s-menu-burger{display:block}}`
}

function visibility(editing: boolean) {
  const hidden = editing
    ? 'opacity:.35;background-image:repeating-linear-gradient(135deg,transparent 0 6px,rgba(0,0,0,.06) 6px 12px)'
    : 'display:none!important'
  return (['base', 'tablet', 'mobile'] as const).map(
    (bp) => `@media ${SITE_RANGE[bp]}{${r} .s-hide-${bp}{${hidden}}}`,
  )
}

/** Structural CSS of the components (+ visibility utilities). */
export function staticCss(editing: boolean): string {
  return [
    ...COMPONENTS,
    collapse('tablet'),
    collapse('mobile'),
    ...visibility(editing),
  ].join('\n')
}

/** Editor-only affordances (empty slots, a minimum size to drop into). */
export const EDITOR_CSS = [
  `${r} .s-empty{display:flex;align-items:center;justify-content:center;min-height:72px;padding:16px;border:1.5px dashed #c7c7d1;border-radius:8px;background:rgba(244,244,245,.6);color:#71717a;font:500 13px/1.4 system-ui,sans-serif;text-align:center}`,
  `${r} .s-placeholder{display:flex;align-items:center;justify-content:center;min-height:160px;width:100%;border-radius:8px;background:#f4f4f5;color:#71717a;font:500 13px/1.4 system-ui,sans-serif;text-align:center}`,
  `${r} .s-embed-preview{pointer-events:none}`,
].join('\n')

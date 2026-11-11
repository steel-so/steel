import type { DocumentSettingsDTO } from '@/src/schemas/document.schema'
import type { DocumentRenderMode } from './context'
import {
  DOCUMENT_COLOR_IDS,
  type DocumentTheme,
  documentFontStack,
  documentPageBox,
} from './theme'

/**
 * Stylesheet of the `document` catalog. Components carry semantic classes
 * (`d-*`) plus inline styles for what the user set on the node; this sheet
 * holds the theme (CSS variables, `var(--canvas-<token>)` for the palette),
 * the structural rules (columns stacking under 640 px, grids, forms, the
 * pricing table), the paged sheet of the editor and the print rules of the
 * PDF (`@page`, page breaks). Every rule is scoped to `.d-root`, so the
 * public link can live inside the app page.
 */

export type DocumentLayoutSettings = Pick<
  DocumentSettingsDTO,
  'layout' | 'pageSize' | 'orientation'
>

export interface DocumentCssOptions {
  mode: DocumentRenderMode
  settings: DocumentLayoutSettings
  /** The first section is a cover: the PDF prints it edge to edge. */
  coverFirst?: boolean
}

/** Classes of the wrapper every render puts around the document. */
export function documentRootClass(
  mode: DocumentRenderMode,
  settings: DocumentLayoutSettings,
): string {
  const layout = settings.layout === 'paged' ? 'paged' : 'web'
  return `d-root d-mode-${mode} d-layout-${layout}`
}

const round = (value: number) => Math.round(value * 10) / 10

function themeVariables(theme: DocumentTheme): string {
  const scale = theme.headingScale
  const base = theme.baseSize
  const vars: Array<[string, string]> = []
  for (const id of DOCUMENT_COLOR_IDS) {
    vars.push([`--canvas-${id}`, theme.colors[id]])
  }
  vars.push(
    ['--d-font-heading', documentFontStack(theme.fonts.heading)],
    ['--d-font-body', documentFontStack(theme.fonts.body)],
    ['--d-base', `${base}px`],
    ['--d-lh', String(theme.lineHeight)],
    ['--d-h1', `${round(base * scale ** 4)}px`],
    ['--d-h2', `${round(base * scale ** 3)}px`],
    ['--d-h3', `${round(base * scale ** 2)}px`],
    ['--d-h4', `${round(base * scale)}px`],
    ['--d-section-y', `${theme.sectionSpacing}px`],
    ['--d-gap', `${theme.blockSpacing}px`],
    ['--d-radius', `${theme.radius}px`],
    ['--d-width', `${theme.contentWidth}px`],
    ['--d-margin', `${theme.pageMargin}mm`],
  )
  return vars.map(([name, value]) => `${name}:${value};`).join('')
}

function mobileVariables(theme: DocumentTheme): string {
  const base = theme.baseSize
  const scale = theme.headingScale
  const h1 = Math.max(base * 1.9, base * scale ** 4 * 0.8)
  const h2 = Math.max(base * 1.6, base * scale ** 3 * 0.85)
  const section = Math.min(theme.sectionSpacing, 40)
  return `--d-h1:${round(h1)}px;--d-h2:${round(h2)}px;--d-section-y:${section}px;`
}

const CHECK_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E\")"

const BASE_CSS = `
.d-root{box-sizing:border-box;color:var(--canvas-text);background:var(--canvas-surface);font-family:var(--d-font-body);font-size:var(--d-base);line-height:var(--d-lh);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;--d-heading-color:var(--canvas-heading);--d-muted:var(--canvas-muted)}
.d-root *,.d-root *::before,.d-root *::after{box-sizing:border-box}
.d-root img{max-width:100%;height:auto}
.d-root .d-doc{position:relative;display:flow-root;background:var(--canvas-surface)}
.d-root .d-section{position:relative;padding:var(--d-section-y) 24px}
.d-root .d-section-inner{display:flex;flex-direction:column;gap:var(--d-gap);max-width:var(--d-width);margin:0 auto;width:100%}
.d-root .d-section--highlight{background:var(--canvas-highlight)}
.d-root .d-section--cover{display:flex;flex-direction:column;justify-content:center;min-height:min(78vh,760px);color:var(--canvas-inverse);background:linear-gradient(140deg,var(--canvas-primary) 0%,var(--canvas-secondary) 100%);--d-heading-color:var(--canvas-inverse);--d-muted:color-mix(in srgb,var(--canvas-inverse) 78%,transparent)}
.d-root .d-section--cover .d-h1{font-size:calc(var(--d-h1) * 1.3);letter-spacing:-0.03em}
.d-root .d-section--cover .d-text a{color:inherit}
.d-root .d-end{height:1px}

.d-root .d-heading{display:flex;flex-direction:column}
.d-root .d-h{margin:0;font-family:var(--d-font-heading);color:var(--d-heading-color);font-weight:700;line-height:1.2;letter-spacing:-0.015em;text-wrap:balance;overflow-wrap:break-word}
.d-root .d-h1{font-size:var(--d-h1);line-height:1.08;letter-spacing:-0.025em}
.d-root .d-h2{font-size:var(--d-h2);line-height:1.15}
.d-root .d-h3{font-size:var(--d-h3);font-weight:650}
.d-root .d-h4{font-size:var(--d-h4);font-weight:600}
.d-root .d-eyebrow{display:block;margin-bottom:.7em;font-family:var(--d-font-body);font-size:.75rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--canvas-primary)}
.d-root .d-section--cover .d-eyebrow{color:inherit;opacity:.85}

.d-root .d-text{margin:0;overflow-wrap:break-word}
.d-root .d-text p{margin:0 0 .8em}
.d-root .d-text p:last-child,.d-root .d-text ul:last-child,.d-root .d-text ol:last-child{margin-bottom:0}
.d-root .d-text ul,.d-root .d-text ol{margin:0 0 .8em;padding-left:1.4em}
.d-root .d-text li{margin:.2em 0}
.d-root .d-text a{color:var(--canvas-primary);text-decoration:underline;text-underline-offset:2px}
.d-root .d-text--sm{font-size:.875em;color:var(--d-muted)}
.d-root .d-text--lg{font-size:1.2em;line-height:1.55}

.d-root .d-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.6em}
.d-root .d-list li{position:relative;padding-left:1.8em}
.d-root .d-list--bullet li::before{content:"";position:absolute;left:.45em;top:.66em;width:.42em;height:.42em;border-radius:50%;background:var(--d-marker,var(--canvas-primary))}
.d-root .d-list--number{counter-reset:d-list}
.d-root .d-list--number li{counter-increment:d-list}
.d-root .d-list--number li::before{content:counter(d-list);position:absolute;left:0;top:.18em;display:flex;align-items:center;justify-content:center;width:1.4em;height:1.4em;border-radius:50%;background:color-mix(in srgb,var(--d-marker,var(--canvas-primary)) 13%,transparent);color:var(--d-marker,var(--canvas-primary));font-size:.8em;font-weight:700;line-height:1}
.d-root .d-list--check li::before{content:"";position:absolute;left:0;top:.24em;width:1.15em;height:1.15em;border-radius:50%;background:var(--d-marker,var(--canvas-primary)) ${CHECK_ICON} center/72% no-repeat}

.d-root .d-quote{margin:0;padding:.2em 0 .2em 1.25em;border-left:3px solid var(--canvas-primary)}
.d-root .d-quote p{margin:0;font-size:1.15em;line-height:1.55;font-style:italic;color:var(--d-heading-color)}
.d-root .d-quote--lg{border-left:0;padding:0}
.d-root .d-quote--lg p{font-size:1.5em;font-style:normal;font-weight:500;letter-spacing:-0.01em;line-height:1.4}
.d-root .d-quote--lg p::before{content:"\\201C";display:block;height:.55em;font-size:2.4em;line-height:1;color:var(--canvas-primary)}
.d-root .d-quote footer{margin-top:.8em;font-size:.875em;color:var(--d-muted)}
.d-root .d-quote footer strong{color:var(--d-heading-color);font-weight:600}

.d-root .d-callout{display:flex;gap:.85em;padding:1em 1.15em;border-radius:var(--d-radius);border:1px solid var(--d-tone-border);background:var(--d-tone-bg);break-inside:avoid;--d-tone:var(--canvas-primary);--d-tone-bg:color-mix(in srgb,var(--d-tone) 8%,var(--canvas-surface));--d-tone-border:color-mix(in srgb,var(--d-tone) 24%,transparent)}
.d-root .d-callout--success{--d-tone:#15803d}
.d-root .d-callout--warning{--d-tone:#b45309}
.d-root .d-callout--neutral{--d-tone:var(--canvas-muted)}
.d-root .d-callout-icon{flex:none;display:inline-flex;width:1.3em;height:1.3em;margin-top:.12em;color:var(--d-tone)}
.d-root .d-callout-icon svg{width:100%;height:100%}
.d-root .d-callout-body{min-width:0;white-space:pre-line}
.d-root .d-callout-title{display:block;margin-bottom:.15em;font-weight:650;color:var(--d-heading-color)}

.d-root .d-table-wrap{overflow-x:auto;border:1px solid var(--canvas-border);border-radius:var(--d-radius)}
.d-root .d-table{width:100%;border-collapse:collapse;font-size:.93em}
.d-root .d-table th,.d-root .d-table td{padding:.7em .95em;text-align:left;vertical-align:top;border-bottom:1px solid var(--canvas-border)}
.d-root .d-table tbody tr:last-child td{border-bottom:0}
.d-root .d-table th{background:color-mix(in srgb,var(--canvas-primary) 6%,var(--canvas-surface));color:var(--d-heading-color);font-weight:600}
.d-root .d-table--striped tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--canvas-border) 32%,transparent)}
.d-root .d-table--compact th,.d-root .d-table--compact td{padding:.45em .7em}
.d-root .d-table tr{break-inside:avoid}

.d-root .d-btn-wrap{display:flex}
.d-root .d-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:2.75em;padding:.65em 1.4em;border-radius:var(--d-radius);border:1.5px solid transparent;font:inherit;font-weight:600;line-height:1.2;text-decoration:none;cursor:pointer;transition:filter .15s ease,background-color .15s ease}
.d-root .d-btn--primary{background:var(--canvas-primary);color:var(--canvas-inverse)}
.d-root .d-btn--secondary{background:color-mix(in srgb,var(--canvas-primary) 10%,var(--canvas-surface));color:var(--canvas-primary)}
.d-root .d-btn--outline{border-color:currentColor;background:transparent;color:var(--canvas-primary)}
.d-root .d-btn--ghost{background:transparent;color:var(--d-muted)}
.d-root .d-btn:hover{filter:brightness(1.07)}
.d-root .d-btn:focus-visible{outline:2px solid var(--canvas-primary);outline-offset:2px}
.d-root .d-btn:disabled,.d-root .d-btn[aria-disabled=true]{opacity:.55;cursor:not-allowed;filter:none}
.d-root .d-btn--block{width:100%}
.d-root .d-btn svg{width:1.15em;height:1.15em}
.d-root .d-section--cover .d-btn--primary{background:var(--canvas-inverse);color:var(--canvas-primary)}
.d-root .d-section--cover .d-btn--outline{color:var(--canvas-inverse)}

.d-root .d-divider{width:100%;margin:.4em auto;border:0;border-top:1px solid var(--canvas-border)}
.d-root .d-pagebreak{display:none}

.d-root .d-figure{display:flex;flex-direction:column;margin:0;break-inside:avoid}
.d-root .d-figure img{display:block;width:100%;height:auto}
.d-root .d-figure figcaption,.d-root .d-video figcaption,.d-root .d-gallery figcaption{margin-top:.6em;font-size:.85em;color:var(--d-muted);text-align:center}

.d-root .d-icon{display:flex}
.d-root .d-icon-glyph{display:inline-flex;align-items:center;justify-content:center;color:var(--canvas-primary)}
.d-root .d-icon-glyph svg{width:100%;height:100%}
.d-root .d-icon--badge .d-icon-glyph{padding:.55em;border-radius:calc(var(--d-radius) + 4px);background:color-mix(in srgb,currentColor 12%,transparent)}

.d-root .d-video{margin:0;break-inside:avoid}
.d-root .d-video-frame{position:relative;display:block;aspect-ratio:16/9;overflow:hidden;border-radius:var(--d-radius);background:#0b1020;color:#fff;text-decoration:none}
.d-root .d-video-frame iframe,.d-root .d-video-frame video,.d-root .d-video-frame img{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover}
.d-root button.d-video-frame{width:100%;padding:0;border:0;font:inherit;cursor:pointer}
.d-root .d-video-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6em;width:100%;border:0;padding:0;background:linear-gradient(to top,rgba(0,0,0,.5),rgba(0,0,0,.08));color:#fff;font:inherit;font-weight:600;cursor:pointer}
.d-root .d-video-play-icon{display:inline-flex;align-items:center;justify-content:center;width:4.2em;height:4.2em;border-radius:50%;background:rgba(255,255,255,.95);color:#111827;box-shadow:0 10px 30px rgba(0,0,0,.3)}
.d-root .d-video-play-icon svg{width:1.6em;height:1.6em;margin-left:.15em}

.d-root .d-gallery{display:grid;gap:.75em;grid-template-columns:repeat(var(--d-cols,3),minmax(0,1fr))}
.d-root .d-gallery figure{margin:0;break-inside:avoid}
.d-root .d-gallery img{display:block;width:100%;height:100%;border-radius:var(--d-radius);object-fit:cover}

.d-root .d-acc{display:flex;flex-direction:column}
.d-root .d-acc--lines{border-top:1px solid var(--canvas-border)}
.d-root .d-acc--lines .d-acc-item{border-bottom:1px solid var(--canvas-border)}
.d-root .d-acc--cards{gap:.6em}
.d-root .d-acc--cards .d-acc-item{padding:0 1.1em;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface)}
.d-root .d-acc-summary{display:flex;align-items:center;justify-content:space-between;gap:1em;padding:1em 0;font-weight:600;color:var(--d-heading-color);cursor:pointer;list-style:none}
.d-root .d-acc-summary::-webkit-details-marker{display:none}
.d-root details>.d-acc-summary::after{content:"+";flex:none;font-size:1.3em;line-height:1;color:var(--canvas-primary);transition:transform .2s ease}
.d-root details[open]>.d-acc-summary::after{transform:rotate(45deg)}
.d-root .d-acc-body{display:flex;flex-direction:column;gap:calc(var(--d-gap) * .75);padding:0 0 1.1em}

.d-root .d-stats{display:grid;gap:1em;grid-template-columns:repeat(var(--d-cols,3),minmax(0,1fr))}
.d-root .d-stat{display:flex;flex-direction:column;gap:.25em;break-inside:avoid}
.d-root .d-stat-value{font-family:var(--d-font-heading);font-size:calc(var(--d-h2) * 1.05);font-weight:700;line-height:1.05;letter-spacing:-0.02em;color:var(--canvas-primary)}
.d-root .d-stat-label{font-size:.9em;color:var(--d-muted)}
.d-root .d-stats--cards .d-stat{padding:1.15em 1.25em;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface)}
.d-root .d-stats--accent .d-stat{padding-left:1em;border-left:3px solid var(--canvas-primary)}
.d-root .d-section--cover .d-stat-value{color:inherit}
.d-root .d-section--cover .d-stats--cards .d-stat{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.24)}
.d-root .d-section--cover .d-stats--accent .d-stat{border-color:currentColor}

.d-root .d-testimonials{display:grid;gap:1em;grid-template-columns:repeat(var(--d-cols,2),minmax(0,1fr))}
.d-root .d-testimonial{display:flex;flex-direction:column;justify-content:space-between;gap:1.1em;margin:0;padding:1.4em;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface);break-inside:avoid}
.d-root .d-testimonial blockquote{margin:0;font-size:1.02em;line-height:1.6;color:var(--d-heading-color)}
.d-root .d-person{display:flex;align-items:center;gap:.75em;font-size:.875em}
.d-root .d-person strong{display:block;color:var(--d-heading-color);font-weight:650}
.d-root .d-person span{color:var(--d-muted)}
.d-root .d-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:2.6em;height:2.6em;border-radius:50%;object-fit:cover;background:color-mix(in srgb,var(--canvas-primary) 14%,var(--canvas-surface));color:var(--canvas-primary);font-weight:700}

.d-root .d-logos-title{margin:0 0 1em;text-align:center;font-size:.78em;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--d-muted)}
.d-root .d-logos-grid{display:grid;gap:1.25em 2em;align-items:center;grid-template-columns:repeat(var(--d-cols,4),minmax(0,1fr))}
.d-root .d-logos-grid img{display:block;width:auto;max-width:100%;max-height:2.75em;margin:0 auto;object-fit:contain}
.d-root .d-logos--gray img{filter:grayscale(1);opacity:.72}

.d-root .d-toc{padding:1.3em 1.45em;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface);break-inside:avoid}
.d-root .d-toc-title{margin:0 0 .7em;font-size:.78em;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--d-muted)}
.d-root .d-toc ol{display:grid;gap:0 2em;grid-template-columns:repeat(var(--d-cols,1),minmax(0,1fr));margin:0;padding:0;list-style:none;counter-reset:d-toc}
.d-root .d-toc li{counter-increment:d-toc}
.d-root .d-toc a{display:flex;gap:.8em;padding:.45em 0;border-bottom:1px dashed var(--canvas-border);color:var(--canvas-text);text-decoration:none}
.d-root .d-toc a:hover{color:var(--canvas-primary)}
.d-root .d-toc--numbered a::before{content:counter(d-toc,decimal-leading-zero);color:var(--canvas-primary);font-weight:600;font-variant-numeric:tabular-nums}

.d-root .d-contact{display:flex;align-items:center;gap:1.1em;padding:1.3em 1.45em;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface);color:var(--canvas-text);break-inside:avoid}
.d-root .d-contact .d-avatar{width:3.6em;height:3.6em;font-size:1.05em}
.d-root .d-contact-body{display:flex;flex-direction:column;gap:.1em;min-width:0}
.d-root .d-contact-label{font-size:.72em;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--canvas-primary)}
.d-root .d-contact-name{font-size:1.08em;font-weight:700;color:var(--canvas-heading)}
.d-root .d-contact-meta{font-size:.9em;color:var(--canvas-muted)}
.d-root .d-contact-links{display:flex;flex-wrap:wrap;gap:.3em 1.1em;margin-top:.35em;font-size:.9em}
.d-root .d-contact-links a{color:var(--canvas-primary);text-decoration:none;overflow-wrap:anywhere}

.d-root .d-container{display:flex;flex-direction:column;gap:var(--d-gap);min-width:0}
.d-root .d-container--card{padding:1.6em;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface);box-shadow:0 1px 2px rgba(15,23,42,.04),0 10px 28px -14px rgba(15,23,42,.16);color:var(--canvas-text);--d-heading-color:var(--canvas-heading);--d-muted:var(--canvas-muted)}
.d-root .d-container--soft{padding:1.6em;border-radius:var(--d-radius);background:color-mix(in srgb,var(--canvas-primary) 6%,var(--canvas-surface))}
.d-root .d-container--outline{padding:1.6em;border:1px solid var(--canvas-border);border-radius:var(--d-radius)}
.d-root .d-cols{display:grid;gap:32px;align-items:start}
.d-root .d-col{display:flex;flex-direction:column;gap:var(--d-gap);min-width:0}

.d-root .d-card{display:flex;flex-direction:column;gap:1em;padding:1.6em;border:1px solid var(--canvas-border);border-radius:calc(var(--d-radius) + 4px);background:var(--canvas-surface);color:var(--canvas-text);box-shadow:0 1px 2px rgba(15,23,42,.04),0 14px 34px -18px rgba(15,23,42,.2);break-inside:avoid;--d-heading-color:var(--canvas-heading);--d-muted:var(--canvas-muted)}
.d-root .d-card-title{margin:0;font-family:var(--d-font-heading);font-size:var(--d-h4);font-weight:700;line-height:1.25;color:var(--d-heading-color)}
.d-root .d-card-text{margin:0;font-size:.93em;color:var(--d-muted);white-space:pre-line}
.d-root .d-grid{display:grid;gap:.9em;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.d-root .d-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.65em}
.d-root .d-note{font-size:.85em;color:var(--d-muted)}
.d-root .d-status{display:flex;align-items:flex-start;gap:.75em;padding:1em 1.15em;border-radius:var(--d-radius);background:color-mix(in srgb,#15803d 10%,var(--canvas-surface));color:#14532d;font-weight:500}
.d-root .d-status svg{flex:none;width:1.3em;height:1.3em;margin-top:.1em}
.d-root .d-status--declined{background:color-mix(in srgb,#b91c1c 9%,var(--canvas-surface));color:#7f1d1d}
.d-root .d-status--expired{background:color-mix(in srgb,#b45309 10%,var(--canvas-surface));color:#78350f}

.d-root .d-field{display:flex;flex-direction:column;gap:.4em;min-width:0;break-inside:avoid}
.d-root .d-label{font-size:.9em;font-weight:600;color:var(--d-heading-color)}
.d-root .d-req{margin-left:.15em;color:#b91c1c}
.d-root .d-input{width:100%;min-height:2.75em;padding:.6em .8em;border:1px solid color-mix(in srgb,var(--canvas-border) 65%,var(--canvas-muted));border-radius:max(calc(var(--d-radius) - 2px),0px);background:var(--canvas-surface);color:var(--canvas-text);font:inherit;line-height:1.4;transition:border-color .15s ease,box-shadow .15s ease}
.d-root textarea.d-input{min-height:6.5em;resize:vertical}
.d-root select.d-input{appearance:auto}
.d-root .d-input::placeholder{color:color-mix(in srgb,var(--canvas-muted) 70%,transparent)}
.d-root .d-input:focus{outline:none;border-color:var(--canvas-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--canvas-primary) 18%,transparent)}
.d-root .d-input[aria-invalid=true]{border-color:#b91c1c}
.d-root .d-input:disabled{background:color-mix(in srgb,var(--canvas-border) 28%,var(--canvas-surface));cursor:not-allowed}
.d-root .d-input--fake{display:flex;align-items:center;color:color-mix(in srgb,var(--canvas-muted) 80%,transparent);pointer-events:none}
.d-root .d-input--area{align-items:flex-start;min-height:6.5em}
.d-root .d-help{font-size:.82em;color:var(--d-muted)}
.d-root .d-error{font-size:.82em;font-weight:500;color:#b91c1c}
.d-root .d-check{display:flex;align-items:flex-start;gap:.6em;font-size:.95em;cursor:pointer}
.d-root .d-check input{flex:none;width:1.15em;height:1.15em;margin:.2em 0 0;accent-color:var(--canvas-primary)}
.d-root .d-check-box{flex:none;display:inline-flex;align-items:center;justify-content:center;width:1.15em;height:1.15em;margin-top:.2em;border:1.5px solid color-mix(in srgb,var(--canvas-muted) 70%,transparent);border-radius:4px;color:var(--canvas-primary);font-size:.8em;font-weight:700;line-height:1}
.d-root .d-options{display:flex;flex-direction:column;gap:.45em}
.d-root .d-fieldset{min-width:0;margin:0;padding:0;border:0}
.d-root legend.d-label{margin-bottom:.4em;padding:0}
.d-root .d-value{min-height:2.1em;padding:.35em 0;border-bottom:1px solid var(--canvas-border);white-space:pre-wrap;overflow-wrap:anywhere}

.d-root .d-pricing{display:flex;flex-direction:column;gap:.9em}
.d-root .d-pricing-title{margin:0;font-family:var(--d-font-heading);font-size:var(--d-h4);font-weight:700;color:var(--d-heading-color)}
.d-root .d-pricing-table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface);color:var(--canvas-text);font-size:.94em}
.d-root .d-pricing-table th{padding:.75em 1em;border-bottom:1px solid var(--canvas-border);background:color-mix(in srgb,var(--canvas-border) 35%,var(--canvas-surface));color:var(--canvas-muted);font-size:.76em;font-weight:600;letter-spacing:.07em;text-align:left;text-transform:uppercase}
.d-root .d-pricing-table td{padding:.9em 1em;border-bottom:1px solid var(--canvas-border);vertical-align:top}
.d-root .d-pricing-table tbody tr:last-child td{border-bottom:0}
.d-root .d-pricing-table .d-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.d-root .d-pricing-table tr{break-inside:avoid}
.d-root .d-pricing-name{display:flex;align-items:flex-start;gap:.6em;font-weight:600;color:var(--canvas-heading)}
.d-root .d-pricing-name input{flex:none;width:1.1em;height:1.1em;margin:.22em 0 0;accent-color:var(--canvas-primary)}
.d-root .d-pricing-desc{margin-top:.25em;font-size:.88em;font-weight:400;color:var(--canvas-muted);white-space:pre-line}
.d-root .d-tag{display:inline-block;margin-left:.45em;padding:.08em .55em;border-radius:999px;background:color-mix(in srgb,var(--canvas-primary) 11%,transparent);color:var(--canvas-primary);font-size:.72em;font-weight:600;vertical-align:.12em;white-space:nowrap}
.d-root .d-tag--muted{background:color-mix(in srgb,var(--canvas-muted) 14%,transparent);color:var(--canvas-muted)}
.d-root .d-pricing-off td{color:var(--canvas-muted)}
.d-root .d-pricing-off .d-pricing-line{text-decoration:line-through}
.d-root .d-qty{width:5.5em;min-height:2.2em;padding:.3em .5em;text-align:right}
.d-root .d-pricing-totals{display:flex;flex-direction:column;gap:.4em;width:min(100%,340px);margin:0 0 0 auto;padding:1em 1.2em;border-radius:var(--d-radius);background:color-mix(in srgb,var(--canvas-primary) 6%,var(--canvas-surface));color:var(--canvas-text);break-inside:avoid}
.d-root .d-pricing-totals div{display:flex;justify-content:space-between;gap:1.5em;font-variant-numeric:tabular-nums}
.d-root .d-pricing-totals dt{color:var(--canvas-muted)}
.d-root .d-pricing-totals dd{margin:0;font-weight:600}
.d-root .d-pricing-totals .d-pricing-total{margin-top:.3em;padding-top:.65em;border-top:1px solid var(--canvas-border);font-size:1.12em}
.d-root .d-pricing-total dt{color:var(--canvas-heading);font-weight:600}
.d-root .d-pricing-total dd{color:var(--canvas-primary);font-weight:750}
.d-root .d-pricing-note{margin:0;font-size:.85em;color:var(--d-muted);white-space:pre-line}

.d-root .d-files{display:flex;flex-direction:column;gap:.5em;margin:0;padding:0;list-style:none}
.d-root .d-file{display:flex;align-items:center;gap:.85em;padding:.75em .95em;border:1px solid var(--canvas-border);border-radius:var(--d-radius);background:var(--canvas-surface);color:var(--canvas-text);text-decoration:none;transition:border-color .15s ease}
.d-root a.d-file:hover{border-color:var(--canvas-primary)}
.d-root .d-file-name{flex:1;min-width:0;overflow:hidden;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.d-root .d-file-meta{color:var(--canvas-muted);font-size:.82em;white-space:nowrap}
.d-root .d-badge-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:2.4em;height:2.4em;border-radius:max(calc(var(--d-radius) - 2px),6px);background:color-mix(in srgb,var(--canvas-primary) 11%,transparent);color:var(--canvas-primary)}
.d-root .d-badge-icon svg{width:1.25em;height:1.25em}
.d-root .d-badge-icon--lg{width:3em;height:3em}
.d-root .d-badge-icon--lg svg{width:1.5em;height:1.5em}

.d-root .d-validity{display:flex;flex-wrap:wrap;align-items:center;gap:.55em}
.d-root .d-validity svg{flex:none;width:1.15em;height:1.15em}
.d-root .d-validity--badge{align-self:flex-start;padding:.45em .95em;border-radius:999px;background:color-mix(in srgb,var(--canvas-primary) 10%,var(--canvas-surface));color:var(--canvas-primary);font-size:.88em;font-weight:600}
.d-root .d-validity--banner{padding:.95em 1.15em;border:1px solid color-mix(in srgb,var(--canvas-primary) 22%,transparent);border-radius:var(--d-radius);background:color-mix(in srgb,var(--canvas-primary) 6%,var(--canvas-surface));color:var(--canvas-heading);font-weight:600}
.d-root .d-validity-count{font-weight:500;color:var(--canvas-muted)}
.d-root .d-validity.d-validity--expired{border-color:transparent;background:color-mix(in srgb,#b45309 11%,var(--canvas-surface));color:#92400e}
.d-root .d-section--cover .d-validity--badge{background:rgba(255,255,255,.16);color:inherit}

.d-root .d-band{display:flex;flex-wrap:wrap;align-items:center;gap:1.1em;padding:1.3em 1.45em;border:1px solid color-mix(in srgb,var(--canvas-primary) 18%,transparent);border-radius:var(--d-radius);background:color-mix(in srgb,var(--canvas-primary) 6%,var(--canvas-surface));color:var(--canvas-text);break-inside:avoid}
.d-root .d-band-body{flex:1;min-width:min(100%,200px)}
.d-root .d-band-title{margin:0;font-weight:700;color:var(--canvas-heading)}
.d-root .d-band-text{margin:.2em 0 0;font-size:.92em;color:var(--canvas-muted);white-space:pre-line}

.d-root .d-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4em;min-height:7em;padding:1.25em;border:1.5px dashed color-mix(in srgb,var(--canvas-muted) 45%,transparent);border-radius:var(--d-radius);background:color-mix(in srgb,var(--canvas-border) 22%,transparent);color:var(--canvas-muted);font-size:.875em;text-align:center}
.d-root .d-placeholder svg{width:1.8em;height:1.8em}
.d-root .d-var{padding:0 .15em;border-radius:4px;background:color-mix(in srgb,var(--canvas-primary) 13%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--canvas-primary) 28%,transparent)}
.d-root .d-section--cover .d-var{background:rgba(255,255,255,.18);box-shadow:0 0 0 1px rgba(255,255,255,.4)}

@media (max-width:640px){
.d-root .d-section{padding-left:20px;padding-right:20px}
.d-root .d-cols--stack{grid-template-columns:minmax(0,1fr)!important}
.d-root .d-stats,.d-root .d-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}
.d-root .d-testimonials{grid-template-columns:minmax(0,1fr)}
.d-root .d-logos-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
.d-root .d-toc ol{grid-template-columns:minmax(0,1fr)}
.d-root .d-section--cover{min-height:auto}
}
@media (max-width:560px){
.d-root .d-pricing-table thead{display:none}
.d-root .d-pricing-table,.d-root .d-pricing-table tbody,.d-root .d-pricing-table tr,.d-root .d-pricing-table td{display:block;width:100%}
.d-root .d-pricing-table tr{padding:.85em 1em;border-bottom:1px solid var(--canvas-border)}
.d-root .d-pricing-table tbody tr:last-child{border-bottom:0}
.d-root .d-pricing-table td{padding:.15em 0;border:0}
.d-root .d-pricing-table td.d-num{display:flex;justify-content:space-between;gap:1em}
.d-root .d-pricing-table td.d-num::before{content:attr(data-label);color:var(--canvas-muted);font-size:.85em}
}
`

const EDITOR_CSS = `
.d-mode-editor .d-section-inner:empty,.d-mode-editor .d-col:empty,.d-mode-editor .d-container:empty,.d-mode-editor .d-acc-body:empty{min-height:72px;border:1.5px dashed color-mix(in srgb,var(--canvas-muted) 40%,transparent);border-radius:var(--d-radius)}
.d-mode-editor .d-section-inner:empty::after{content:"Arraste elementos para esta seção";margin:auto;color:var(--canvas-muted);font-size:13px}
.d-mode-editor .d-section-inner:empty{display:flex;min-height:140px}
.d-mode-editor .d-section--cover .d-section-inner:empty::after{color:inherit;opacity:.8}
.d-mode-editor .d-pagebreak{display:flex;align-items:center;gap:.75em;padding:.5em 0;color:var(--canvas-muted);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase}
.d-mode-editor .d-pagebreak::before,.d-mode-editor .d-pagebreak::after{content:"";flex:1;border-top:2px dashed color-mix(in srgb,var(--canvas-muted) 45%,transparent)}
.d-mode-editor .d-section[data-page-break-before]{border-top:2px dashed color-mix(in srgb,var(--canvas-muted) 45%,transparent)}
.d-mode-editor .d-acc-summary{cursor:default}
.d-mode-editor a{pointer-events:none}
`

function pagedCss(page: { width: number; height: number }): string {
  return `
.d-layout-paged{padding:32px 16px;background:var(--canvas-background)}
.d-layout-paged .d-doc{width:${page.width}mm;max-width:100%;min-height:${page.height}mm;margin:0 auto;box-shadow:0 1px 3px rgba(15,23,42,.08),0 24px 48px -24px rgba(15,23,42,.28);background-image:repeating-linear-gradient(to bottom,transparent 0,transparent calc(${page.height}mm - 1px),rgba(15,23,42,.16) calc(${page.height}mm - 1px),rgba(15,23,42,.16) ${page.height}mm)}
.d-layout-paged .d-section{padding-left:var(--d-margin);padding-right:var(--d-margin)}
.d-layout-paged .d-section-inner{max-width:none}
.d-layout-paged .d-section--cover{min-height:${page.height}mm}
.d-layout-paged.d-mode-public .d-pagebreak{display:block;height:0;margin:var(--d-gap) calc(-1 * var(--d-margin));border-top:14px solid var(--canvas-background)}
@media (max-width:640px){
.d-layout-paged{padding:0}
.d-layout-paged .d-doc{width:auto;min-height:0;box-shadow:none;background-image:none}
.d-layout-paged .d-section{padding-left:20px;padding-right:20px}
.d-layout-paged .d-section--cover{min-height:auto}
.d-layout-paged.d-mode-public .d-pagebreak{margin-left:-20px;margin-right:-20px}
}
`
}

function printCss(
  page: { width: number; height: number },
  margin: number,
  coverFirst: boolean,
): string {
  const first = coverFirst ? '@page :first{margin:0}' : ''
  const firstCover = coverFirst
    ? `.d-mode-print .d-section--cover:first-child{height:${page.height}mm;min-height:0;padding:${margin}mm;overflow:hidden;break-before:auto}`
    : ''
  return `
@page{size:${page.width}mm ${page.height}mm;margin:${margin}mm}
${first}
html,body{margin:0;padding:0;background:#fff}
.d-mode-print{background:var(--canvas-surface)}
.d-mode-print,.d-mode-print *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.d-mode-print .d-doc{width:auto;min-height:0;margin:0;box-shadow:none;background-image:none}
.d-mode-print .d-section{padding-left:0;padding-right:0}
.d-mode-print .d-section-inner{max-width:none}
.d-mode-print .d-section--highlight,.d-mode-print .d-section--styled{padding-left:7mm;padding-right:7mm;border-radius:var(--d-radius)}
.d-mode-print .d-section--cover{min-height:calc(${page.height}mm - ${margin * 2}mm);padding:14mm;border-radius:0;break-before:page;break-after:page}
${firstCover}
.d-mode-print [data-page-break-before]{break-before:page}
.d-mode-print .d-pagebreak{display:block;height:0;margin:0;border:0;break-after:page}
.d-mode-print .d-h{break-after:avoid}
.d-mode-print .d-table-wrap{overflow:visible}
.d-mode-print .d-pricing-table{overflow:visible}
`
}

/** The whole stylesheet of a render (theme, components, layout, mode). */
export function documentCss(
  theme: DocumentTheme,
  options: DocumentCssOptions,
): string {
  const page = documentPageBox(options.settings)
  const paged = options.settings.layout === 'paged'
  const parts = [
    `.d-root{${themeVariables(theme)}}`,
    BASE_CSS,
    `@media (max-width:640px){.d-root{${mobileVariables(theme)}}}`,
  ]
  if (options.mode === 'editor') parts.push(EDITOR_CSS)
  if (options.mode === 'print') {
    parts.push(printCss(page, theme.pageMargin, options.coverFirst === true))
  } else if (paged) {
    parts.push(pagedCss(page))
  }
  return parts.join('\n')
}

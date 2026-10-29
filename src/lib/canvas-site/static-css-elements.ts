import { SITE_ROOT_CLASS, SITE_TYPES } from './constants'

/**
 * Structural CSS of the S2 elements and effects. Unlike `static-css.ts`
 * (always shipped), each block is included only when the page uses the
 * element — unused rules cost bytes and Lighthouse points. Goes into the
 * `s-base` layer with the rest, so node classes always win.
 */

const r = `.${SITE_ROOT_CLASS}`
/** Pages whose runtime set `s-js` on <html> before the content parsed. */
const js = `.s-js ${r}`

const GALLERY = [
  `${r} .s-gallery-list{list-style:none;margin:0;padding:0}`,
  `${r} .s-gallery-item{break-inside:avoid;margin:0}`,
  `${r} .s-gallery-item>figure{margin:0}`,
  `${r} .s-gallery img{display:block;width:100%;height:auto}`,
  `${r} .s-gallery-link{display:block;cursor:zoom-in}`,
  `${r} .s-gallery figcaption{margin-top:8px;font-size:14px;color:var(--canvas-muted)}`,
  `${r} .s-lightbox{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgba(9,9,11,.94);color:#fff}`,
  `${r} .s-lightbox[open]{display:flex;align-items:center;justify-content:center}`,
  `${r} .s-lightbox::backdrop{background:transparent}`,
  `${r} .s-lightbox figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:12px;padding:72px 16px}`,
  `${r} .s-lightbox img{display:block;max-width:min(92vw,1600px);max-height:80vh;width:auto;height:auto;object-fit:contain}`,
  `${r} .s-lightbox figcaption{font-size:15px;text-align:center;max-width:80ch}`,
  `${r} .s-lightbox button{position:absolute;display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}`,
  `${r} .s-lightbox button:hover{background:rgba(255,255,255,.26)}`,
  `${r} .s-lightbox svg{width:24px;height:24px}`,
  `${r} .s-lb-close{top:16px;right:16px}`,
  `${r} .s-lb-prev{left:16px;top:50%;transform:translateY(-50%)}`,
  `${r} .s-lb-next{right:16px;top:50%;transform:translateY(-50%)}`,
]

const CAROUSEL = [
  // Full width even in a centered flex column: the track must not size the
  // carousel by its (scrolling) content.
  `${r} .s-carousel{position:relative;width:100%;max-width:100%;min-width:0}`,
  `${r} .s-carousel-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none;overscroll-behavior-x:contain;list-style:none;margin:0;padding:0}`,
  `${r} .s-carousel-track::-webkit-scrollbar{display:none}`,
  `${r} .s-carousel-track>*{scroll-snap-align:start;min-width:0}`,
  `${r} .s-carousel-controls{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:20px}`,
  `${r} .s-carousel-btn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:1px solid var(--canvas-border);border-radius:999px;background:var(--canvas-background);color:var(--canvas-text);cursor:pointer}`,
  `${r} .s-carousel-btn:disabled{opacity:.4;cursor:default}`,
  `${r} .s-carousel-btn>svg{width:20px;height:20px}`,
  `${r} .s-carousel-dots{display:flex;align-items:center;gap:2px}`,
  `${r} .s-carousel-dot{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;background:none;cursor:pointer}`,
  `${r} .s-carousel-dot::before{content:"";width:8px;height:8px;border-radius:999px;background:var(--canvas-border);transition:width .2s,background-color .2s}`,
  `${r} .s-carousel-dot[aria-current=true]::before{width:20px;background:var(--canvas-primary)}`,
  `html:not(.s-js) ${r}:not(.s-editing) .s-carousel-controls{display:none}`,
]

const SLIDE = [
  `${r} .s-slide{position:relative;display:flex;flex-direction:column}`,
]

const TABS = [
  `${r} .s-tabs{display:flex;flex-direction:column}`,
  `${r} .s-tabs-vertical{display:grid;align-items:start}`,
  `${r} .s-tablist{display:flex;flex-wrap:wrap;gap:4px}`,
  `${r} .s-tabs-vertical>.s-tablist{flex-direction:column;flex-wrap:nowrap}`,
  `${r} .s-tab-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:44px;padding:10px 18px;border:0;border-radius:var(--s-radius-sm);background:none;color:var(--s-tab-color,var(--canvas-muted));font-weight:600;cursor:pointer;transition:color .15s,background-color .15s}`,
  `${r} .s-tab-btn:hover{color:var(--s-tab-active,var(--canvas-text))}`,
  `${r} .s-tab-btn[aria-selected=true]{color:var(--s-tab-active,var(--canvas-primary))}`,
  `${r} .s-tab-btn>svg{width:1.15em;height:1.15em}`,
  `${r} .s-tabs-underline>.s-tablist{gap:8px;border-bottom:1px solid var(--canvas-border)}`,
  `${r} .s-tabs-underline .s-tab-btn{border-radius:0;border-bottom:2px solid transparent;margin-bottom:-1px}`,
  `${r} .s-tabs-underline .s-tab-btn[aria-selected=true]{border-bottom-color:currentColor}`,
  `${r} .s-tabs-vertical.s-tabs-underline>.s-tablist{border-bottom:0;border-left:1px solid var(--canvas-border)}`,
  `${r} .s-tabs-vertical.s-tabs-underline .s-tab-btn{justify-content:flex-start;border-bottom:0;border-left:2px solid transparent;margin:0 0 0 -1px}`,
  `${r} .s-tabs-vertical.s-tabs-underline .s-tab-btn[aria-selected=true]{border-left-color:currentColor}`,
  `${r} .s-tabs-pills .s-tab-btn{border-radius:999px}`,
  `${r} .s-tabs-pills .s-tab-btn[aria-selected=true]{background:var(--s-tab-active,var(--canvas-primary));color:var(--canvas-inverse)}`,
  `${r} .s-tabs-boxed>.s-tablist{padding:4px;border-radius:var(--s-radius-md);background:var(--canvas-surface)}`,
  `${r} .s-tabs-boxed .s-tab-btn[aria-selected=true]{background:var(--canvas-background);color:var(--s-tab-active,var(--canvas-text));box-shadow:var(--s-shadow-sm)}`,
  `${r} .s-tabpanels{min-width:0}`,
  `${r} .s-tabpanel{display:flex;flex-direction:column}`,
  `${r} .s-tabpanel[hidden]{display:none}`,
  `${js} .s-tabs:not([data-ready]) .s-tabpanels>.s-tabpanel:not(:first-child){display:none}`,
  `html:not(.s-js) ${r}:not(.s-editing) .s-tablist{display:none}`,
]

const ACCORDION = [
  `${r} .s-accordion{display:flex;flex-direction:column}`,
  `${r} .s-acc-item{background:var(--s-acc-bg,transparent)}`,
  `${r} .s-acc-separated>.s-acc-item{border:1px solid var(--s-acc-border,var(--canvas-border));border-radius:var(--s-radius-md);background:var(--s-acc-bg,var(--canvas-background))}`,
  `${r} .s-acc-bordered{border:1px solid var(--s-acc-border,var(--canvas-border));border-radius:var(--s-radius-md);overflow:hidden}`,
  `${r} .s-acc-bordered>.s-acc-item+.s-acc-item,${r} .s-acc-minimal>.s-acc-item{border-bottom:1px solid var(--s-acc-border,var(--canvas-border))}`,
  `${r} .s-acc-bordered>.s-acc-item+.s-acc-item{border-bottom:0;border-top:1px solid var(--s-acc-border,var(--canvas-border))}`,
  `${r} .s-acc-summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;cursor:pointer;list-style:none}`,
  `${r} .s-acc-summary::-webkit-details-marker{display:none}`,
  `${r} .s-acc-minimal .s-acc-summary{padding-left:0;padding-right:0}`,
  `${r} .s-acc-title{margin:0}`,
  `${r} .s-acc-icon{flex:none;width:20px;height:20px;transition:transform .2s}`,
  `${r} .s-acc-item[open]>.s-acc-summary .s-acc-icon{transform:rotate(180deg)}`,
  `${r} .s-acc-plus>.s-acc-item[open]>.s-acc-summary .s-acc-icon{transform:rotate(45deg)}`,
  `${r} .s-acc-body{display:flex;flex-direction:column;padding:0 20px 20px}`,
  `${r} .s-acc-minimal .s-acc-body{padding:0 0 20px}`,
]

const POPUP = [
  `${r} .s-popup{border:0;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;padding:32px;background:var(--canvas-background);color:var(--canvas-text)}`,
  `${r} .s-popup[open]{animation:s-popup-in .25s ease-out}`,
  `${r} .s-popup::backdrop{background:rgba(9,9,11,.6)}`,
  `${r} .s-popup-body{display:flex;flex-direction:column}`,
  `${r} .s-popup-close{position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0;border-radius:999px;background:transparent;color:inherit;opacity:.75;cursor:pointer}`,
  `${r} .s-popup-close:hover{opacity:1;background:rgba(127,127,127,.16)}`,
  `${r} .s-popup-close>svg{width:20px;height:20px}`,
  `${r} .s-popup-top{margin-top:24px;margin-bottom:auto}`,
  `${r} .s-popup-bottom{margin-top:auto;margin-bottom:24px}`,
  `${r} .s-popup-bottom-left{margin:auto auto 24px 24px}`,
  `${r} .s-popup-bottom-right{margin:auto 24px 24px auto}`,
  `html:has(${r} .s-popup[open]:modal){overflow:hidden}`,
  '@keyframes s-popup-in{from{opacity:0;transform:translateY(12px) scale(.98)}}',
]

const COUNTDOWN = [
  `${r} .s-countdown{display:flex;flex-wrap:wrap;gap:12px}`,
  `${r} .s-cd-unit{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:calc(var(--s-cd-size,48px)*1.5)}`,
  `${r} .s-cd-num{font-family:var(--s-font-heading);font-size:var(--s-cd-size,48px);font-weight:700;line-height:1;font-variant-numeric:tabular-nums}`,
  `${r} .s-cd-label{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--canvas-muted)}`,
  `${r} .s-countdown-boxes .s-cd-unit{padding:16px 14px;border-radius:var(--s-radius-md);background:var(--canvas-surface)}`,
  `${r} .s-cd-expired{font-weight:600}`,
]

const STATS = [
  `${r} .s-stats{display:grid;list-style:none;margin:0;padding:0}`,
  `${r} .s-stat{display:flex;flex-direction:column;gap:6px;min-width:0}`,
  `${r} .s-stat-num{font-family:var(--s-font-heading);font-weight:700;line-height:1.05;font-variant-numeric:tabular-nums}`,
  `${r} .s-stat-label{color:var(--canvas-muted)}`,
  `${r} .s-stats-divided>.s-stat+.s-stat{border-left:1px solid var(--canvas-border);padding-left:24px}`,
]

const TESTIMONIALS = [
  `${r} .s-tm-list{list-style:none;margin:0;padding:0}`,
  `${r} .s-tm-card{display:flex;flex-direction:column;gap:16px;height:100%;margin:0;padding:28px;border-radius:var(--s-radius-md);background:var(--canvas-surface)}`,
  `${r} .s-tm-quote{margin:0;font-size:17px;line-height:1.6}`,
  `${r} .s-tm-author{display:flex;align-items:center;gap:12px;margin-top:auto}`,
  `${r} .s-tm-avatar{width:48px;height:48px;flex:none;border-radius:999px;object-fit:cover}`,
  `${r} .s-tm-name{display:block;font-weight:700}`,
  `${r} .s-tm-role{display:block;font-size:14px;color:var(--canvas-muted)}`,
  `${r} .s-stars{display:flex;gap:2px;color:#f5a524}`,
  `${r} .s-stars>svg{width:18px;height:18px}`,
]

const PRICING = [
  `${r} .s-pricing-list{display:grid;align-items:stretch;list-style:none;margin:0;padding:0}`,
  `${r} .s-plan{position:relative;display:flex;flex-direction:column;gap:16px;padding:32px 28px;border:1px solid var(--canvas-border);border-radius:var(--s-radius-lg);background:var(--canvas-background)}`,
  `${r} .s-plan-hl{border-color:transparent;background:var(--canvas-primary);color:var(--canvas-inverse);box-shadow:var(--s-shadow-lg)}`,
  `${r} .s-plan-badge{align-self:flex-start;padding:4px 10px;border-radius:999px;background:var(--canvas-accent);color:var(--canvas-inverse);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}`,
  `${r} .s-plan-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;margin:0}`,
  `${r} .s-plan-amount{font-family:var(--s-font-heading);font-size:44px;font-weight:700;line-height:1.1}`,
  `${r} .s-plan-period,${r} .s-plan-desc{opacity:.78}`,
  `${r} .s-plan-features{display:flex;flex:1;flex-direction:column;gap:10px;list-style:none;margin:0;padding:0}`,
  `${r} .s-plan-features>li{display:flex;align-items:flex-start;gap:10px}`,
  `${r} .s-plan-features svg{flex:none;width:20px;height:20px;margin-top:2px;color:var(--canvas-primary)}`,
  `${r} .s-plan-hl .s-plan-features svg{color:currentColor}`,
  `${r} .s-plan .s-btn{width:100%}`,
]

const LOGOS = [
  `${r} .s-logos-list{display:grid;align-items:center;list-style:none;margin:0;padding:0}`,
  `${r} .s-logos img{width:auto;max-width:100%;object-fit:contain;transition:filter .2s,opacity .2s}`,
  `${r} .s-logos-marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}`,
  `${r} .s-marquee-track{display:flex;width:max-content;animation:s-marquee 30s linear infinite}`,
  `${r} .s-logos-marquee .s-logos-list{display:flex;flex:none;align-items:center}`,
  `${r} .s-logos-marquee:hover .s-marquee-track,${r} .s-logos-marquee:focus-within .s-marquee-track{animation-play-state:paused}`,
  `${r}.s-editing .s-marquee-track{animation:none}`,
  '@keyframes s-marquee{to{transform:translateX(-50%)}}',
  `@media (prefers-reduced-motion:reduce){${r} .s-marquee-track{animation:none;width:auto}${r} .s-logos-marquee{-webkit-mask-image:none;mask-image:none}${r} .s-logos-marquee .s-logos-list{flex-wrap:wrap;justify-content:center}${r} .s-logos-marquee .s-logos-list[aria-hidden]{display:none}}`,
]

const MAP = [
  `${r} .s-map-frame{position:relative;overflow:hidden;border:1px solid var(--canvas-border);background:var(--canvas-surface)}`,
  `${r} .s-map-frame>iframe{position:absolute;inset:0;width:100%;height:100%;border:0}`,
  `${r} .s-map-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;background-image:radial-gradient(var(--canvas-border) 1px,transparent 1px);background-size:16px 16px}`,
  `${r} .s-map-placeholder>svg{width:32px;height:32px;color:var(--canvas-primary)}`,
  `${r} .s-map-address{max-width:40ch;font-weight:600}`,
  `${r} .s-map-note{max-width:46ch;font-size:13px;color:var(--canvas-muted)}`,
  `html:not(.s-js) ${r}:not(.s-editing) [data-s-map-load]{display:none}`,
]

const WHATSAPP = [
  `${r} .s-wa{display:flex}`,
  `${r} .s-wa-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:12px 22px;border-radius:999px;background:#25d366;color:#fff;font-weight:600;text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.18);transition:transform .15s,box-shadow .15s}`,
  `${r} .s-wa-btn:hover{transform:translateY(-2px);text-decoration:none;box-shadow:0 10px 28px rgba(0,0,0,.22)}`,
  `${r} .s-wa-btn>svg{width:24px;height:24px;flex:none}`,
  `${r} .s-wa-icon .s-wa-btn{width:56px;height:56px;padding:0}`,
  `${r} .s-wa-lg .s-wa-btn{min-height:60px;font-size:18px}`,
  `${r} .s-wa-lg.s-wa-icon .s-wa-btn{width:64px;height:64px}`,
  `${r} .s-wa-lg .s-wa-btn>svg{width:30px;height:30px}`,
  `${r} .s-wa-floating{position:fixed;bottom:20px;z-index:60}`,
  `${r} .s-wa-right{right:20px}`,
  `${r} .s-wa-left{left:20px}`,
]

const BEFORE_AFTER = [
  `${r} .s-ba{position:relative;overflow:hidden;background:var(--canvas-surface);-webkit-user-select:none;user-select:none}`,
  `${r} .s-ba img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover}`,
  `${r} .s-ba-after{position:absolute;inset:0;clip-path:inset(0 0 0 var(--s-pos,50%))}`,
  `${r} .s-ba-v .s-ba-after{clip-path:inset(var(--s-pos,50%) 0 0 0)}`,
  `${r} .s-ba-range{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize;-webkit-appearance:none;appearance:none}`,
  `${r} .s-ba-v .s-ba-range{writing-mode:vertical-lr;cursor:ns-resize}`,
  `${r} .s-ba-handle{position:absolute;top:0;bottom:0;left:var(--s-pos,50%);width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.15);pointer-events:none}`,
  `${r} .s-ba-handle::after{content:"";position:absolute;top:50%;left:50%;width:40px;height:40px;transform:translate(-50%,-50%);border-radius:999px;background:inherit;box-shadow:0 2px 10px rgba(0,0,0,.25)}`,
  `${r} .s-ba-v .s-ba-handle{top:var(--s-pos,50%);right:0;bottom:auto;left:0;width:auto;height:3px;margin:-1.5px 0 0}`,
  `${r} .s-ba-range:focus-visible~.s-ba-handle::after{outline:3px solid var(--canvas-primary);outline-offset:2px}`,
  `${r} .s-ba-label{position:absolute;top:12px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;font-weight:600;pointer-events:none}`,
  `${r} .s-ba-label-before{left:12px}`,
  `${r} .s-ba-label-after{right:12px}`,
  `${r} .s-ba-v .s-ba-label-after{top:auto;right:auto;bottom:12px;left:12px}`,
]

const ANIMATIONS = [
  `${r} .s-anim{animation-fill-mode:backwards;animation-duration:.6s;animation-timing-function:ease-out}`,
  `${r} .s-anim-fade{animation-name:s-fade}`,
  `${r} .s-anim-fade-up{animation-name:s-fade-up}`,
  `${r} .s-anim-fade-down{animation-name:s-fade-down}`,
  `${r} .s-anim-slide-left{animation-name:s-slide-left}`,
  `${r} .s-anim-slide-right{animation-name:s-slide-right}`,
  `${r} .s-anim-zoom{animation-name:s-zoom}`,
  `${r} .s-anim-blur{animation-name:s-blur}`,
  `${js} .s-reveal:not(.s-in){animation-name:none;opacity:0}`,
  '@keyframes s-fade{from{opacity:0}}',
  '@keyframes s-fade-up{from{opacity:0;transform:translateY(32px)}}',
  '@keyframes s-fade-down{from{opacity:0;transform:translateY(-32px)}}',
  '@keyframes s-slide-left{from{opacity:0;transform:translateX(48px)}}',
  '@keyframes s-slide-right{from{opacity:0;transform:translateX(-48px)}}',
  '@keyframes s-zoom{from{opacity:0;transform:scale(.92)}}',
  '@keyframes s-blur{from{opacity:0;filter:blur(12px)}}',
]

const INTERACTIONS = [
  `${r} [data-s-action]{cursor:pointer}`,
  `${r} .s-off{display:none!important}`,
]

/** Everything moving stops for visitors who ask for less motion. */
const REDUCED_MOTION = `@media (prefers-reduced-motion:reduce){${r} .s-anim,${r} .s-popup[open]{animation:none!important}${js} .s-reveal{opacity:1!important}${r} .s-carousel-track{scroll-behavior:auto}}`

/** Editor-only affordances of the S2 elements. */
const EDITOR = [
  `${r} .s-popup-stage{display:flex;justify-content:center;padding:48px 24px;background:repeating-linear-gradient(135deg,rgba(24,24,27,.5) 0 10px,rgba(24,24,27,.42) 10px 20px)}`,
  `${r} .s-popup-stage>.s-popup{position:static;display:block;margin:0}`,
  `${r} .s-popup-chip{display:flex;align-items:center;gap:8px;width:max-content;max-width:calc(100% - 32px);margin:8px auto;padding:6px 14px;border:1.5px dashed #a1a1aa;border-radius:999px;background:#fafafa;color:#52525b;font:500 12px/1.3 system-ui,sans-serif;cursor:pointer}`,
  `${r} .s-popup-chip>svg{width:14px;height:14px}`,
  `${r} .s-carousel-track{overflow:hidden}`,
].map((rule) => rule.replace(r, `${r}.s-editing`))

export interface ElementCssUsage {
  /** Types present (and visible) on the page. */
  types: Set<string>
  /** Some node has an entrance animation. */
  animations: boolean
  /** Some node has a click interaction. */
  interactions: boolean
}

/** Newsletter elements (slice nl-archive). */
const NEWSLETTER = [
  `${r} .s-nl-title{grid-column:1/-1;margin:0;font-size:20px;font-weight:700}`,
  `${r} .s-nl-row{grid-column:1/-1;display:flex;gap:12px}`,
  `${r} .s-nl-row>.s-field{flex:1}`,
  `${r} .s-nl-row>.s-btn{flex:none}`,
  `${r} .s-nl-items{list-style:none;margin:0;padding:0;display:grid;gap:16px}`,
  `${r} .s-nl-card{display:flex;flex-direction:column;gap:6px;height:100%;color:inherit;text-decoration:none}`,
  `${r} .s-nl-cards .s-nl-card{padding:20px;border:1px solid var(--canvas-border);border-radius:var(--s-radius-md);background:var(--canvas-surface);transition:border-color .2s}`,
  `${r} .s-nl-cards a.s-nl-card[href]:hover{border-color:var(--canvas-primary)}`,
  `${r} .s-nl-list .s-nl-items{gap:0}`,
  `${r} .s-nl-list .s-nl-card{padding:14px 0;border-bottom:1px solid var(--canvas-border)}`,
  `${r} a.s-nl-card[href]:hover .s-nl-subject{text-decoration:underline;text-underline-offset:4px}`,
  `${r} .s-nl-meta{font-size:13px;color:var(--canvas-muted)}`,
  `${r} .s-nl-number{font-weight:700;color:var(--canvas-primary)}`,
  `${r} .s-nl-subject{font-size:18px;font-weight:600;line-height:1.35}`,
  `${r} .s-nl-excerpt{font-size:15px;color:var(--canvas-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}`,
  `${r} .s-nl-all{display:inline-block;margin-top:16px;font-weight:600;color:var(--canvas-primary)}`,
  `${r} .s-nl-empty{margin:0;padding:16px;border:1px dashed var(--canvas-border);border-radius:var(--s-radius-sm);color:var(--canvas-muted);font-size:15px}`,
]

const BY_TYPE: Array<[string[], string[]]> = [
  [[SITE_TYPES.gallery], GALLERY],
  [[SITE_TYPES.carousel, SITE_TYPES.testimonials], CAROUSEL],
  [[SITE_TYPES.slide], SLIDE],
  [[SITE_TYPES.tabs], TABS],
  [[SITE_TYPES.accordion], ACCORDION],
  [[SITE_TYPES.popup], POPUP],
  [[SITE_TYPES.countdown], COUNTDOWN],
  [[SITE_TYPES.stats], STATS],
  [[SITE_TYPES.testimonials], TESTIMONIALS],
  [[SITE_TYPES.pricing], PRICING],
  [[SITE_TYPES.logos], LOGOS],
  [[SITE_TYPES.map], MAP],
  [[SITE_TYPES.whatsapp], WHATSAPP],
  [[SITE_TYPES.beforeAfter], BEFORE_AFTER],
  [[SITE_TYPES.newsletterSubscribe, SITE_TYPES.newsletterIssues], NEWSLETTER],
]

/** Structural rules for what the page uses (`''` when nothing). */
export function elementsCss(usage: ElementCssUsage, editing: boolean): string {
  const rules: string[] = []
  for (const [types, block] of BY_TYPE) {
    if (types.some((type) => usage.types.has(type))) rules.push(...block)
  }
  if (usage.animations) rules.push(...ANIMATIONS)
  if (usage.interactions) rules.push(...INTERACTIONS)
  if (rules.length) rules.push(REDUCED_MOTION)
  if (editing) rules.push(...EDITOR)
  return rules.join('\n')
}

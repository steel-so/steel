import { createHash } from 'node:crypto'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { AbRuntimeEntry, RuntimeExperiment } from './experiments'
import { SITE_FORM_SUBMITTED_EVENT } from './runtime-script'
import { siteVisitorHash } from './visitor'

/**
 * Server side of site A/B tests (s4-ab): the visitor key, the consent-aware
 * cookie, the content fingerprints and the small inline tracking script.
 *
 * Visitor key (LGPD): an opaque hash, never an IP or e-mail.
 * - Without consent it is derived from the daily visitor hash of the
 *   analytics (`siteVisitorHash`): nothing is stored on the device, so the
 *   assignment holds for the day only.
 * - When the visitor accepts the site's cookie banner, the script stores the
 *   same key in a first-party cookie (`ss-ab-<slug>`), so the visitor keeps
 *   their variant on the next visits.
 */

export const AB_CONFIG_ID = 'ss-ab'
export const AB_COOKIE_DAYS = 90
export const SITE_CONSENT_EVENT = 'steel:site-consent'

const KEY_PATTERN = /^[a-f0-9]{32}$/

export function abCookieName(slug: string): string {
  return `ss-ab-${slug}`
}

/** The key stored in the A/B cookie, when it is one we wrote. */
export function parseAbCookie(value: string | null | undefined): string | null {
  return value && KEY_PATTERN.test(value) ? value : null
}

/** Key of a visitor: the cookie's (after consent) or one derived from the
 * daily visitor hash. */
export function resolveAbVisitorKey(input: {
  cookie: string | null | undefined
  ip: string
  userAgent: string
  siteId: string
  secret: string
  now: Date
}): string {
  const stored = parseAbCookie(input.cookie)
  if (stored) return stored
  const daily = siteVisitorHash(input)
  return createHash('sha256').update(`ab|${daily}`).digest('hex').slice(0, 32)
}

/** JSON with sorted keys (same content, same string). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, 24)
}

function subtree(doc: CanvasDocument, id: string) {
  const nodes: CanvasDocument['nodes'] = {}
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop() as string
    const node = doc.nodes[current]
    if (!node) continue
    nodes[current] = node
    stack.push(...(node.children ?? []))
  }
  return nodes
}

export const MISSING_FINGERPRINT = 'missing'

/** Hash of each variant's content in a set of pages (published snapshot or
 * draft): a change means the test is no longer measuring the same thing. */
export function variantFingerprints(
  experiment: Pick<
    RuntimeExperiment,
    'kind' | 'pageId' | 'controlNodeId' | 'variants'
  >,
  pages: Array<{ id: string; document: CanvasDocument }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  const testPage = pages.find((page) => page.id === experiment.pageId)
  for (const variant of experiment.variants) {
    if (experiment.kind === 'PAGE') {
      const page = pages.find((item) => item.id === variant.pageId)
      out[variant.key] = page ? digest(page.document) : MISSING_FINGERPRINT
    } else {
      const node = variant.nodeId
        ? testPage?.document.nodes[variant.nodeId]
        : undefined
      out[variant.key] =
        node && testPage && variant.nodeId
          ? digest(subtree(testPage.document, variant.nodeId))
          : MISSING_FINGERPRINT
    }
  }
  return out
}

/** Variants whose content differs between two fingerprint sets. */
export function changedVariants(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  return Object.keys(after).filter((key) => before[key] !== after[key])
}

// ─── runtime script ──────────────────────────────────────────────────────

export interface AbRuntimeConfig {
  slug: string
  /** Visitor key (stored as the cookie after consent). */
  k: string
  cookie: string
  days: number
  /** The site's banner is on: beacons wait for consent (like the views). */
  ask: boolean
  e: AbRuntimeEntry[]
}

export function abRuntimeConfig(input: {
  slug: string
  visitorKey: string
  bannerEnabled: boolean
  entries: AbRuntimeEntry[]
}): AbRuntimeConfig {
  return {
    slug: input.slug,
    k: input.visitorKey,
    cookie: abCookieName(input.slug),
    days: AB_COOKIE_DAYS,
    ask: input.bannerEnabled,
    e: input.entries,
  }
}

export function serializeAbConfig(config: AbRuntimeConfig): string {
  return JSON.stringify(config).replace(/</g, '\\u003c')
}

/**
 * Exposure and conversion beacons of the tests on the page. Same consent
 * rule as the page views (right away without a banner, after "Aceitar"
 * with one); the cookie is written only after "Aceitar". The server
 * recomputes the variant from the key, so the beacon carries only the test
 * id and the event kind.
 */
export const SITE_AB_SCRIPT = `(function(){
var el=document.getElementById('${AB_CONFIG_ID}');if(!el)return;
var c;try{c=JSON.parse(el.textContent||'')}catch(e){return}
var key='steel-site-consent:'+c.slug,ready=false,done={};
function consent(){try{return localStorage.getItem(key)}catch(e){return null}}
function persist(){try{var d=new Date(Date.now()+c.days*864e5);document.cookie=c.cookie+'='+c.k+'; expires='+d.toUTCString()+'; path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'')}catch(e){}}
function post(ev){if(!ev.length)return;try{fetch('/api/sites/'+encodeURIComponent(c.slug)+'/experiments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:ev}),keepalive:true,credentials:'same-origin'}).catch(function(){})}catch(e){}}
function convert(id){if(!ready||done[id])return;done[id]=1;post([{experimentId:id,kind:'CONVERSION'}])}
function start(){if(ready)return;ready=true;var ev=[];
c.e.forEach(function(x){if(x.x)ev.push({experimentId:x.id,kind:'EXPOSURE'})});
c.e.forEach(function(x){if(x.g&&x.g.t==='page'&&!done[x.id]){done[x.id]=1;ev.push({experimentId:x.id,kind:'CONVERSION'})}});
post(ev)}
document.addEventListener('${SITE_FORM_SUBMITTED_EVENT}',function(e){var a=(e&&e.detail&&e.detail.action)||'',m=/\\/forms\\/([^/?#]+)\\/submit/.exec(a),tok=m?decodeURIComponent(m[1]):'';
c.e.forEach(function(x){if(x.g&&x.g.t==='form'&&(!x.g.f||x.g.f===tok))convert(x.id)})});
document.addEventListener('click',function(e){var t=e.target;if(!t||t.nodeType!==1)return;
c.e.forEach(function(x){if(x.g&&x.g.t==='click'){var n=document.getElementById(x.g.a);if(n&&n.contains(t))convert(x.id)}})},true);
document.addEventListener('${SITE_CONSENT_EVENT}',function(e){if(e&&e.detail==='accepted'){persist();start()}});
if(consent()==='accepted')persist();
if(!c.ask||consent()==='accepted')start();
})();`

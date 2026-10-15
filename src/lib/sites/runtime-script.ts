import { hasTrackers, type SiteTrackingIds } from './csp'

/**
 * Consent, metrics and trackers of a published page, as one small inline
 * script (no React on the client). The page renders the cookie banner
 * hidden and a JSON config (`SITE_RUNTIME_CONFIG_ID`); the script:
 *
 * - sends the anonymous page view to `/api/sites/<slug>/views` — right
 *   away when the site has no cookie banner, after "Aceitar" when it has;
 *   with the UTM parameters and the CRM campaign link token (`stc`), which
 *   attribute the view to a campaign (ADR 0025);
 * - records a CONVERSION when a CRM form of the page is sent
 *   (`steel:site-form-submitted`, dispatched by `SITE_FORM_SCRIPT`), under
 *   the same rule;
 * - loads Google Analytics 4, Google Tag Manager and the Meta Pixel **only
 *   after the visitor accepts** (LGPD): a site with trackers always shows
 *   the banner, even when its own banner switch is off. The scripts carry
 *   the page's nonce (allowed by the site's CSP, see `csp.ts`).
 *
 * The choice lives in `localStorage` (`steel-site-consent:<slug>`); nothing
 * else is stored on the device by Steel.
 */

export const SITE_RUNTIME_CONFIG_ID = 'ss-config'
export const SITE_COOKIE_BANNER_ID = 'ss-cookie'
export const SITE_FORM_SUBMITTED_EVENT = 'steel:site-form-submitted'

export interface SiteRuntimeConfig {
  slug: string
  pageId: string
  /** Public path recorded with the view (`/`, `/contato`). */
  path: string
  /** The site's cookie banner is on: views wait for consent too. */
  banner: boolean
  tracking: { ga?: string; gtm?: string; pixel?: string }
}

export function siteRuntimeConfig(input: {
  slug: string
  pageId: string
  path: string
  bannerEnabled: boolean
  tracking: SiteTrackingIds | undefined
}): SiteRuntimeConfig {
  const tracking = input.tracking ?? {}
  return {
    slug: input.slug,
    pageId: input.pageId,
    path: input.path,
    banner: input.bannerEnabled,
    tracking: {
      ...(tracking.googleAnalyticsId ? { ga: tracking.googleAnalyticsId } : {}),
      ...(tracking.googleTagManagerId
        ? { gtm: tracking.googleTagManagerId }
        : {}),
      ...(tracking.metaPixelId ? { pixel: tracking.metaPixelId } : {}),
    },
  }
}

/** The banner shows when the site turned it on or uses any tracker. */
export function showsCookieBanner(input: {
  bannerEnabled: boolean
  tracking: SiteTrackingIds | undefined
}): boolean {
  return input.bannerEnabled || hasTrackers(input.tracking)
}

/** JSON of the config for a `<script type="application/json">` (`<` is
 * escaped so no value can close the element). */
export function serializeRuntimeConfig(config: SiteRuntimeConfig): string {
  return JSON.stringify(config).replace(/</g, '\\u003c')
}

export const SITE_RUNTIME_SCRIPT = `(function(){
var el=document.getElementById('${SITE_RUNTIME_CONFIG_ID}');if(!el)return;
var c;try{c=JSON.parse(el.textContent||'')}catch(e){return}
var t=c.tracking||{},cs=document.currentScript,nonce=(cs&&cs.nonce)||'';
var key='steel-site-consent:'+c.slug,granted=false;
var anyTracker=!!(t.ga||t.gtm||t.pixel),ask=c.banner||anyTracker;
function read(){try{var v=localStorage.getItem(key);return v==='accepted'||v==='rejected'?v:null}catch(e){return null}}
function write(v){try{localStorage.setItem(key,v)}catch(e){}}
function send(b){try{fetch('/api/sites/'+encodeURIComponent(c.slug)+'/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),keepalive:true}).catch(function(){})}catch(e){}}
function view(){var q=new URLSearchParams(location.search),b={pageId:c.pageId,path:c.path};if(document.referrer)b.referrer=document.referrer;['source','medium','campaign','term','content'].forEach(function(k){var v=q.get('utm_'+k);if(v)b['utm'+k.charAt(0).toUpperCase()+k.slice(1)]=v});var r=q.get('stc');if(r)b.ref=r;send(b)}
function load(src){var s=document.createElement('script');s.async=true;s.src=src;if(nonce)s.setAttribute('nonce',nonce);document.head.appendChild(s)}
function trackers(){
if(t.ga||t.gtm){window.dataLayer=window.dataLayer||[]}
if(t.ga){window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',t.ga);load('https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(t.ga))}
if(t.gtm){window.dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});load('https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(t.gtm))}
if(t.pixel&&!window.fbq){var f=window.fbq=function(){f.callMethod?f.callMethod.apply(f,arguments):f.queue.push(arguments)};window._fbq=f;f.push=f;f.loaded=true;f.version='2.0';f.queue=[];f('init',t.pixel);f('track','PageView');load('https://connect.facebook.net/en_US/fbevents.js')}
}
function grant(){if(granted)return;granted=true;if(c.banner)view();trackers()}
document.addEventListener('${SITE_FORM_SUBMITTED_EVENT}',function(e){
if(c.banner&&!granted)return;
var a=(e&&e.detail&&e.detail.action)||'',m=/\\/forms\\/([^/?#]+)\\/submit/.exec(a),b={pageId:c.pageId,path:c.path,kind:'CONVERSION'};
if(m)b.formToken=decodeURIComponent(m[1]);send(b);
if(!granted)return;
if(t.ga&&window.gtag)window.gtag('event','generate_lead');
if(t.gtm&&window.dataLayer)window.dataLayer.push({event:'steel_form_submit'});
if(t.pixel&&window.fbq)window.fbq('track','Lead');
});
if(!c.banner)view();
if(!ask)return;
var choice=read();
if(choice==='accepted'){grant();return}
if(choice==='rejected')return;
var bn=document.getElementById('${SITE_COOKIE_BANNER_ID}');if(!bn)return;
bn.hidden=false;
bn.addEventListener('click',function(e){var x=e.target&&e.target.closest&&e.target.closest('[data-consent]');if(!x)return;var v=x.getAttribute('data-consent')==='accepted'?'accepted':'rejected';write(v);bn.hidden=true;if(v==='accepted')grant()});
})();`

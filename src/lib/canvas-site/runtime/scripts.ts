/**
 * The public runtime of the site elements: one small vanilla script per
 * feature, inlined (with the CSP nonce) only on pages that use it — see
 * `siteRuntimeScripts`. Plain ES5 inside strings on purpose: they run in
 * the visitor's browser as written (no bundler, no editor code), are
 * idempotent per element, and every element they enhance already works or
 * reads well without them. Tested in jsdom (`canvas-site-runtime.test.ts`).
 *
 * Shared conventions: `data-s-*` attributes carry configuration, user
 * strings come from attributes (never evaluated), and motion is skipped
 * when the visitor prefers reduced motion.
 */

/** Runs first, before the content parses: marks JavaScript as available so
 * CSS can hide what the scripts will reveal (tabs, scroll animations)
 * without a flash. */
export const SITE_BOOT_SCRIPT = `document.documentElement.classList.add('s-js');`

const REDUCE = `var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;`

/** Carousels and the testimonials slider: arrows, dots, keyboard, loop,
 * autoplay (paused on hover, focus, touch and by its button) over a
 * scroll-snap track that already swipes on its own. */
export const SITE_CAROUSEL_SCRIPT = `(function(){${REDUCE}
var all=document.querySelectorAll('[data-s-carousel]');
Array.prototype.forEach.call(all,function(root){
var track=root.querySelector('.s-carousel-track');if(!track)return;
var slides=Array.prototype.slice.call(track.children),n=slides.length;if(!n)return;
var dots=root.querySelectorAll('[data-s-dot]'),prev=root.querySelector('[data-s-prev]'),next=root.querySelector('[data-s-next]'),pause=root.querySelector('[data-s-pause]');
var loop=root.hasAttribute('data-loop'),ms=(parseFloat(root.getAttribute('data-autoplay'))||0)*1000,timer=null,paused=false,t=null;
slides.forEach(function(s,i){s.setAttribute('role','group');s.setAttribute('aria-roledescription','slide');s.setAttribute('aria-label',(i+1)+' de '+n)});
function left(){return track.getBoundingClientRect().left}
function index(){var base=left(),best=0,min=Infinity;for(var i=0;i<n;i++){var d=Math.abs(slides[i].getBoundingClientRect().left-base);if(d<min){min=d;best=i}}return best}
function atEnd(){return track.scrollLeft+track.clientWidth>=track.scrollWidth-2}
function go(i){if(i<0)i=loop?n-1:0;if(i>=n)i=loop?0:n-1;track.scrollTo({left:track.scrollLeft+slides[i].getBoundingClientRect().left-left(),behavior:reduce?'auto':'smooth'})}
function step(){if(atEnd()){if(loop)go(0)}else go(index()+1)}
function update(){var i=index(),box=track.getBoundingClientRect();
Array.prototype.forEach.call(dots,function(d,k){if(k===i)d.setAttribute('aria-current','true');else d.removeAttribute('aria-current')});
if(!loop){if(prev)prev.disabled=track.scrollLeft<=2;if(next)next.disabled=atEnd()}
slides.forEach(function(s){var r=s.getBoundingClientRect();s.inert=!(r.right>box.left+1&&r.left<box.right-1)})}
function halt(){clearInterval(timer);timer=null}
function play(){if(timer||paused||!ms||reduce)return;timer=setInterval(step,ms)}
function label(){if(!pause)return;pause.setAttribute('aria-pressed',paused?'true':'false');pause.setAttribute('aria-label',paused?'Retomar a passagem automática':'Pausar a passagem automática')}
function stop(){paused=true;halt();label()}
track.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(update,60)},{passive:true});
track.addEventListener('pointerdown',stop);
if(prev)prev.addEventListener('click',function(){stop();go(index()-1)});
if(next)next.addEventListener('click',function(){stop();step()});
Array.prototype.forEach.call(dots,function(d,k){d.addEventListener('click',function(){stop();go(k)})});
if(pause){if(!ms||reduce)pause.hidden=true;else pause.addEventListener('click',function(){paused=!paused;if(paused)halt();else play();label()})}
root.addEventListener('mouseenter',halt);root.addEventListener('mouseleave',play);
root.addEventListener('focusin',halt);root.addEventListener('focusout',function(e){if(!root.contains(e.relatedTarget))play()});
root.addEventListener('keydown',function(e){var tag=e.target&&e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;if(e.key==='ArrowLeft'){stop();go(index()-1)}else if(e.key==='ArrowRight'){stop();step()}});
label();update();play()})})();`

/** Tabs (WAI-ARIA pattern): click, arrows, Home/End; opens the tab whose
 * panel holds the URL's #anchor. */
export const SITE_TABS_SCRIPT = `(function(){
Array.prototype.forEach.call(document.querySelectorAll('[data-s-tabs]'),function(root){
var list=root.querySelector('[role=tablist]');if(!list)return;
var tabs=Array.prototype.slice.call(list.querySelectorAll('[role=tab]'));if(!tabs.length)return;
var vertical=list.getAttribute('aria-orientation')==='vertical';
function panel(t){return document.getElementById(t.getAttribute('aria-controls'))}
function select(t,focus){tabs.forEach(function(x){var on=x===t,p=panel(x);x.setAttribute('aria-selected',on?'true':'false');x.tabIndex=on?0:-1;if(p)p.hidden=!on});if(focus)t.focus()}
var start=tabs[0];
if(location.hash){var target=null;try{target=document.getElementById(decodeURIComponent(location.hash.slice(1)))}catch(e){}
if(target)tabs.forEach(function(t){var p=panel(t);if(p&&p.contains(target))start=t})}
select(start,false);root.setAttribute('data-ready','');
tabs.forEach(function(t,i){t.addEventListener('click',function(){select(t,false)});
t.addEventListener('keydown',function(e){var j=-1,k=e.key;
if(k===(vertical?'ArrowDown':'ArrowRight'))j=(i+1)%tabs.length;else if(k===(vertical?'ArrowUp':'ArrowLeft'))j=(i-1+tabs.length)%tabs.length;else if(k==='Home')j=0;else if(k==='End')j=tabs.length-1;
if(j>=0){e.preventDefault();select(tabs[j],true)}})})})})();`

/** Popups (open on load, delay, scroll or exit intent, with frequency
 * capping; modal with focus kept inside and restored on close) and the
 * click interactions of any element (open/close popup, scroll to an
 * anchor, go to a link, show/hide an element). Links to `#popup-id` open
 * the popup too. The document-level listeners are bound once even if the
 * script runs again (previews). */
export const SITE_ACTIONS_SCRIPT = `(function(){${REDUCE}
var opener=null;
function byId(id){if(!id)return null;try{return document.getElementById(id)}catch(e){return null}}
function isPopup(el){return!!(el&&el.tagName==='DIALOG'&&el.hasAttribute('data-s-popup'))}
function store(session){try{return session?window.sessionStorage:window.localStorage}catch(e){return null}}
function open(d){if(!d||d.open)return;opener=document.activeElement;if(d.showModal)d.showModal();else d.setAttribute('open','')}
function close(d){if(!d||!d.open)return;if(d.close)d.close();else{d.removeAttribute('open');restore()}}
function restore(){if(opener&&opener.focus)opener.focus();opener=null}
Array.prototype.forEach.call(document.querySelectorAll('dialog[data-s-popup]'),function(d){
d.addEventListener('close',restore);
d.addEventListener('click',function(e){if(e.target!==d||!d.hasAttribute('data-overlay-close'))return;var r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close(d)});
var trigger=d.getAttribute('data-trigger');if(!trigger||trigger==='click')return;
var freq=d.getAttribute('data-freq')||'session',key='s-popup:'+location.pathname+':'+d.id,box=freq==='always'?null:store(freq==='session');
try{if(box&&box.getItem(key))return}catch(e){}
function fire(){if(document.querySelector('dialog[open]'))return;open(d);try{if(box)box.setItem(key,'1')}catch(e){}}
if(trigger==='load')fire();
else if(trigger==='delay')setTimeout(fire,(parseFloat(d.getAttribute('data-delay'))||0)*1000);
else if(trigger==='scroll'){var pct=(parseFloat(d.getAttribute('data-scroll'))||50)/100;var onScroll=function(){var max=document.documentElement.scrollHeight-window.innerHeight;if(max<=0||window.scrollY/max>=pct){window.removeEventListener('scroll',onScroll);fire()}};window.addEventListener('scroll',onScroll,{passive:true})}
else if(trigger==='exit'){var onOut=function(e){if(e.clientY<=0&&!e.relatedTarget){document.removeEventListener('mouseout',onOut);fire()}};document.addEventListener('mouseout',onOut)}});
function act(el,e){var a=el.getAttribute('data-s-action'),t=el.getAttribute('data-s-target'),target=byId(t);
if(a==='popup'){if(isPopup(target)){e.preventDefault();open(target)}}
else if(a==='close'){var own=el.closest('dialog');if(own)close(own);else Array.prototype.forEach.call(document.querySelectorAll('dialog[open]'),close)}
else if(a==='scroll'){if(target){e.preventDefault();var inPopup=el.closest('dialog');if(inPopup)close(inPopup);target.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'})}}
else if(a==='toggle'){if(target){e.preventDefault();var off=target.classList.toggle('s-off');el.setAttribute('aria-expanded',off?'false':'true')}}
else if(a==='link'){var href=el.getAttribute('data-s-href');if(href){e.preventDefault();if(el.hasAttribute('data-s-blank'))window.open(href,'_blank','noopener');else window.location.href=href}}}
if(!document.sActions){document.sActions=1;
document.addEventListener('click',function(e){var node=e.target;if(!node||!node.closest)return;
var x=node.closest('[data-s-close]');if(x&&x.closest('dialog')){close(x.closest('dialog'));return}
var el=node.closest('[data-s-action]');if(el){act(el,e);return}
var a=node.closest('a[href^="#"]');if(a){var p=null;try{p=byId(decodeURIComponent(a.getAttribute('href').slice(1)))}catch(err){}if(isPopup(p)){e.preventDefault();open(p)}}});
document.addEventListener('keydown',function(e){var el=e.target;if((e.key==='Enter'||e.key===' ')&&el&&el.matches&&el.matches('[data-s-action][role]')){act(el,e)}})}
if(location.hash){var initial=null;try{initial=byId(decodeURIComponent(location.hash.slice(1)))}catch(e){}if(isPopup(initial))open(initial)}})();`

const SVG = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`

/** Full-screen photos of a gallery: previous/next (buttons and arrow
 * keys), Esc and focus back on the photo that opened it. Without it the
 * photo link opens the image itself. */
export const SITE_LIGHTBOX_SCRIPT = `(function(){
var X='${SVG('M18 6 6 18M6 6l12 12')}',L='${SVG('M15 18l-6-6 6-6')}',R='${SVG('M9 18l6-6-6-6')}';
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('[data-s-lightbox]');if(!a)return;
var g=a.closest('[data-s-gallery]');if(!g)return;e.preventDefault();
var links=Array.prototype.slice.call(g.querySelectorAll('[data-s-lightbox]')),i=links.indexOf(a);
var d=document.createElement('dialog');d.className='s-lightbox';d.setAttribute('aria-label','Imagem ampliada');
d.innerHTML='<figure><img alt=""><figcaption></figcaption></figure><button type="button" class="s-lb-prev" aria-label="Imagem anterior">'+L+'</button><button type="button" class="s-lb-next" aria-label="Próxima imagem">'+R+'</button><button type="button" class="s-lb-close" aria-label="Fechar">'+X+'</button>';
var img=d.querySelector('img'),cap=d.querySelector('figcaption'),prev=d.querySelector('.s-lb-prev'),next=d.querySelector('.s-lb-next');
function show(k){i=(k+links.length)%links.length;var l=links[i],im=l.querySelector('img'),c=l.getAttribute('data-caption')||'';img.src=l.getAttribute('href');img.alt=im?im.alt:'';cap.textContent=c;cap.hidden=!c}
prev.hidden=next.hidden=links.length<2;
prev.addEventListener('click',function(){show(i-1)});next.addEventListener('click',function(){show(i+1)});
d.querySelector('.s-lb-close').addEventListener('click',function(){d.close()});
d.addEventListener('keydown',function(ev){if(ev.key==='ArrowLeft')show(i-1);else if(ev.key==='ArrowRight')show(i+1)});
d.addEventListener('click',function(ev){if(ev.target===d)d.close()});
d.addEventListener('close',function(){d.remove();if(links[i]&&links[i].focus)links[i].focus()});
(g.closest('.s-site')||document.body).appendChild(d);show(i);
if(d.showModal)d.showModal();else d.setAttribute('open','');
d.querySelector('.s-lb-close').focus()})})();`

/** Countdowns: ticks every second; shows the "ended" text at zero. */
export const SITE_COUNTDOWN_SCRIPT = `(function(){var els=document.querySelectorAll('[data-s-countdown]');if(!els.length)return;
var size={d:86400,h:3600,m:60,s:1},timer=null;
function tick(){var live=0;Array.prototype.forEach.call(els,function(el){if(el.hasAttribute('data-done'))return;
var rest=Math.floor((Date.parse(el.getAttribute('data-s-countdown'))-Date.now())/1000);
if(!(rest>0)){el.setAttribute('data-done','');el.removeAttribute('role');var p=document.createElement('p');p.className='s-cd-expired';p.textContent=el.getAttribute('data-expired')||'';el.replaceChildren(p);return}
live++;Array.prototype.forEach.call(el.querySelectorAll('[data-unit]'),function(n){var u=n.getAttribute('data-unit'),v=Math.floor(rest/size[u]);rest-=v*size[u];var text=v<10?'0'+v:String(v);if(n.textContent!==text)n.textContent=text})});
if(!live&&timer)clearInterval(timer)}
tick();timer=setInterval(tick,1000)})();`

/** Statistics count up from zero when they come into view. */
export const SITE_STATS_SCRIPT = `(function(){${REDUCE}
if(reduce||!('IntersectionObserver' in window))return;
function fmt(v,d){return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v)}
function each(el,fn){Array.prototype.forEach.call(el.querySelectorAll('[data-s-count]'),function(n){fn(n,parseFloat(n.getAttribute('data-s-count'))||0,parseInt(n.getAttribute('data-decimals')||'0',10),n.getAttribute('data-prefix')||'',n.getAttribute('data-suffix')||'')})}
function run(el){var dur=parseFloat(el.getAttribute('data-duration'))||1600;each(el,function(n,to,d,pre,suf){var t0=null;function frame(t){if(t0===null)t0=t;var k=Math.min(1,(t-t0)/dur),eased=1-Math.pow(1-k,3);n.textContent=pre+fmt(to*eased,d)+suf;if(k<1)requestAnimationFrame(frame)}requestAnimationFrame(frame)})}
var io=new IntersectionObserver(function(entries){entries.forEach(function(en){if(en.isIntersecting){io.unobserve(en.target);run(en.target)}})},{threshold:0.3});
Array.prototype.forEach.call(document.querySelectorAll('[data-s-stats]'),function(el){each(el,function(n,to,d,pre,suf){n.textContent=pre+fmt(0,d)+suf});io.observe(el)})})();`

/** Maps load Google Maps only after the visitor asks for it. */
export const SITE_MAP_SCRIPT = `(function(){document.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('[data-s-map-load]');if(!b)return;
var src=b.getAttribute('data-s-map-load')||'';if(src.indexOf('https://www.google.com/maps')!==0)return;var frame=b.closest('.s-map-frame');if(!frame)return;
var f=document.createElement('iframe');f.src=src;f.title=b.getAttribute('data-title')||'Mapa';f.setAttribute('loading','lazy');f.setAttribute('referrerpolicy','no-referrer-when-downgrade');f.setAttribute('allowfullscreen','');frame.replaceChildren(f);f.focus()})})();`

/** Before/after: the native range input drives the divider. */
export const SITE_BEFORE_AFTER_SCRIPT = `(function(){Array.prototype.forEach.call(document.querySelectorAll('[data-s-ba]'),function(el){var r=el.querySelector('.s-ba-range');if(!r)return;function set(){el.style.setProperty('--s-pos',r.value+'%')}r.addEventListener('input',set);set()})})();`

/** Entrance animations triggered when the element scrolls into view. */
export const SITE_REVEAL_SCRIPT = `(function(){var els=document.querySelectorAll('.s-reveal');if(!els.length)return;${REDUCE}
function show(el){el.classList.add('s-in')}
if(reduce||!('IntersectionObserver' in window)){Array.prototype.forEach.call(els,show);return}
var io=new IntersectionObserver(function(entries){entries.forEach(function(en){if(en.isIntersecting){show(en.target);io.unobserve(en.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:0.1});
Array.prototype.forEach.call(els,function(el){io.observe(el)})})();`

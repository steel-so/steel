/**
 * In-page DOM extractor. Kept as a plain string (not a serialized function)
 * so bundler helpers such as esbuild's `__name` never leak into the page.
 * Returns raw blocks (colors not normalized yet) and the font stacks used by
 * text; `clean-style.ts` finishes the job in Node.
 */

import type { RawBlock } from './clean-style'

export const MAX_BLOCKS = 400
export const MAX_DEPTH = 3

export interface RawExtraction {
  pageHeight: number
  blocks: RawBlock[]
  fontStacks: Array<[string, number]>
  title: string
}

export const EXTRACT_SCRIPT = `(() => {
  const MAX_BLOCKS = ${MAX_BLOCKS};
  const MAX_DEPTH = ${MAX_DEPTH};
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','LINK','META','HEAD','BR','WBR']);
  const LEAF = new Set(['IMG','VIDEO','PICTURE','CANVAS','SVG','IFRAME','INPUT','SELECT','TEXTAREA']);
  const KEYS = ['color','background-color','font-family','font-size','font-weight','line-height','text-align','border-radius','padding','display','grid-template-columns','flex-direction','gap','max-width','box-shadow'];
  let count = 0;
  const scrollY = window.scrollY || 0;

  function visible(el, cs, r) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    return r.width >= 4 && r.height >= 4;
  }
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue + ' ';
    return t.replace(/\\s+/g, ' ').trim();
  }
  function textOf(el) {
    const own = ownText(el);
    if (own) return own.slice(0, 120);
    if (el.children.length === 0) return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    return '';
  }
  function visibleChildren(el) {
    const out = [];
    for (const c of el.children) {
      if (SKIP.has(c.tagName)) continue;
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      if (visible(c, cs, r)) out.push({ el: c, cs, r });
    }
    return out;
  }
  function styleOf(el, cs, r, text) {
    const s = {};
    for (const k of KEYS) s[k] = cs.getPropertyValue(k);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') s['has-background-image'] = 'true';
    if (cs.position === 'fixed' || cs.position === 'sticky') s.position = cs.position;
    if (LEAF.has(el.tagName.toUpperCase()) && r.height > 0) s['aspect-ratio'] = (r.width / r.height).toFixed(2);
    if (cs.display.indexOf('flex') < 0) { delete s['flex-direction']; }
    if (cs.display.indexOf('grid') < 0) { delete s['grid-template-columns']; }
    return s;
  }
  function relevant(el, cs, r, text) {
    if (r.height < 12) return false;
    if (text) return true;
    const tag = el.tagName.toUpperCase();
    if (LEAF.has(tag) || tag === 'BUTTON' || tag === 'A' || tag === 'UL' || tag === 'NAV') return true;
    if (cs.backgroundImage !== 'none') return true;
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return true;
    return el.children.length > 0;
  }
  function build(item, depth) {
    if (count >= MAX_BLOCKS) return null;
    const { el, cs, r } = item;
    const text = textOf(el);
    if (depth > 1 && !relevant(el, cs, r, text)) return null;
    count++;
    const block = {
      y: r.top + scrollY,
      height: r.height,
      tag: el.tagName.toLowerCase(),
      style: styleOf(el, cs, r, text),
      text: text,
    };
    if (depth < MAX_DEPTH && !LEAF.has(el.tagName.toUpperCase())) {
      const kids = [];
      for (const c of visibleChildren(el).slice(0, 24)) {
        const b = build(c, depth + 1);
        if (b) kids.push(b);
      }
      if (kids.length) block.children = kids;
    }
    return block;
  }

  // Unwrap single-child wrappers (#__next, main, app roots) so that the
  // top level is the page sections.
  let root = document.body;
  for (let i = 0; i < 4; i++) {
    const kids = visibleChildren(root);
    if (kids.length !== 1) break;
    const only = kids[0];
    const rootRect = root.getBoundingClientRect();
    if (only.r.height < rootRect.height * 0.9) break;
    root = only.el;
  }
  const blocks = [];
  for (const c of visibleChildren(root)) {
    const b = build(c, 1);
    if (b) blocks.push(b);
  }

  const stacks = new Map();
  const all = document.body.querySelectorAll('*');
  const limit = Math.min(all.length, 3000);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    if (SKIP.has(el.tagName)) continue;
    if (!ownText(el)) continue;
    const ff = getComputedStyle(el).fontFamily;
    if (ff) stacks.set(ff, (stacks.get(ff) || 0) + 1);
  }
  const doc = document.documentElement;
  return {
    pageHeight: Math.max(doc.scrollHeight, document.body.scrollHeight),
    blocks: blocks,
    fontStacks: Array.from(stacks.entries()),
    title: document.title || '',
  };
})()`

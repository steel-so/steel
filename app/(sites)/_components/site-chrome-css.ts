import { SITE_ROOT_CLASS } from '@/src/lib/canvas-site'

/**
 * Styles of what the runtime adds around the catalog's output: the site's
 * cookie banner and the 404 page. Theme tokens (`--canvas-*`) come from the
 * site theme compiled by `compileSiteCss`.
 */
export const SITE_CHROME_CSS = `
.ss-cookie{position:fixed;inset-inline:12px;bottom:12px;z-index:50;margin-inline:auto;max-width:42rem;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:16px;border-radius:12px;border:1px solid var(--canvas-border,#e2e8f0);background:var(--canvas-background,#fff);color:var(--canvas-text,#0f172a);box-shadow:0 8px 24px rgb(15 23 42 / .12);font-size:.9rem;font-family:var(--s-font-body,system-ui,sans-serif)}
.ss-cookie p{margin:0;flex:1 1 16rem}
.ss-cookie a{color:var(--canvas-primary,#1d4ed8)}
.ss-cookie-actions{display:flex;gap:8px}
.ss-cookie button{min-height:40px;padding:8px 16px;border-radius:999px;border:1px solid var(--canvas-border,#e2e8f0);background:var(--canvas-background,#fff);color:inherit;font:inherit;cursor:pointer}
.ss-cookie button[data-primary]{background:var(--canvas-primary,#1d4ed8);border-color:var(--canvas-primary,#1d4ed8);color:var(--canvas-inverse,#fff)}
.ss-404{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 16px;text-align:center;background:#fff;color:#161c2d;font-family:system-ui,sans-serif}
.ss-404 h1{margin:0;font-size:1.75rem}
.ss-404 p{margin:0;color:#5c6272}
main>.${SITE_ROOT_CLASS}{min-height:60svh}
`.trim()

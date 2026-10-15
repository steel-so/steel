import { CONDITION_BADGE_ATTR } from '@/src/lib/canvas-email/catalog'

/**
 * Editor-only CSS injected in the canvas iframe (never in the output): the
 * "Mostrar se" badge on conditional sections and blocks. The iframe holds
 * the e-mail, not the app, so it cannot use the app's theme tokens.
 */
export const EMAIL_EDITOR_FRAME_CSS = `
[${CONDITION_BADGE_ATTR}]{position:relative;outline:1px dashed rgba(124,58,237,.6);outline-offset:-1px}
[${CONDITION_BADGE_ATTR}]::after{content:attr(${CONDITION_BADGE_ATTR});position:absolute;top:0;right:0;z-index:3;max-width:75%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:1px 8px;border-radius:0 0 0 6px;background:#7c3aed;color:#fff;font:600 10px/16px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.01em;pointer-events:none}
`

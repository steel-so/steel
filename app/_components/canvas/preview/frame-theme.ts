import type { PreviewTheme } from './theme-switcher'

/**
 * Puts a preview document (an iframe's) in light or dark. A real dark
 * preview sets `color-scheme` (native controls, scrollbars) plus the
 * `data-theme` / `dark` hooks that catalog CSS can answer to; nothing is
 * inverted. Clients that force dark mode (Gmail, Outlook) are a simulation
 * and keep their own inversion filter (`data-canvas-dark`).
 */
export function applyFrameTheme(
  doc: Document,
  theme: PreviewTheme,
  options: { simulate?: boolean } = {},
): void {
  const html = doc.documentElement
  const dark = theme === 'dark'
  html.style.colorScheme = dark ? 'dark' : 'light'
  if (dark) {
    html.setAttribute('data-theme', 'dark')
    html.classList.add('dark')
  } else {
    html.removeAttribute('data-theme')
    html.classList.remove('dark')
  }
  if (dark && options.simulate) html.setAttribute('data-canvas-dark', '')
  else html.removeAttribute('data-canvas-dark')
}

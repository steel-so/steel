/**
 * A declaration value safe to put in a stylesheet: user-provided strings
 * (font families, image URLs, grid templates) cannot close the rule, open
 * a new one or leave the `<style>` element. Outside double-quoted strings
 * `{ } ; < > \` and line breaks are dropped; inside them (`url("…")`, font
 * names) only `<`, `>`, `\` and line breaks are encoded, so data URLs keep
 * their `;`. An unbalanced quote is closed.
 */
export function cssValue(value: string | number): string {
  if (typeof value === 'number') return String(value)
  const parts = value.split('"')
  const out = parts.map((part, index) =>
    index % 2 === 1
      ? part
          .replace(/[\n\r]/g, '')
          .replace(/\\/g, '%5C')
          .replace(/</g, '%3C')
          .replace(/>/g, '%3E')
      : part.replace(/[{};<>\\\n\r]/g, ''),
  )
  let joined = out.join('"')
  if (parts.length % 2 === 0) joined += '"'
  return joined.trim()
}

/** `fontSize` → `font-size`; custom properties and kebab keys unchanged. */
export function cssProperty(key: string): string {
  if (key.startsWith('--')) return key
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

/** `url("…")` for an image URL (the quote is encoded; `cssValue` takes
 * care of the rest when the rule is written). */
export function cssUrl(url: string): string {
  return `url("${url.trim().replace(/"/g, '%22')}")`
}

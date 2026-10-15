/**
 * Blog posts and collection items as `/llms.txt` sections (llmstxt.org:
 * Markdown links with a one-line summary). The site-search slice renders
 * the file; this adds the dynamic content to it. Pure.
 */

export interface LlmsLink {
  title: string
  url: string
  summary?: string
}

export interface LlmsSection {
  title: string
  links: LlmsLink[]
}

/** One line of Markdown (no line breaks, no stray brackets). */
function inline(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim()
}

/** `## Section` blocks with `- [title](url): summary` lines; empty
 * sections are left out. */
export function renderLlmsSections(sections: LlmsSection[]): string {
  return sections
    .filter((section) => section.links.length > 0)
    .map((section) => {
      const lines = section.links.map((link) => {
        const summary = link.summary ? `: ${inline(link.summary)}` : ''
        return `- [${inline(link.title)}](${link.url})${summary}`
      })
      return `## ${inline(section.title)}\n\n${lines.join('\n')}`
    })
    .join('\n\n')
}

/** `llms.txt` with the dynamic sections before its "Opcional" links (at
 * the end when there is none). */
export function withLlmsSections(
  llms: string,
  sections: LlmsSection[],
): string {
  const extra = renderLlmsSections(sections)
  if (!extra) return llms
  const marker = llms.indexOf('## Opcional')
  return marker === -1
    ? `${llms.trimEnd()}\n\n${extra}\n`
    : `${llms.slice(0, marker)}${extra}\n\n${llms.slice(marker)}`
}

import { BookOpen01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import type { AiCitationDTO } from '@/types/ai-knowledge'
import type { AiToolCallDTO } from '@/types/steel-ai'

/** The `steel_search` sources of a turn, in order, without repeats. */
export function citationsOf(
  toolCalls: readonly AiToolCallDTO[],
): AiCitationDTO[] {
  const seen = new Set<string>()
  const out: AiCitationDTO[] = []
  for (const call of toolCalls) {
    for (const citation of call.citations ?? []) {
      if (seen.has(citation.href)) continue
      seen.add(citation.href)
      out.push(citation)
    }
  }
  return out
}

/**
 * "Fontes" under a Steel AI answer (ADR 0037): every source the knowledge
 * search returned for the turn, each one a link to the record in the app.
 */
export function SteelAiCitations({
  citations,
}: {
  citations: readonly AiCitationDTO[]
}) {
  if (citations.length === 0) return null
  return (
    <section aria-label='Fontes consultadas' className='space-y-1.5'>
      <p className='flex items-center gap-1.5 font-medium text-muted-foreground text-xs'>
        <SteelIcon icon={BookOpen01Icon} strokeWidth={2} className='size-3.5' />
        Fontes
      </p>
      <ol className='grid gap-1'>
        {citations.map((citation, index) => (
          <li key={citation.href} className='min-w-0'>
            <Link
              href={citation.href}
              className='group flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            >
              <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
                {index + 1}.
              </span>
              <span className='min-w-0 flex-1 truncate text-foreground group-hover:underline'>
                {citation.title}
              </span>
              <span className='hidden shrink-0 text-muted-foreground text-xs sm:inline'>
                {citation.label}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

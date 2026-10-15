'use client'

import { AiSearchIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import type { SiteSearchAiSummaryDTO } from '@/types/site-search'

/**
 * "Como a IA resumiria esta página": one call to the workspace's AI
 * provider (CRM quota) reading the saved page like a generative engine
 * would, with what to change to be cited.
 */
export function AiSummaryCard({
  run,
  disabled,
}: {
  /** Saves pending edits and asks the server (`aiSummary`). */
  run: () => Promise<SiteSearchAiSummaryDTO>
  disabled?: boolean
}) {
  const [result, setResult] = useState<SiteSearchAiSummaryDTO | null>(null)
  const [loading, setLoading] = useState(false)

  async function ask() {
    setLoading(true)
    try {
      setResult(await run())
    } catch (error) {
      notify.error(error, 'A IA não conseguiu resumir a página')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      className='grid gap-2 rounded-md border p-3'
      data-testid='ai-summary'
      aria-busy={loading}
    >
      <div className='flex items-start gap-2'>
        <SteelIcon icon={AiSearchIcon} className='mt-0.5 size-4 text-primary' />
        <div className='grid flex-1 gap-0.5'>
          <p className='font-medium text-xs'>Como a IA resumiria esta página</p>
          <p className='text-[11px] text-muted-foreground'>
            Lê a versão salva como o ChatGPT, o Perplexity ou o Google fariam.
            Usa a cota de IA do workspace.
          </p>
        </div>
      </div>
      {result ? (
        <div className='grid gap-2 text-xs'>
          <blockquote className='border-l-2 pl-2 leading-relaxed'>
            {result.summary}
          </blockquote>
          {result.entities.length ? (
            <div className='flex flex-wrap gap-1'>
              {result.entities.map((entity) => (
                <span
                  key={entity}
                  className='rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]'
                >
                  {entity}
                </span>
              ))}
            </div>
          ) : null}
          {result.questions.length ? (
            <div className='grid gap-1'>
              <p className='font-medium text-muted-foreground text-[11px]'>
                Perguntas que ela responderia com esta página
              </p>
              <ul className='list-disc pl-4 text-muted-foreground'>
                {result.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.suggestions.length ? (
            <div className='grid gap-1'>
              <p className='font-medium text-muted-foreground text-[11px]'>
                Para ser citada com mais confiança
              </p>
              <ul className='list-disc pl-4'>
                {result.suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <div>
        <Button
          type='button'
          size='xs'
          variant='outline'
          disabled={disabled || loading}
          onClick={() => void ask()}
        >
          {loading
            ? 'Lendo a página…'
            : result
              ? 'Resumir de novo'
              : 'Ver resumo da IA'}
        </Button>
      </div>
    </section>
  )
}

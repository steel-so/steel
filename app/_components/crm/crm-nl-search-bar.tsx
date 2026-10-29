'use client'

import { Cancel01Icon, SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { useCrmNlSearch } from '@/src/hooks/use-crm-nl-search'
import type { CrmNlSearchResultDTO } from '@/types/crm-nl-search'

const EXAMPLES = [
  'Negócios parados há 15 dias acima de 10 mil',
  'Meus negócios que fecham este mês',
  'Em negociação sem responsável',
]

/**
 * Pergunta livre sobre as oportunidades (C10). O resultado volta como lista
 * de ids + as frases de como a pergunta foi lida; quem usa a barra filtra a
 * tabela com elas e limpa com `onResult(null)`.
 */
export function CrmNlSearchBar({
  workspaceId,
  onResult,
}: {
  workspaceId: string
  onResult: (result: CrmNlSearchResultDTO | null) => void
}) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<CrmNlSearchResultDTO | null>(null)
  const search = useCrmNlSearch(workspaceId)

  function run(text: string) {
    const trimmed = text.trim()
    if (trimmed.length < 2 || search.isPending) return
    search.mutate(trimmed, {
      onSuccess: (data) => {
        setResult(data)
        onResult(data)
      },
      onError: (error) => notify.error(error.message),
    })
  }

  function clear() {
    setQuery('')
    setResult(null)
    onResult(null)
  }

  return (
    <div className='flex shrink-0 flex-col gap-2 px-4 pt-4'>
      <form
        className='flex items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          run(query)
        }}
      >
        <div className='relative min-w-0 flex-1'>
          <SteelIcon
            icon={SparklesIcon}
            strokeWidth={2}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-primary'
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Pergunte em português: “${EXAMPLES[0].toLowerCase()}”`}
            aria-label='Pergunte sobre as oportunidades'
            maxLength={300}
            className='h-9 pl-8'
          />
        </div>
        <Button
          type='submit'
          size='sm'
          disabled={query.trim().length < 2 || search.isPending}
        >
          {search.isPending ? 'Buscando…' : 'Perguntar'}
        </Button>
        {result ? (
          <Button type='button' variant='ghost' size='sm' onClick={clear}>
            <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
            Limpar
          </Button>
        ) : null}
      </form>
      {result ? (
        <div
          className='flex flex-wrap items-center gap-1.5'
          aria-live='polite'
          data-testid='nl-search-summary'
        >
          <span className='text-muted-foreground text-xs'>
            {result.opportunities.length === 0
              ? 'Nenhuma oportunidade encontrada'
              : `${result.opportunities.length}${result.truncated ? '+' : ''} ${
                  result.opportunities.length === 1
                    ? 'oportunidade'
                    : 'oportunidades'
                }`}{' '}
            · entendi:
          </span>
          {result.interpretation.map((chip) => (
            <Badge key={chip} variant='secondary'>
              {chip}
            </Badge>
          ))}
        </div>
      ) : (
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='text-muted-foreground text-xs'>Experimente:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type='button'
              className='rounded-md border px-2 py-0.5 text-muted-foreground text-xs hover:bg-muted'
              onClick={() => {
                setQuery(example)
                run(example)
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

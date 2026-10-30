'use client'

import { Cancel01Icon, SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { useCrmNlSearch } from '@/src/hooks/use-crm-nl-search'
import {
  type CrmNlAnyResult,
  type CrmNlSearchEntityKey,
  nlResultIds,
} from './crm-nl-search-result'

interface EntityCopy {
  /** aria-label of the question field. */
  label: string
  singular: string
  plural: string
  /** Feminine nouns take "Nenhuma … encontrada". */
  none: string
  examples: string[]
}

const ENTITY_COPY: Record<CrmNlSearchEntityKey, EntityCopy> = {
  opportunities: {
    label: 'Pergunte sobre as oportunidades',
    singular: 'oportunidade',
    plural: 'oportunidades',
    none: 'Nenhuma oportunidade encontrada',
    examples: [
      'Negócios parados há 15 dias acima de 10 mil',
      'Meus negócios que fecham este mês',
      'Em negociação sem responsável',
    ],
  },
  leads: {
    label: 'Pergunte sobre os leads',
    singular: 'lead',
    plural: 'leads',
    none: 'Nenhum lead encontrado',
    examples: [
      'Leads do WhatsApp parados há 7 dias',
      'Meus leads com score acima de 50',
      'Leads novos desta semana sem responsável',
    ],
  },
  people: {
    label: 'Pergunte sobre as pessoas',
    singular: 'pessoa',
    plural: 'pessoas',
    none: 'Nenhuma pessoa encontrada',
    examples: [
      'Diretores com e-mail da Acme',
      'Pessoas sem empresa vinculada',
      'Contatos criados este mês com telefone',
    ],
  },
  companies: {
    label: 'Pergunte sobre as empresas',
    singular: 'empresa',
    plural: 'empresas',
    none: 'Nenhuma empresa encontrada',
    examples: [
      'Empresas de alimentos com mais de 50 funcionários',
      'Minhas empresas do perfil ideal sem CNPJ',
      'Empresas ainda não consultadas na Receita',
    ],
  },
}

/**
 * Pergunta livre sobre oportunidades, leads, pessoas ou empresas (C10). O
 * resultado volta com os registros achados + as frases de como a pergunta foi
 * lida; quem usa a barra filtra a tabela com elas (`applyNlResult`) e limpa
 * com `onResult(null)`.
 */
export function CrmNlSearchBar({
  workspaceId,
  entity = 'opportunities',
  onResult,
}: {
  workspaceId: string
  entity?: CrmNlSearchEntityKey
  onResult: (result: CrmNlAnyResult | null) => void
}) {
  const copy = ENTITY_COPY[entity]
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<CrmNlAnyResult | null>(null)
  const search = useCrmNlSearch(workspaceId, entity)

  function run(text: string) {
    const trimmed = text.trim()
    if (trimmed.length < 2 || search.isPending) return
    search.mutate(trimmed, {
      onSuccess: (data: CrmNlAnyResult) => {
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

  const total = result ? nlResultIds(result).length : 0

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
            placeholder={`Pergunte em português: “${copy.examples[0].toLowerCase()}”`}
            aria-label={copy.label}
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
            {total === 0
              ? copy.none
              : `${total}${result.truncated ? '+' : ''} ${
                  total === 1 ? copy.singular : copy.plural
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
          {copy.examples.map((example) => (
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

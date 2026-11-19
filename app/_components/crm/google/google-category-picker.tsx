'use client'

import { Cancel01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useSearchGoogleCategories } from '@/src/hooks/use-crm-google-presence'
import type { GoogleCategoryDTO } from '@/src/schemas/crm-google-presence.schema'

const MAX_ADDITIONAL = 9

/** Primary + additional categories, with Google's own category search. */
export function GoogleCategoryPicker({
  workspaceId,
  primary,
  additional,
  onChange,
  disabled,
}: {
  workspaceId: string
  primary: GoogleCategoryDTO | null
  additional: GoogleCategoryDTO[]
  onChange: (next: {
    primary: GoogleCategoryDTO | null
    additional: GoogleCategoryDTO[]
  }) => void
  disabled?: boolean
}) {
  const [term, setTerm] = useState('')
  const results = useSearchGoogleCategories(workspaceId, term)

  const chosen = new Set(
    [primary, ...additional]
      .filter((c): c is GoogleCategoryDTO => c !== null)
      .map((c) => c.name),
  )
  const options = (results.data ?? []).filter((c) => !chosen.has(c.name))

  function pick(category: GoogleCategoryDTO) {
    setTerm('')
    if (!primary) onChange({ primary: category, additional })
    else if (additional.length < MAX_ADDITIONAL) {
      onChange({ primary, additional: [...additional, category] })
    }
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        {primary ? (
          <Badge variant='default' className='h-6 gap-1.5 pr-1.5'>
            {primary.displayName}
            <span className='text-[10px] opacity-80'>principal</span>
          </Badge>
        ) : (
          <span className='text-muted-foreground text-sm'>
            Nenhuma categoria principal.
          </span>
        )}
        {additional.map((category) => (
          <Badge
            key={category.name}
            variant='secondary'
            className='h-6 gap-1 pr-1'
          >
            <button
              type='button'
              disabled={disabled}
              title='Tornar principal'
              className='hover:underline'
              onClick={() =>
                onChange({
                  primary: category,
                  additional: [
                    ...(primary ? [primary] : []),
                    ...additional.filter((c) => c.name !== category.name),
                  ],
                })
              }
            >
              {category.displayName}
            </button>
            <button
              type='button'
              disabled={disabled}
              aria-label={`Remover ${category.displayName}`}
              className='rounded-full p-0.5 hover:bg-foreground/10'
              onClick={() =>
                onChange({
                  primary,
                  additional: additional.filter(
                    (c) => c.name !== category.name,
                  ),
                })
              }
            >
              <SteelIcon icon={Cancel01Icon} size={11} />
            </button>
          </Badge>
        ))}
      </div>

      <div className='relative'>
        <Input
          value={term}
          disabled={disabled}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={
            primary
              ? 'Adicionar outra categoria…'
              : 'Buscar categoria (ex.: Pizzaria)'
          }
          aria-label='Buscar categoria'
        />
        {term.trim().length >= 2 ? (
          <ul className='absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md'>
            {results.isFetching && options.length === 0 ? (
              <li className='px-3 py-2 text-muted-foreground text-sm'>
                Buscando…
              </li>
            ) : options.length === 0 ? (
              <li className='px-3 py-2 text-muted-foreground text-sm'>
                Nenhuma categoria encontrada.
              </li>
            ) : (
              options.map((category) => (
                <li key={category.name}>
                  <button
                    type='button'
                    className='w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted'
                    onClick={() => pick(category)}
                  >
                    {category.displayName}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {primary ? (
        <p className='text-muted-foreground text-xs'>
          Até {MAX_ADDITIONAL} categorias adicionais. Clique no nome de uma
          categoria adicional para torná-la a principal.
        </p>
      ) : null}
    </div>
  )
}

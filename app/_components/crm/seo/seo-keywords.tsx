'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { siteSeoApi, siteSeoKeys } from '@/src/hooks/use-site-seo'
import {
  KEYWORD_DENSITY_MAX,
  type KeywordReportDTO,
  type KeywordStatus,
} from '@/src/lib/sites/search/seo-overview'
import { MAX_SEO_KEYWORDS_PER_SITE } from '@/src/schemas/site-seo.schema'

const STATUS: Record<
  KeywordStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
  }
> = {
  ok: { label: 'Bem usada', variant: 'secondary' },
  weak: { label: 'Só no texto', variant: 'outline' },
  dense: { label: 'Repetida demais', variant: 'destructive' },
  missing: { label: 'Ausente', variant: 'destructive' },
}

const yesNo = (value: boolean) => (value ? 'Sim' : 'Não')

/**
 * Keywords tracked by the site: manual registration, where each one shows
 * up in the pages (title, description, headings, density) and the gaps.
 */
export function SeoKeywords({
  workspaceId,
  siteId,
  slug,
  keywords,
  canEdit,
}: {
  workspaceId: string
  siteId: string
  slug: string
  keywords: KeywordReportDTO[]
  canEdit: boolean
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const api = useMemo(() => siteSeoApi(workspaceId), [workspaceId])
  const [term, setTerm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: siteSeoKeys.all(workspaceId) })

  async function add(event: FormEvent) {
    event.preventDefault()
    const value = term.trim()
    if (value.length < 2) {
      setError('Digite ao menos 2 caracteres.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await api.addKeyword(siteId, { term: value })
      setTerm('')
      await refresh()
    } catch (failure) {
      const message =
        failure instanceof Error
          ? failure.message
          : 'Não foi possível acompanhar a palavra-chave'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(keyword: KeywordReportDTO) {
    try {
      await api.removeKeyword(siteId, keyword.id)
      await refresh()
    } catch (failure) {
      notify.error(failure, 'Não foi possível remover a palavra-chave')
    }
  }

  return (
    <div className='grid gap-4' data-testid='seo-keywords'>
      {canEdit ? (
        <form onSubmit={add} className='grid gap-1.5' noValidate>
          <Label htmlFor={`${id}-term`}>Acompanhar uma palavra-chave</Label>
          <div className='flex gap-2'>
            <Input
              id={`${id}-term`}
              value={term}
              maxLength={100}
              placeholder='Ex.: clareamento dental em São Paulo'
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => setTerm(event.target.value)}
            />
            <Button type='submit' disabled={busy || !term.trim()}>
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Acompanhar
            </Button>
          </div>
          {error ? (
            <p
              id={`${id}-error`}
              role='alert'
              className='text-destructive text-xs'
            >
              {error}
            </p>
          ) : (
            <p className='text-muted-foreground text-xs'>
              Até {MAX_SEO_KEYWORDS_PER_SITE} por site. Mostramos onde o termo
              aparece nas páginas e o que falta. A posição no Google depende do
              Search Console.
            </p>
          )}
        </form>
      ) : null}

      {keywords.length === 0 ? (
        <div className='rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
          Nenhuma palavra-chave acompanhada ainda. Cadastre os termos pelos
          quais seus clientes procuram você.
        </div>
      ) : (
        <ul className='grid gap-3'>
          {keywords.map((keyword) => (
            <li
              key={keyword.id}
              className='grid gap-2 rounded-lg border p-3'
              data-keyword={keyword.term}
              data-status={keyword.status}
            >
              <div className='flex flex-wrap items-center gap-2'>
                <p className='min-w-0 flex-1 truncate font-medium text-sm'>
                  {keyword.term}
                </p>
                <Badge variant={STATUS[keyword.status].variant}>
                  {STATUS[keyword.status].label}
                </Badge>
                {canEdit ? (
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    aria-label={`Parar de acompanhar ${keyword.term}`}
                    onClick={() => void remove(keyword)}
                  >
                    <SteelIcon icon={Delete02Icon} className='size-4' />
                  </Button>
                ) : null}
              </div>
              {keyword.gaps.length ? (
                <ul className='grid gap-0.5 text-muted-foreground text-xs'>
                  {keyword.gaps.map((gap) => (
                    <li key={gap}>• {gap}</li>
                  ))}
                </ul>
              ) : null}
              {keyword.pages.length ? (
                <div className='relative w-full overflow-x-auto'>
                  <table className='w-full min-w-[520px] text-xs'>
                    <thead className='text-left text-muted-foreground'>
                      <tr>
                        <th className='py-1 pr-3 font-medium'>Página</th>
                        <th className='px-2 py-1 font-medium'>Vezes</th>
                        <th className='px-2 py-1 font-medium'>Densidade</th>
                        <th className='px-2 py-1 font-medium'>Título</th>
                        <th className='px-2 py-1 font-medium'>Descrição</th>
                        <th className='px-2 py-1 font-medium'>H1</th>
                        <th className='px-2 py-1 font-medium'>Principal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keyword.pages.map((page) => (
                        <tr key={page.id} className='border-t'>
                          <td className='max-w-48 truncate py-1 pr-3'>
                            <Link
                              href={`/${slug}/crm/sites/${siteId}?page=${page.id}`}
                              className='text-primary underline-offset-2 hover:underline'
                            >
                              {page.title}
                            </Link>
                          </td>
                          <td className='px-2 py-1 tabular-nums'>
                            {page.count}
                          </td>
                          <td
                            className={
                              page.density > KEYWORD_DENSITY_MAX
                                ? 'px-2 py-1 font-medium text-destructive tabular-nums'
                                : 'px-2 py-1 tabular-nums'
                            }
                          >
                            {page.density.toLocaleString('pt-BR')}%
                          </td>
                          <td className='px-2 py-1'>{yesNo(page.inTitle)}</td>
                          <td className='px-2 py-1'>
                            {yesNo(page.inDescription)}
                          </td>
                          <td className='px-2 py-1'>{yesNo(page.inH1)}</td>
                          <td className='px-2 py-1'>{yesNo(page.focus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

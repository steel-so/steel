'use client'

import {
  AiMagicIcon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useId, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  siteSearchApi,
  siteSearchKeys,
  useSiteSearchReport,
} from '@/src/hooks/use-site-search'
import {
  SEARCH_PILLAR_LABELS,
  SEARCH_PILLARS,
} from '@/src/lib/sites/search/types'
import {
  SEARCH_AI_FIELDS,
  type SearchAiField,
} from '@/src/schemas/site-search.schema'
import type { SiteSearchAiOptimizeDTO } from '@/types/site-search'
import { AiSuggestionsDialog } from './ai-suggestions-dialog'
import { PILLAR_HINTS, ScoreBar, ScoreRing, StatusIcon } from './search-ui'

const FIELD_LABELS: Record<SearchAiField, string> = {
  title: 'Títulos',
  description: 'Descrições',
  answers: 'Respostas diretas',
}

/** Pages per "Otimizar com IA" run (one provider call each). */
export const OPTIMIZE_MAX_PAGES = 10

/**
 * "Saúde nos buscadores": average scores, every page with its three scores
 * and the issues ranked by how many points they cost the site. Pages can
 * be selected for "Otimizar com IA" (preview before apply).
 */
export function SearchReport({
  workspaceId,
  slug,
  siteId,
  canEdit,
}: {
  workspaceId: string
  slug: string
  siteId: string
  canEdit: boolean
}) {
  const report = useSiteSearchReport(workspaceId, siteId)
  const queryClient = useQueryClient()
  const api = useMemo(() => siteSearchApi(workspaceId), [workspaceId])
  const id = useId()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fields, setFields] = useState<Set<SearchAiField>>(
    new Set(SEARCH_AI_FIELDS),
  )
  const [running, setRunning] = useState(false)
  const [suggestions, setSuggestions] =
    useState<SiteSearchAiOptimizeDTO | null>(null)

  if (report.isLoading) {
    return (
      <div className='grid gap-4' aria-busy='true'>
        <Skeleton className='h-28 w-full' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }
  if (report.error || !report.data) {
    return (
      <p className='text-muted-foreground text-sm'>
        Não foi possível montar o relatório. Tente novamente em instantes.
      </p>
    )
  }
  const data = report.data
  const allSelected =
    data.pages.length > 0 &&
    data.pages
      .slice(0, OPTIMIZE_MAX_PAGES)
      .every((page) => selected.has(page.id))

  const toggle = (pageId: string, value: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (value && next.size < OPTIMIZE_MAX_PAGES) next.add(pageId)
      else next.delete(pageId)
      return next
    })

  async function optimize() {
    setRunning(true)
    try {
      setSuggestions(
        await api.aiOptimize(siteId, {
          pageIds: [...selected],
          fields: [...fields],
        }),
      )
    } catch (error) {
      notify.error(error, 'A IA não conseguiu sugerir melhorias')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className='grid min-w-0 gap-6' data-testid='search-report'>
      <section
        className='grid gap-4 rounded-lg border p-4 sm:grid-cols-3'
        aria-label='Notas médias do site'
      >
        {SEARCH_PILLARS.map((pillar) => (
          <div key={pillar} className='flex items-center gap-3'>
            <ScoreRing
              score={data.averages[pillar]}
              label={SEARCH_PILLAR_LABELS[pillar]}
              size={64}
              active
            />
            <p className='text-muted-foreground text-xs'>
              {PILLAR_HINTS[pillar]}
            </p>
          </div>
        ))}
      </section>

      <section className='grid gap-3' aria-labelledby={`${id}-issues`}>
        <h2 id={`${id}-issues`} className='font-semibold text-base'>
          O que mais pesa
        </h2>
        {data.issues.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhum problema encontrado. Bom trabalho!
          </p>
        ) : (
          <ol className='grid gap-2'>
            {data.issues.map((issue) => {
              const worst = issue.pages.some((page) => page.status === 'fail')
                ? 'fail'
                : 'warn'
              return (
                <li
                  key={issue.checkId}
                  className='flex gap-3 rounded-md border p-3'
                  data-issue={issue.checkId}
                >
                  <StatusIcon status={worst} />
                  <div className='grid min-w-0 flex-1 gap-1'>
                    <p className='font-medium text-sm'>
                      {issue.label}{' '}
                      <span className='font-normal text-muted-foreground text-xs'>
                        · {SEARCH_PILLAR_LABELS[issue.pillar]}
                      </span>
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {issue.message}
                    </p>
                    <p className='truncate text-muted-foreground text-xs'>
                      {issue.pages.length === 1
                        ? `Em “${issue.pages[0].title}”`
                        : `Em ${issue.pages.length} páginas: ${issue.pages
                            .slice(0, 4)
                            .map((page) => page.title)
                            .join(', ')}${issue.pages.length > 4 ? '…' : ''}`}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section className='grid min-w-0 gap-3' aria-labelledby={`${id}-pages`}>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 id={`${id}-pages`} className='font-semibold text-base'>
              Páginas
            </h2>
            <p className='text-muted-foreground text-xs'>
              Selecione até {OPTIMIZE_MAX_PAGES} páginas para a IA sugerir
              melhorias. Você revisa antes de aplicar.
            </p>
          </div>
          {canEdit ? (
            <div className='flex flex-wrap items-center gap-3'>
              {SEARCH_AI_FIELDS.map((field) => (
                <div key={field} className='flex items-center gap-1.5'>
                  <Checkbox
                    id={`${id}-field-${field}`}
                    checked={fields.has(field)}
                    onCheckedChange={(value) =>
                      setFields((current) => {
                        const next = new Set(current)
                        if (value === true) next.add(field)
                        else next.delete(field)
                        return next
                      })
                    }
                  />
                  <Label
                    htmlFor={`${id}-field-${field}`}
                    className='font-normal text-xs'
                  >
                    {FIELD_LABELS[field]}
                  </Label>
                </div>
              ))}
              <Button
                size='sm'
                disabled={!selected.size || !fields.size || running}
                onClick={() => void optimize()}
                data-testid='search-optimize'
              >
                <SteelIcon icon={AiMagicIcon} data-icon='inline-start' />
                {running
                  ? 'Gerando sugestões…'
                  : `Otimizar com IA${selected.size ? ` (${selected.size})` : ''}`}
              </Button>
            </div>
          ) : null}
        </div>
        <div className='w-full min-w-0 overflow-x-auto rounded-lg border'>
          <table className='w-full min-w-[640px] text-sm'>
            <thead className='bg-muted/40 text-left text-muted-foreground text-xs'>
              <tr>
                {canEdit ? (
                  <th className='w-10 px-3 py-2'>
                    <Checkbox
                      aria-label='Selecionar páginas'
                      checked={allSelected}
                      onCheckedChange={(value) =>
                        setSelected(
                          value === true
                            ? new Set(
                                data.pages
                                  .slice(0, OPTIMIZE_MAX_PAGES)
                                  .map((page) => page.id),
                              )
                            : new Set(),
                        )
                      }
                    />
                  </th>
                ) : null}
                <th className='px-3 py-2 font-medium'>Página</th>
                {SEARCH_PILLARS.map((pillar) => (
                  <th key={pillar} className='px-3 py-2 font-medium'>
                    {SEARCH_PILLAR_LABELS[pillar]}
                  </th>
                ))}
                <th className='px-3 py-2 font-medium'>Pontos a melhorar</th>
                <th className='w-10 px-3 py-2'>
                  <span className='sr-only'>Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.pages.map((page) => (
                <tr key={page.id} className='border-t'>
                  {canEdit ? (
                    <td className='px-3 py-2'>
                      <Checkbox
                        aria-label={`Selecionar ${page.title}`}
                        checked={selected.has(page.id)}
                        onCheckedChange={(value) =>
                          toggle(page.id, value === true)
                        }
                      />
                    </td>
                  ) : null}
                  <td className='max-w-56 px-3 py-2'>
                    <p className='truncate font-medium'>{page.title}</p>
                    <p className='truncate text-muted-foreground text-xs'>
                      {page.path}
                    </p>
                  </td>
                  {SEARCH_PILLARS.map((pillar) => (
                    <td key={pillar} className='px-3 py-2'>
                      <ScoreBar
                        score={page.scores[pillar]}
                        label={`${SEARCH_PILLAR_LABELS[pillar]} de ${page.title}`}
                      />
                    </td>
                  ))}
                  <td className='px-3 py-2 text-muted-foreground text-xs tabular-nums'>
                    {page.issues}
                  </td>
                  <td className='px-3 py-2'>
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      nativeButton={false}
                      aria-label={`Editar ${page.title}`}
                      render={
                        <Link
                          href={`/${slug}/crm/sites/${siteId}?page=${page.id}`}
                        />
                      }
                    >
                      <SteelIcon icon={PencilEdit02Icon} className='size-4' />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AiSuggestionsDialog
        result={suggestions}
        onOpenChange={(open) => {
          if (!open) setSuggestions(null)
        }}
        onApply={async (items) => {
          try {
            await api.apply(siteId, { items })
            await queryClient.invalidateQueries({
              queryKey: siteSearchKeys.report(workspaceId, siteId),
            })
            setSelected(new Set())
            notify.success('Sugestões aplicadas ao rascunho.')
            return true
          } catch (error) {
            notify.error(error, 'Não foi possível aplicar as sugestões')
            return false
          }
        }}
      />
    </div>
  )
}

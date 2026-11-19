'use client'

import { Search01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useSiteSeoOverview } from '@/src/hooks/use-site-seo'
import { normalizeText } from '@/src/lib/sites/search/text'
import type { SiteSeoCardDTO } from '@/types/site-seo'
import { SEARCH_TONE_VARS } from '../sites/search/search-ui'
import { isSeoDetailTab, SeoDetail } from './seo-detail'
import { SeoSiteCard } from './seo-site-card'

export const SEO_FILTERS = [
  { value: 'all', label: 'Todos os sites' },
  { value: 'published', label: 'Publicados' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'issues', label: 'Com problemas' },
] as const
export type SeoFilter = (typeof SEO_FILTERS)[number]['value']

export const SEO_SORTS = [
  { value: 'worst', label: 'Pior nota primeiro' },
  { value: 'best', label: 'Melhor nota primeiro' },
  { value: 'issues', label: 'Mais problemas' },
  { value: 'name', label: 'Nome' },
] as const
export type SeoSort = (typeof SEO_SORTS)[number]['value']

/** Filters and sorts the site cards (pure, used by the screen and tests). */
export function filterSeoSites(
  sites: SiteSeoCardDTO[],
  options: { query: string; filter: SeoFilter; sort: SeoSort },
): SiteSeoCardDTO[] {
  const query = normalizeText(options.query)
  const matches = sites.filter((site) => {
    if (query && !normalizeText(`${site.name} ${site.slug}`).includes(query)) {
      return false
    }
    switch (options.filter) {
      case 'published':
        return site.status === 'PUBLISHED'
      case 'draft':
        return site.status === 'DRAFT'
      case 'issues':
        return site.issueCount > 0
      default:
        return true
    }
  })
  // Sites without pages have no score: they go last in score orders.
  const score = (site: SiteSeoCardDTO, fallback: number) =>
    site.hasData ? site.overall : fallback
  return [...matches].sort((a, b) => {
    switch (options.sort) {
      case 'best':
        return score(b, -1) - score(a, -1) || a.name.localeCompare(b.name)
      case 'issues':
        return b.issueCount - a.issueCount || a.name.localeCompare(b.name)
      case 'name':
        return a.name.localeCompare(b.name)
      default:
        return score(a, 101) - score(b, 101) || a.name.localeCompare(b.name)
    }
  })
}

function Summary({ sites }: { sites: SiteSeoCardDTO[] }) {
  const scored = sites.filter((site) => site.hasData)
  const average = scored.length
    ? Math.round(
        scored.reduce((sum, site) => sum + site.overall, 0) / scored.length,
      )
    : null
  const issues = sites.reduce((sum, site) => sum + site.issueCount, 0)
  const items = [
    { label: 'Sites', value: String(sites.length) },
    { label: 'Nota média', value: average === null ? '—' : String(average) },
    { label: 'Pontos a melhorar', value: String(issues) },
    {
      label: 'Keywords acompanhadas',
      value: String(sites.reduce((sum, site) => sum + site.keywordCount, 0)),
    },
  ]
  return (
    <dl className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
      {items.map((item) => (
        <div key={item.label} className='rounded-lg border p-3'>
          <dt className='text-muted-foreground text-xs'>{item.label}</dt>
          <dd className='font-semibold text-xl tabular-nums'>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * CRM > SEO: every site of the workspace with its SEO/AEO/GEO scores,
 * problems, worst pages and quick actions; `?site=` opens one site's detail.
 */
export function SeoScreen({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const overview = useSiteSeoOverview(workspaceId)
  const canEdit = useCan('landing-pages', 'EDIT')
  const router = useRouter()
  const params = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SeoFilter>('all')
  const [sort, setSort] = useState<SeoSort>('worst')

  const siteId = params.get('site')
  const requestedTab = params.get('tab')
  const tab = isSeoDetailTab(requestedTab) ? requestedTab : 'resumo'
  const base = `/${slug}/crm/seo`

  const visible = useMemo(
    () => filterSeoSites(overview.data?.sites ?? [], { query, filter, sort }),
    [overview.data, query, filter, sort],
  )

  if (siteId) {
    return (
      <div
        className={cn(
          'mx-auto grid w-full min-w-0 max-w-6xl gap-6 p-4 sm:p-6',
          SEARCH_TONE_VARS,
        )}
      >
        <SeoDetail
          workspaceId={workspaceId}
          slug={slug}
          siteId={siteId}
          canEdit={canEdit}
          tab={tab}
          onTab={(next) =>
            router.replace(`${base}?site=${siteId}&tab=${next}`, {
              scroll: false,
            })
          }
          onBack={() => router.push(base)}
        />
      </div>
    )
  }

  const sites = overview.data?.sites ?? []
  return (
    <div
      className={cn(
        'mx-auto grid w-full min-w-0 max-w-6xl gap-6 p-4 sm:p-6',
        SEARCH_TONE_VARS,
      )}
      data-testid='seo-screen'
    >
      <header className='grid gap-1'>
        <h1 className='font-semibold text-xl'>SEO</h1>
        <p className='text-muted-foreground text-sm'>
          Como seus sites aparecem no Google e no Bing, nas respostas diretas e
          nas IAs generativas. As notas vêm do rascunho de cada site.
        </p>
      </header>

      {overview.isLoading ? (
        <div className='grid gap-4' aria-busy='true'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      ) : overview.error ? (
        <div className='grid justify-items-start gap-2 text-sm'>
          <p className='text-muted-foreground'>
            Não foi possível carregar o SEO dos sites. Tente novamente.
          </p>
          <Button
            size='sm'
            variant='outline'
            onClick={() => void overview.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : sites.length === 0 ? (
        <div
          className='grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center'
          data-testid='seo-empty'
        >
          <p className='font-medium'>Você ainda não tem sites</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Crie um site para receber notas de SEO, AEO e GEO, acompanhar
            palavras-chave e ver o histórico de evolução.
          </p>
          <Button
            nativeButton={false}
            render={<Link href={`/${slug}/crm/sites`} />}
          >
            Criar meu primeiro site
          </Button>
        </div>
      ) : (
        <>
          <Summary sites={sites} />

          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative min-w-48 flex-1 sm:max-w-xs'>
              <SteelIcon
                icon={Search01Icon}
                className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground'
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='Buscar site'
                aria-label='Buscar site'
                className='pl-8'
              />
            </div>
            <Select
              value={filter}
              onValueChange={(value) => setFilter(value as SeoFilter)}
            >
              <SelectTrigger className='w-44' aria-label='Filtrar sites'>
                <span>
                  {SEO_FILTERS.find((item) => item.value === filter)?.label}
                </span>
              </SelectTrigger>
              <SelectContent>
                {SEO_FILTERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as SeoSort)}
            >
              <SelectTrigger className='w-52' aria-label='Ordenar sites'>
                <span>
                  {SEO_SORTS.find((item) => item.value === sort)?.label}
                </span>
              </SelectTrigger>
              <SelectContent>
                {SEO_SORTS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {visible.length === 0 ? (
            <p className='rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
              Nenhum site encontrado com esses filtros.
            </p>
          ) : (
            <div className='grid gap-4'>
              {visible.map((site) => (
                <SeoSiteCard
                  key={site.id}
                  workspaceId={workspaceId}
                  slug={slug}
                  site={site}
                  canEdit={canEdit}
                  onOpen={() => router.push(`${base}?site=${site.id}`)}
                />
              ))}
            </div>
          )}

          <p className='text-muted-foreground text-xs'>
            A posição real no Google depende da conexão com o Search Console,
            ainda não disponível. Veja a explicação na aba “Posição no Google”
            de cada site.
          </p>
        </>
      )}
    </div>
  )
}

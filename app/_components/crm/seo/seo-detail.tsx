'use client'

import {
  ArrowLeft01Icon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSiteSeoDetail } from '@/src/hooks/use-site-seo'
import {
  SEARCH_PILLAR_LABELS,
  SEARCH_PILLARS,
} from '@/src/lib/sites/search/types'
import type { SiteSeoDetailDTO } from '@/types/site-seo'
import {
  PILLAR_HINTS,
  ScoreBar,
  ScoreRing,
  StatusIcon,
} from '../sites/search/search-ui'
import { SiteStatusBadge } from '../sites/site-status-badge'
import {
  SEO_OPTIMIZE_MAX,
  SeoActionButtons,
  useSeoActions,
} from './seo-actions'
import { SeoHistoryChart } from './seo-history-chart'
import { SeoKeywords } from './seo-keywords'
import { SeoTechnical } from './seo-technical'

const TABS = [
  { value: 'resumo', label: 'Resumo' },
  { value: 'tecnico', label: 'Checklist técnico' },
  { value: 'palavras', label: 'Palavras-chave' },
  { value: 'historico', label: 'Histórico' },
  { value: 'google', label: 'Posição no Google' },
] as const

export type SeoDetailTab = (typeof TABS)[number]['value']

export function isSeoDetailTab(value: string | null): value is SeoDetailTab {
  return TABS.some((tab) => tab.value === value)
}

/** Pages of the site with their scores; selected ones go to the AI. */
function PagesTable({
  data,
  slug,
  canEdit,
  selected,
  onSelect,
}: {
  data: SiteSeoDetailDTO
  slug: string
  canEdit: boolean
  selected: Set<string>
  onSelect: (next: Set<string>) => void
}) {
  const limited = data.pages.slice(0, SEO_OPTIMIZE_MAX)
  const allSelected =
    limited.length > 0 && limited.every((page) => selected.has(page.id))
  return (
    <div className='relative w-full min-w-0 overflow-x-auto rounded-lg border'>
      <table className='w-full min-w-[640px] text-sm'>
        <thead className='bg-muted/40 text-left text-muted-foreground text-xs'>
          <tr>
            {canEdit ? (
              <th className='w-10 px-3 py-2'>
                <Checkbox
                  aria-label='Selecionar páginas'
                  checked={allSelected}
                  onCheckedChange={(value) =>
                    onSelect(
                      value === true
                        ? new Set(limited.map((page) => page.id))
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
            <th className='px-3 py-2 font-medium'>
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
                    onCheckedChange={(value) => {
                      const next = new Set(selected)
                      if (value === true && next.size < SEO_OPTIMIZE_MAX) {
                        next.add(page.id)
                      } else next.delete(page.id)
                      onSelect(next)
                    }}
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
                  size='xs'
                  variant='outline'
                  nativeButton={false}
                  render={
                    <Link
                      href={`/${slug}/crm/sites/${data.card.id}?page=${page.id}`}
                    />
                  }
                >
                  Editar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Summary({
  data,
  slug,
  canEdit,
  selected,
  onSelect,
}: {
  data: SiteSeoDetailDTO
  slug: string
  canEdit: boolean
  selected: Set<string>
  onSelect: (next: Set<string>) => void
}) {
  if (!data.card.hasData) {
    return (
      <div className='rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
        Este site ainda não tem páginas. Crie ao menos a página inicial no
        editor para ver as notas.
      </div>
    )
  }
  return (
    <div className='grid min-w-0 gap-6'>
      <section
        className='grid gap-4 rounded-lg border p-4 sm:grid-cols-3'
        aria-label='Notas médias do site'
      >
        {SEARCH_PILLARS.map((pillar) => (
          <div key={pillar} className='flex items-center gap-3'>
            <ScoreRing
              score={data.card.averages[pillar]}
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

      <section className='grid gap-2' aria-label='O que mais pesa'>
        <h2 className='font-semibold text-base'>O que mais pesa</h2>
        {data.issues.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhum problema encontrado. Bom trabalho!
          </p>
        ) : (
          <ol className='grid gap-2'>
            {data.issues.slice(0, 12).map((issue) => (
              <li
                key={issue.checkId}
                className='flex gap-3 rounded-md border p-3'
              >
                <StatusIcon
                  status={
                    issue.pages.some((page) => page.status === 'fail')
                      ? 'fail'
                      : 'warn'
                  }
                />
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
            ))}
          </ol>
        )}
      </section>

      <section className='grid min-w-0 gap-2' aria-label='Páginas'>
        <div>
          <h2 className='font-semibold text-base'>Páginas</h2>
          <p className='text-muted-foreground text-xs'>
            Ordenadas da pior para a melhor.
            {canEdit
              ? ` Marque até ${SEO_OPTIMIZE_MAX} para a IA sugerir melhorias (você revisa antes de aplicar).`
              : ''}
          </p>
        </div>
        <PagesTable
          data={data}
          slug={slug}
          canEdit={canEdit}
          selected={selected}
          onSelect={onSelect}
        />
      </section>
    </div>
  )
}

/** Where the Google ranking will live once Search Console is connected. */
function GoogleSection() {
  return (
    <section
      className='grid gap-3 rounded-lg border p-4'
      data-testid='seo-google'
      aria-label='Posição no Google'
    >
      <div className='flex items-center gap-2'>
        <SteelIcon icon={Search01Icon} className='size-4 text-primary' />
        <h2 className='font-semibold text-base'>Posição no Google</h2>
      </div>
      <p className='text-sm'>
        A posição real de cada palavra-chave no Google, os cliques e as
        impressões só existem no Google Search Console. Ainda não há conexão com
        ele no Steel, por isso não mostramos números inventados aqui.
      </p>
      <ul className='grid list-disc gap-1 pl-5 text-muted-foreground text-xs'>
        <li>
          A conexão será feita por workspace, com a conta Google de quem
          administra o site (leitura apenas).
        </li>
        <li>
          Depende da aprovação do app pelo Google; assim que sair, esta aba
          mostra posição média, cliques e impressões por palavra-chave e por
          página, ao lado do histórico de notas.
        </li>
        <li>
          Enquanto isso: acompanhe as palavras-chave na aba ao lado, publique
          com o IndexNow ligado e confira o site no Search Console pelo domínio.
        </li>
      </ul>
    </section>
  )
}

export function SeoDetail({
  workspaceId,
  slug,
  siteId,
  canEdit,
  tab,
  onTab,
  onBack,
}: {
  workspaceId: string
  slug: string
  siteId: string
  canEdit: boolean
  tab: SeoDetailTab
  onTab: (tab: SeoDetailTab) => void
  onBack: () => void
}) {
  const detail = useSiteSeoDetail(workspaceId, siteId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const card = detail.data?.card
  const actions = useSeoActions({
    workspaceId,
    site: { id: siteId, slug: card?.slug ?? siteId },
  })
  const worstIds = useMemo(
    () =>
      (detail.data?.pages ?? [])
        .filter((page) => page.issues > 0)
        .slice(0, 5)
        .map((page) => page.id),
    [detail.data],
  )

  return (
    <div className='grid min-w-0 gap-6' data-testid='seo-detail'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <Button
            size='icon-sm'
            variant='ghost'
            aria-label='Voltar para os sites'
            onClick={onBack}
          >
            <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
          </Button>
          {card ? (
            <>
              <h1 className='truncate font-semibold text-xl'>{card.name}</h1>
              <SiteStatusBadge status={card.status} />
            </>
          ) : (
            <Skeleton className='h-7 w-56' />
          )}
        </div>
        {card ? (
          <SeoActionButtons
            slug={slug}
            site={card}
            actions={actions}
            canEdit={canEdit}
            optimizeIds={selected.size ? [...selected] : worstIds}
          />
        ) : null}
      </header>

      {detail.isLoading ? (
        <div className='grid gap-4' aria-busy='true'>
          <Skeleton className='h-28 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      ) : detail.error || !detail.data ? (
        <div className='grid justify-items-start gap-2 text-sm'>
          <p className='text-muted-foreground'>
            Não foi possível carregar o SEO deste site. Tente novamente.
          </p>
          <Button
            size='sm'
            variant='outline'
            onClick={() => void detail.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : (
        <Tabs
          className='min-w-0'
          value={tab}
          onValueChange={(value) => isSeoDetailTab(value) && onTab(value)}
        >
          <TabsList className='max-w-full overflow-x-auto'>
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value='resumo' className='min-w-0 pt-4'>
            <Summary
              data={detail.data}
              slug={slug}
              canEdit={canEdit}
              selected={selected}
              onSelect={setSelected}
            />
          </TabsContent>
          <TabsContent value='tecnico' className='min-w-0 pt-4'>
            <SeoTechnical
              items={detail.data.technical}
              slug={slug}
              siteId={siteId}
            />
          </TabsContent>
          <TabsContent value='palavras' className='min-w-0 pt-4'>
            <SeoKeywords
              workspaceId={workspaceId}
              siteId={siteId}
              slug={slug}
              keywords={detail.data.keywords}
              canEdit={canEdit}
            />
          </TabsContent>
          <TabsContent value='historico' className='min-w-0 pt-4'>
            {detail.data.history.length < 2 ? (
              <div className='rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
                O histórico começa hoje: guardamos a nota de cada dia (todo dia
                às 05:10 e na primeira visita). Volte amanhã para ver a
                evolução.
              </div>
            ) : (
              <SeoHistoryChart points={detail.data.history} />
            )}
          </TabsContent>
          <TabsContent value='google' className='min-w-0 pt-4'>
            <GoogleSection />
          </TabsContent>
        </Tabs>
      )}
      {actions.dialog}
    </div>
  )
}

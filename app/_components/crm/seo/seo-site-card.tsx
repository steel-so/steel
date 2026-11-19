'use client'

import {
  ArrowRight01Icon,
  WebDesign01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SEARCH_PILLAR_LABELS,
  SEARCH_PILLARS,
} from '@/src/lib/sites/search/types'
import type { SiteSeoCardDTO, SiteSeoHistoryPointDTO } from '@/types/site-seo'
import { ScorePill, ScoreRing } from '../sites/search/search-ui'
import { SiteStatusBadge } from '../sites/site-status-badge'
import { SeoActionButtons, useSeoActions } from './seo-actions'

/** Mean-score trend as a tiny line (last days). */
function Trend({ points }: { points: SiteSeoHistoryPointDTO[] }) {
  if (points.length < 2) return null
  const width = 96
  const height = 28
  const step = width / (points.length - 1)
  const line = points
    .map(
      (point, index) =>
        `${(index * step).toFixed(1)},${(2 + (height - 4) * (1 - point.overall / 100)).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg
      role='img'
      aria-label={`Nota geral nos últimos ${points.length} dias`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className='shrink-0 overflow-visible text-primary'
    >
      <polyline
        points={line}
        fill='none'
        stroke='currentColor'
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null
  const text = value > 0 ? `+${value}` : String(value)
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        value > 0
          ? 'text-[var(--sx-good)]'
          : value < 0
            ? 'text-[var(--sx-poor)]'
            : 'text-muted-foreground',
      )}
      title='Variação da nota geral no período do gráfico'
    >
      {text} pts
    </span>
  )
}

/** "Comece por aqui" for a site that has no page to score yet. */
function GettingStarted({ slug, siteId }: { slug: string; siteId: string }) {
  return (
    <div className='grid gap-2 rounded-md border border-dashed p-4 text-sm'>
      <p className='font-medium'>
        Este site ainda não tem páginas para analisar.
      </p>
      <ol className='grid list-decimal gap-1 pl-5 text-muted-foreground text-xs'>
        <li>Abra o editor e crie ao menos a página inicial.</li>
        <li>
          Preencha título, descrição e a palavra-chave principal de cada página.
        </li>
        <li>Volte aqui: as notas de SEO, AEO e GEO aparecem sozinhas.</li>
      </ol>
      <div>
        <Button
          size='sm'
          nativeButton={false}
          render={<Link href={`/${slug}/crm/sites/${siteId}`} />}
        >
          Abrir editor
        </Button>
      </div>
    </div>
  )
}

export function SeoSiteCard({
  workspaceId,
  slug,
  site,
  canEdit,
  onOpen,
}: {
  workspaceId: string
  slug: string
  site: SiteSeoCardDTO
  canEdit: boolean
  onOpen: () => void
}) {
  const actions = useSeoActions({ workspaceId, site })
  return (
    <article
      className='grid gap-4 rounded-lg border p-4'
      data-testid='seo-site-card'
      data-site={site.id}
      aria-label={`SEO de ${site.name}`}
    >
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='grid min-w-0 gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <SteelIcon icon={WebDesign01Icon} className='size-4 text-primary' />
            <h2 className='truncate font-semibold text-base'>{site.name}</h2>
            <SiteStatusBadge status={site.status} />
          </div>
          <p className='truncate text-muted-foreground text-xs'>
            {site.url} · {site.pageCount}{' '}
            {site.pageCount === 1 ? 'página' : 'páginas'}
          </p>
        </div>
        <Button size='sm' variant='ghost' onClick={onOpen}>
          Ver detalhes
          <SteelIcon icon={ArrowRight01Icon} data-icon='inline-end' />
        </Button>
      </header>

      {!site.hasData ? (
        <GettingStarted slug={slug} siteId={site.id} />
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-x-6 gap-y-3'>
            <div className='flex items-center gap-3'>
              <ScoreRing score={site.overall} label='Geral' size={64} active />
              <div className='grid gap-1'>
                <div className='flex flex-wrap gap-1.5'>
                  {SEARCH_PILLARS.map((pillar) => (
                    <ScorePill
                      key={pillar}
                      score={site.averages[pillar]}
                      label={SEARCH_PILLAR_LABELS[pillar]}
                    />
                  ))}
                </div>
                <div className='flex items-center gap-2'>
                  <Delta value={site.delta} />
                  <Trend points={site.history} />
                </div>
              </div>
            </div>
            <dl className='grid grid-cols-3 gap-x-5 text-xs'>
              <div>
                <dt className='text-muted-foreground'>Problemas</dt>
                <dd className='font-semibold text-base tabular-nums'>
                  {site.issueCount}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Checklist</dt>
                <dd className='font-semibold text-base tabular-nums'>
                  {site.technical.pass}/{site.technical.total}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Palavras</dt>
                <dd className='font-semibold text-base tabular-nums'>
                  {site.keywordCount}
                </dd>
              </div>
            </dl>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <section aria-label='Principais problemas' className='grid gap-1.5'>
              <h3 className='font-medium text-muted-foreground text-xs'>
                Principais problemas
              </h3>
              {site.topIssues.length ? (
                <ul className='grid gap-1'>
                  {site.topIssues.map((issue) => (
                    <li key={issue.checkId} className='text-xs'>
                      <span className='font-medium'>{issue.label}</span>{' '}
                      <span className='text-muted-foreground'>
                        · {SEARCH_PILLAR_LABELS[issue.pillar]} ·{' '}
                        {issue.pageCount}{' '}
                        {issue.pageCount === 1 ? 'página' : 'páginas'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-muted-foreground text-xs'>
                  Nenhum problema encontrado. Bom trabalho!
                </p>
              )}
            </section>
            <section aria-label='Páginas piores' className='grid gap-1.5'>
              <h3 className='font-medium text-muted-foreground text-xs'>
                Páginas para melhorar primeiro
              </h3>
              {site.worstPages.length ? (
                <ul className='grid gap-1'>
                  {site.worstPages.map((page) => (
                    <li
                      key={page.id}
                      className='flex items-center justify-between gap-2 text-xs'
                    >
                      <Link
                        href={`/${slug}/crm/sites/${site.id}?page=${page.id}`}
                        className='min-w-0 truncate text-primary underline-offset-2 hover:underline'
                      >
                        {page.title}
                      </Link>
                      <ScorePill score={page.score} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-muted-foreground text-xs'>
                  Todas as páginas estão em dia.
                </p>
              )}
            </section>
          </div>

          <SeoActionButtons
            slug={slug}
            site={site}
            actions={actions}
            canEdit={canEdit}
            optimizeIds={site.worstPages.map((page) => page.id)}
          />
        </>
      )}
      {actions.dialog}
    </article>
  )
}

'use client'

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  SparklesIcon,
  UserCheck01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useSdKbReviews, useSdKbStats } from '@/src/hooks/use-sd-knowledge'
import type { SdKbArticleSummaryDTO } from '@/types/sd-kb-article'
import { SdKbArticleList } from './sd-kb-article-list'
import { sdKbRelativeTime } from './sd-kb-utils'

/**
 * Curadoria da base (KCS), só para agentes: o que mais resolve chamado, o que
 * está com a revisão vencida, o que nunca foi reusado e as revisões
 * pendentes com você.
 */
export function SdKbCuration({
  workspaceId,
  workspaceSlug,
  limit = 5,
}: {
  workspaceId: string
  workspaceSlug: string
  limit?: number
}) {
  const stats = useSdKbStats(workspaceId, limit)
  const mine = useSdKbReviews(workspaceId, {
    mine: true,
    status: 'PENDING',
    limit: 5,
  })

  const href = (article: SdKbArticleSummaryDTO) =>
    `/${workspaceSlug}/servicedesk/knowledge/${article.id}`

  if (stats.isLoading) {
    return (
      <Skeleton className='h-40 w-full' aria-label='Carregando curadoria' />
    )
  }
  const data = stats.data
  if (!data) return null

  return (
    <section
      className='space-y-4'
      aria-label='Curadoria da base'
      data-tour='sd-kb-curation'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='font-medium text-sm'>Curadoria (KCS)</h2>
        <p className='text-muted-foreground text-xs'>
          {data.totals.resolvedTickets}{' '}
          {data.totals.resolvedTickets === 1
            ? 'chamado resolvido'
            : 'chamados resolvidos'}{' '}
          pela base · {data.totals.published} publicados ·{' '}
          {data.totals.inReview} em revisão · {data.totals.overdue} com revisão
          vencida
        </p>
      </div>

      {(mine.data?.length ?? 0) > 0 ? (
        <div className='space-y-2 rounded-xl border border-border bg-muted p-4'>
          <h3 className='flex items-center gap-2 font-medium text-sm'>
            <SteelIcon
              icon={UserCheck01Icon}
              strokeWidth={2}
              className='text-primary'
            />
            Esperando sua revisão
          </h3>
          <ul className='space-y-1'>
            {(mine.data ?? []).map((review) => (
              <li key={review.id} className='text-sm'>
                <a
                  href={`/${workspaceSlug}/servicedesk/knowledge/${review.articleId}`}
                  className='hover:underline'
                >
                  {review.article?.title || 'Artigo sem título'}
                </a>
                <span className='ml-1.5 text-muted-foreground text-xs'>
                  pedida {sdKbRelativeTime(review.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className='grid gap-6 md:grid-cols-3'>
        <CurationColumn
          title='Mais reusados'
          icon={CheckmarkCircle02Icon}
          hint='Artigos que mais resolveram chamados.'
        >
          <SdKbArticleList
            articles={data.mostReused}
            hrefFor={href}
            showStatus
            meta={(article) =>
              `${article.reuseCount} ${
                article.reuseCount === 1 ? 'chamado' : 'chamados'
              }`
            }
            empty='Nenhum artigo marcou chamado resolvido ainda.'
          />
        </CurationColumn>
        <CurationColumn
          title='Revisão vencida'
          icon={Alert02Icon}
          hint='A validade passou: revise ou renove o prazo.'
        >
          <SdKbArticleList
            articles={data.overdue}
            hrefFor={href}
            showStatus
            meta={(article) =>
              article.reviewDueAt
                ? `venceu ${sdKbRelativeTime(article.reviewDueAt)}`
                : ''
            }
            empty='Nada vencido. A base está em dia.'
          />
        </CurationColumn>
        <CurationColumn
          title='Sem reuso'
          icon={SparklesIcon}
          hint='Publicados que nunca resolveram um chamado.'
        >
          <SdKbArticleList
            articles={data.neverReused}
            hrefFor={href}
            showStatus
            meta={(article) =>
              article.publishedAt
                ? `publicado ${sdKbRelativeTime(article.publishedAt)}`
                : ''
            }
            empty='Todos os publicados já resolveram algum chamado.'
          />
        </CurationColumn>
      </div>
    </section>
  )
}

function CurationColumn({
  title,
  icon,
  hint,
  children,
}: {
  title: string
  icon: typeof Alert02Icon
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className='space-y-2 rounded-xl border p-4'>
      <h3 className='flex items-center gap-2 font-medium text-sm'>
        <SteelIcon icon={icon} strokeWidth={2} className='text-primary' />
        {title}
      </h3>
      <p className='text-muted-foreground text-xs'>{hint}</p>
      {children}
    </section>
  )
}

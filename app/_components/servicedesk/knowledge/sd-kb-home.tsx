'use client'

import {
  Clock01Icon,
  FireIcon,
  ThumbsUpIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useSdKbArticles,
  useSdKbCategories,
  useSdKbSearch,
} from '@/src/hooks/use-sd-knowledge'
import type {
  SdKbArticleSummaryDTO,
  SdKbSearchResultDTO,
} from '@/types/sd-kb-article'
import { SdKbArticleList } from './sd-kb-article-list'
import { SdKbCategoryCards } from './sd-kb-category-cards'
import { SdKbCuration } from './sd-kb-curation'
import { SdKbSearchBox } from './sd-kb-search-box'
import { sdKbHelpfulRatio, sdKbRelativeTime, sdKbTop } from './sd-kb-utils'

/**
 * Início da base de conhecimento: busca, cartões de categoria e as listas
 * de recentes, mais vistos e mais úteis (melhorias sobre a Wiki do Nexo,
 * que abria numa tela vazia).
 */
export function SdKbHome({
  workspaceId,
  workspaceSlug,
  isAgent,
}: {
  workspaceId: string
  workspaceSlug: string
  isAgent: boolean
}) {
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState<string>()
  const filtering = q.trim().length > 0 || !!categoryId

  const articles = useSdKbArticles(workspaceId)
  const categories = useSdKbCategories(workspaceId)
  const search = useSdKbSearch(
    workspaceId,
    { q: q.trim(), categoryId, limit: 30 },
    filtering,
  )

  const all = articles.data ?? []
  const published = useMemo(
    () => all.filter((a) => a.status === 'PUBLISHED'),
    [all],
  )
  const href = (a: SdKbArticleSummaryDTO) =>
    `/${workspaceSlug}/servicedesk/knowledge/${a.id}`
  const excerpts = useMemo(
    () => new Map((search.data ?? []).map((r) => [r.id, r.excerpt])),
    [search.data],
  )

  return (
    <div className='mx-auto w-full max-w-5xl space-y-8 px-6 py-8'>
      <section className='space-y-4 rounded-xl border bg-card p-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h1 className='font-semibold text-2xl tracking-tight'>
              Base de conhecimento
            </h1>
            <p className='text-muted-foreground text-sm'>
              {isAgent
                ? 'Artigos, procedimentos e soluções conhecidas do atendimento.'
                : 'Encontre respostas antes de abrir um chamado.'}
            </p>
          </div>
          {/* Criar artigo fica só no cabeçalho da seção (layout da base),
              para não repetir o mesmo botão duas vezes nesta tela. */}
        </div>
        <SdKbSearchBox value={q} onChange={setQ} />
        {isAgent && articles.data && (
          <p className='text-muted-foreground text-xs'>
            {all.length} {all.length === 1 ? 'artigo' : 'artigos'} ·{' '}
            {published.length} publicados · {all.length - published.length}{' '}
            rascunhos
          </p>
        )}
      </section>

      {(categories.data?.length ?? 0) > 0 && (
        <section data-tour='sd-kb-categories' className='space-y-3'>
          <h2 className='font-medium text-sm'>Categorias</h2>
          <SdKbCategoryCards
            categories={categories.data ?? []}
            selectedId={categoryId}
            onSelect={setCategoryId}
          />
        </section>
      )}

      {isAgent && !filtering && (
        <SdKbCuration workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      )}

      {filtering ? (
        <section className='space-y-2' aria-label='Resultados da busca'>
          <h2 className='font-medium text-sm'>
            {search.isFetching
              ? 'Buscando…'
              : `${search.data?.length ?? 0} resultado(s)`}
          </h2>
          {search.isLoading ? (
            <Skeleton className='h-24 w-full' />
          ) : (
            <SdKbArticleList
              articles={(search.data ?? []) as SdKbSearchResultDTO[]}
              hrefFor={href}
              showStatus={isAgent}
              excerptFor={(a) => excerpts.get(a.id)}
              empty='Nenhum artigo encontrado. Tente outras palavras.'
            />
          )}
        </section>
      ) : articles.isLoading ? (
        <div className='grid gap-6 md:grid-cols-3'>
          <Skeleton className='h-40' />
          <Skeleton className='h-40' />
          <Skeleton className='h-40' />
        </div>
      ) : (
        <div data-tour='sd-kb-lists' className='grid gap-6 md:grid-cols-3'>
          <HomeColumn title='Atualizados recentemente' icon={Clock01Icon}>
            <SdKbArticleList
              articles={sdKbTop(all, 'updatedAt')}
              hrefFor={href}
              showStatus={isAgent}
              meta={(a) => sdKbRelativeTime(a.updatedAt)}
              empty='Nenhum artigo ainda.'
            />
          </HomeColumn>
          <HomeColumn title='Mais vistos' icon={FireIcon}>
            <SdKbArticleList
              articles={sdKbTop(published, 'viewCount')}
              hrefFor={href}
              meta={(a) => a.viewCount}
              empty='Sem visualizações ainda.'
            />
          </HomeColumn>
          <HomeColumn title='Mais úteis' icon={ThumbsUpIcon}>
            <SdKbArticleList
              articles={sdKbTop(published, 'helpfulCount')}
              hrefFor={href}
              meta={(a) => `${sdKbHelpfulRatio(a) ?? 0}%`}
              empty='Sem votos ainda.'
            />
          </HomeColumn>
        </div>
      )}
    </div>
  )
}

function HomeColumn({
  title,
  icon,
  children,
}: {
  title: string
  icon: typeof Clock01Icon
  children: React.ReactNode
}) {
  return (
    <section className='space-y-2 rounded-xl border p-4'>
      <h2 className='flex items-center gap-2 font-medium text-sm'>
        <SteelIcon icon={icon} strokeWidth={2} className='text-primary' />
        {title}
      </h2>
      {children}
    </section>
  )
}

'use client'

import {
  AiMagicIcon,
  Download01Icon,
  PencilEdit02Icon,
  RefreshIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { siteSearchApi, siteSearchKeys } from '@/src/hooks/use-site-search'
import { siteSeoApi, siteSeoKeys } from '@/src/hooks/use-site-seo'
import {
  buildSeoReportCsv,
  seoReportFilename,
} from '@/src/lib/sites/search/seo-report'
import type { SiteSearchAiOptimizeDTO } from '@/types/site-search'
import type { SiteSeoCardDTO } from '@/types/site-seo'
import { AiSuggestionsDialog } from '../sites/search/ai-suggestions-dialog'

/** Pages sent to "Otimizar com IA" in one run (the API accepts up to 10). */
export const SEO_OPTIMIZE_MAX = 10

function saveFile(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Quick actions of a site on CRM > SEO: optimize pages with AI (reviewed
 * before applying), IndexNow ping, CSV report. One instance per site card or
 * detail; render `dialog` once beside the buttons.
 */
export function useSeoActions({
  workspaceId,
  site,
}: {
  workspaceId: string
  site: Pick<SiteSeoCardDTO, 'id' | 'slug'>
}) {
  const queryClient = useQueryClient()
  const searchApi = useMemo(() => siteSearchApi(workspaceId), [workspaceId])
  const seoApi = useMemo(() => siteSeoApi(workspaceId), [workspaceId])
  const [optimizing, setOptimizing] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [suggestions, setSuggestions] =
    useState<SiteSearchAiOptimizeDTO | null>(null)

  async function optimize(pageIds: string[]) {
    if (!pageIds.length) {
      notify.info('Nenhuma página com pontos a melhorar.')
      return
    }
    setOptimizing(true)
    try {
      const result = await searchApi.aiOptimize(site.id, {
        pageIds: pageIds.slice(0, SEO_OPTIMIZE_MAX),
        fields: ['title', 'description', 'answers'],
      })
      if (!result.items.length) {
        notify.warning('A IA não encontrou melhorias para sugerir.')
        return
      }
      setSuggestions(result)
    } catch (error) {
      notify.error(error, 'A IA não conseguiu sugerir melhorias')
    } finally {
      setOptimizing(false)
    }
  }

  async function reindex() {
    setReindexing(true)
    try {
      const result = await seoApi.reindex(site.id)
      if (result.status !== null && result.status < 300) {
        notify.success(
          `${result.sent} endereço(s) enviado(s) ao IndexNow (Bing, Yandex e outros).`,
        )
      } else if (result.status !== null) {
        notify.warning(
          `O buscador respondeu com o status ${result.status}. Tente de novo em instantes.`,
        )
      } else {
        notify.error('Não foi possível falar com o IndexNow agora.')
      }
    } catch (error) {
      notify.error(error, 'Não foi possível pedir a reindexação')
    } finally {
      setReindexing(false)
    }
  }

  async function download() {
    setDownloading(true)
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: siteSeoKeys.detail(workspaceId, site.id),
        queryFn: () => seoApi.detail(site.id),
        staleTime: 0,
      })
      saveFile(
        seoReportFilename(site.slug, detail.generatedAt),
        buildSeoReportCsv(detail),
      )
    } catch (error) {
      notify.error(error, 'Não foi possível gerar o relatório')
    } finally {
      setDownloading(false)
    }
  }

  const dialog = (
    <AiSuggestionsDialog
      result={suggestions}
      onOpenChange={(open) => {
        if (!open) setSuggestions(null)
      }}
      onApply={async (items) => {
        try {
          await searchApi.apply(site.id, { items })
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: siteSeoKeys.all(workspaceId),
            }),
            queryClient.invalidateQueries({
              queryKey: siteSearchKeys.report(workspaceId, site.id),
            }),
          ])
          notify.success('Sugestões aplicadas ao rascunho.')
          return true
        } catch (error) {
          notify.error(error, 'Não foi possível aplicar as sugestões')
          return false
        }
      }}
    />
  )

  return {
    optimize,
    reindex,
    download,
    optimizing,
    reindexing,
    downloading,
    dialog,
  }
}

export type SeoActions = ReturnType<typeof useSeoActions>

/** Buttons of the quick actions (the caller owns the hook and the dialog). */
export function SeoActionButtons({
  slug,
  site,
  actions,
  canEdit,
  optimizeIds,
}: {
  slug: string
  site: Pick<SiteSeoCardDTO, 'id' | 'indexNow' | 'status'>
  actions: SeoActions
  canEdit: boolean
  /** Pages the AI button works on. */
  optimizeIds: string[]
}) {
  const reindexHint = !site.indexNow.canPing
    ? site.status !== 'PUBLISHED'
      ? 'Publique o site para poder reindexar.'
      : 'Ative o IndexNow em Buscadores > Rastreadores e publique.'
    : 'Avisa o Bing, o Yandex e outros que o site mudou.'
  return (
    <div className='flex flex-wrap items-center gap-2'>
      {canEdit ? (
        <>
          <Button
            size='sm'
            disabled={actions.optimizing || !optimizeIds.length}
            onClick={() => void actions.optimize(optimizeIds)}
            data-testid='seo-optimize'
          >
            <SteelIcon icon={AiMagicIcon} data-icon='inline-start' />
            {actions.optimizing ? 'Gerando…' : 'Otimizar com IA'}
          </Button>
          <Button
            size='sm'
            variant='outline'
            title={reindexHint}
            disabled={actions.reindexing || !site.indexNow.canPing}
            onClick={() => void actions.reindex()}
            data-testid='seo-reindex'
          >
            <SteelIcon icon={RefreshIcon} data-icon='inline-start' />
            {actions.reindexing ? 'Enviando…' : 'Reindexar'}
          </Button>
        </>
      ) : null}
      <Button
        size='sm'
        variant='outline'
        disabled={actions.downloading}
        onClick={() => void actions.download()}
        data-testid='seo-download'
      >
        <SteelIcon icon={Download01Icon} data-icon='inline-start' />
        {actions.downloading ? 'Gerando…' : 'Baixar relatório'}
      </Button>
      <Button
        size='sm'
        variant='ghost'
        nativeButton={false}
        render={<Link href={`/${slug}/crm/sites/${site.id}`} />}
      >
        <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
        Abrir editor
      </Button>
    </div>
  )
}

'use client'

import {
  ArrowLeft01Icon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useCrmSite } from '@/src/hooks/use-crm-sites'
import {
  siteSearchApi,
  siteSearchKeys,
  useSiteSearchSettings,
} from '@/src/hooks/use-site-search'
import type { UpdateSiteSearchSettingsDTO } from '@/src/schemas/site-search.schema'
import { SiteStatusBadge } from '../site-status-badge'
import { BusinessProfileForm } from './business-profile-form'
import { CrawlersSettings } from './crawlers-settings'
import { SearchReport } from './search-report'
import { ScorePill, SEARCH_TONE_VARS } from './search-ui'

const TABS = [
  { value: 'saude', label: 'Saúde' },
  { value: 'perfil', label: 'Perfil do negócio' },
  { value: 'rastreadores', label: 'Rastreadores e feeds' },
] as const

type TabValue = (typeof TABS)[number]['value']

/**
 * "Buscadores" of a site: the health report (SEO, AEO, GEO per page), the
 * business profile and the crawler/feed settings. Changes reach the live
 * site on the next publish.
 */
export function SiteSearchScreen({
  workspaceId,
  slug,
  siteId,
}: {
  workspaceId: string
  slug: string
  siteId: string
}) {
  const { site } = useCrmSite(workspaceId, siteId)
  const settings = useSiteSearchSettings(workspaceId, siteId)
  const canEdit = useCan('landing-pages', 'EDIT')
  const queryClient = useQueryClient()
  const router = useRouter()
  const params = useSearchParams()
  const api = useMemo(() => siteSearchApi(workspaceId), [workspaceId])
  const requested = params.get('tab')
  const tab: TabValue = TABS.some((item) => item.value === requested)
    ? (requested as TabValue)
    : 'saude'

  async function save(dto: UpdateSiteSearchSettingsDTO): Promise<boolean> {
    try {
      const view = await api.updateSettings(siteId, dto)
      queryClient.setQueryData(
        siteSearchKeys.settings(workspaceId, siteId),
        view,
      )
      void queryClient.invalidateQueries({
        queryKey: siteSearchKeys.report(workspaceId, siteId),
      })
      notify.success('Salvo. Entra no ar na próxima publicação.')
      return true
    } catch (error) {
      notify.error(error, 'Não foi possível salvar')
      return false
    }
  }

  return (
    <div
      className={cn(
        'mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-6',
        SEARCH_TONE_VARS,
      )}
      data-testid='site-search-screen'
    >
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='grid min-w-0 gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='icon-sm'
              variant='ghost'
              nativeButton={false}
              aria-label='Voltar para os sites'
              render={<Link href={`/${slug}/crm/sites`} />}
            >
              <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
            </Button>
            {site.data ? (
              <>
                <h1 className='truncate font-semibold text-xl'>
                  Buscadores · {site.data.name}
                </h1>
                <SiteStatusBadge status={site.data.status} />
              </>
            ) : (
              <Skeleton className='h-7 w-56' />
            )}
          </div>
          <p className='text-muted-foreground text-sm'>
            Como o site aparece no Google e no Bing, nas respostas diretas e nas
            IAs generativas.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {settings.data ? (
            <ScorePill
              score={settings.data.completeness.percent}
              label='Perfil'
            />
          ) : null}
          <Button
            size='sm'
            variant='outline'
            nativeButton={false}
            render={<Link href={`/${slug}/crm/sites/${siteId}`} />}
          >
            <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
            Abrir editor
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) =>
          router.replace(`/${slug}/crm/sites/${siteId}/search?tab=${value}`, {
            scroll: false,
          })
        }
      >
        <TabsList className='max-w-full overflow-x-auto'>
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value='saude' className='pt-4'>
          <SearchReport
            workspaceId={workspaceId}
            slug={slug}
            siteId={siteId}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value='perfil' className='pt-4'>
          {settings.data ? (
            <BusinessProfileForm
              profile={settings.data.settings.business}
              prefilled={settings.data.prefilled}
              workspaceId={workspaceId}
              canEdit={canEdit}
              onSave={(business) => save({ business })}
            />
          ) : (
            <Skeleton className='h-96 w-full' />
          )}
        </TabsContent>
        <TabsContent value='rastreadores' className='pt-4'>
          {settings.data ? (
            <CrawlersSettings
              view={settings.data}
              canEdit={canEdit}
              onSave={save}
            />
          ) : (
            <Skeleton className='h-96 w-full' />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

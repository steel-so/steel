'use client'

import { useSearchParams } from 'next/navigation'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { Skeleton } from '@/components/ui/skeleton'
import { useSdConfig, useSdMe } from '@/src/hooks/use-sd-config'
import { ReadOnlyNotice, SdSettingsProvider } from './sd-settings-kit'
import { SD_SETTINGS_TABS } from './settings-tabs'

/**
 * ServiceDesk settings content: the active section (`?tab=`) from the registry
 * in `settings-tabs.tsx`. Non-admins see everything read-only.
 *
 * Navigating the 24 sections does **not** live here: it lives in the module
 * context rail (`SdSettingsNav`, swapped in by the layout's `SdContextRail`).
 * This screen used to draw a second 240px rail next to the module rail — and,
 * below `md`, a second horizontal bar under the breadcrumb — which no other
 * screen in the app does. The body is now the house one: title + description
 * in `H3`/`Muted` and full-width sections, like the workspace and CRM
 * settings.
 */
export function SdSettingsShell({ workspaceId }: { workspaceId: string }) {
  const searchParams = useSearchParams()
  const me = useSdMe(workspaceId)
  const config = useSdConfig(workspaceId)

  const requested = searchParams.get('tab')
  const active =
    SD_SETTINGS_TABS.find((tab) => tab.id === requested) ?? SD_SETTINGS_TABS[0]
  const canEdit = me.data?.isAdmin ?? false

  const ActiveTab = active.component

  return (
    <SdSettingsProvider value={{ workspaceId, canEdit, config: config.data }}>
      <div className='min-h-0 w-full flex-1 overflow-y-auto'>
        <div className='w-full space-y-6 p-6'>
          <div data-tour='sd-settings-section'>
            <H3>{active.label}</H3>
            <Muted>{active.description}</Muted>
          </div>

          {me.isLoading || config.isLoading ? (
            <div className='flex flex-col gap-3'>
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-48 w-full' />
            </div>
          ) : me.error || config.error ? (
            <p className='text-destructive text-sm'>
              {(me.error ?? config.error)?.message ??
                'Não foi possível carregar a configuração.'}
            </p>
          ) : (
            <>
              {!canEdit && !active.personal ? <ReadOnlyNotice /> : null}
              <ActiveTab />
            </>
          )}
        </div>
      </div>
    </SdSettingsProvider>
  )
}

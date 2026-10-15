'use client'

import * as React from 'react'
import { useCrmDashboard } from '@/src/hooks/use-crm-dashboard-tv'
import { useCrmDashboardWidgets } from '@/src/hooks/use-crm-dashboard-widget'
import type { CrmDashboardTvBootDTO } from '@/types/crm-dashboard'
import { CrmDashboardTv } from './crm-dashboard-tv'

/** The layout of a linked TV is re-read every 5 minutes. */
export const TV_BOOT_REFRESH_MS = 5 * 60_000

/** Modo TV com login (`/<slug>/crm/dashboards/<id>/tv`). */
export function CrmDashboardTvSession({
  workspaceId,
  dashboardId,
  slug,
  timeZone,
  interval,
}: {
  workspaceId: string
  dashboardId: string
  slug: string
  timeZone: string
  interval?: string
}) {
  const { dashboard } = useCrmDashboard(workspaceId, dashboardId)
  const { widgets } = useCrmDashboardWidgets(workspaceId, dashboardId, 'crm')
  if (!dashboard) {
    return (
      <div className='dark fixed inset-0 z-50 flex items-center justify-center bg-background text-muted-foreground text-xl'>
        Carregando painel…
      </div>
    )
  }
  return (
    <CrmDashboardTv
      title={dashboard.title}
      settings={dashboard.settings}
      widgets={widgets}
      workspaceId={workspaceId}
      timeZone={timeZone}
      exitHref={`/${slug}/crm/dashboards/${dashboardId}`}
      interval={interval}
    />
  )
}

export function TvLinkGone() {
  return (
    <div
      data-testid='tv-link-gone'
      className='dark fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground'
    >
      <p className='font-semibold text-[clamp(1.5rem,4vh,3rem)]'>
        Este link da TV não funciona mais.
      </p>
      <p className='max-w-2xl text-[clamp(1rem,2.4vh,1.8rem)] text-muted-foreground'>
        Ele foi revogado ou o painel saiu do ar. Peça um novo link a quem
        administra o CRM.
      </p>
    </div>
  )
}

/** Link público da TV (`/tv/<token>`): sem login, só leitura. */
export function CrmDashboardTvPublic({
  token,
  boot,
  interval,
}: {
  token: string
  boot: CrmDashboardTvBootDTO
  interval?: string
}) {
  const [current, setCurrent] = React.useState(boot)
  const [gone, setGone] = React.useState(false)
  const markGone = React.useCallback(() => setGone(true), [])

  React.useEffect(() => {
    let active = true
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/crm/tv/${token}`)
        if (response.status === 404) {
          if (active) setGone(true)
          return
        }
        const json = (await response.json()) as {
          success?: boolean
          data?: CrmDashboardTvBootDTO
        }
        if (active && json.success && json.data) setCurrent(json.data)
      } catch {
        // Rede instável: segue com o último layout.
      }
    }, TV_BOOT_REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [token])

  if (gone) return <TvLinkGone />
  return (
    <CrmDashboardTv
      title={current.dashboard.title}
      settings={current.dashboard.settings}
      widgets={current.widgets}
      workspaceId=''
      timeZone={current.timeZone}
      tvToken={token}
      lookups={current.lookups}
      interval={interval}
      onGone={markGone}
    />
  )
}

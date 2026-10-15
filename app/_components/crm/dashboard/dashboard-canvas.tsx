'use client'

import {
  Add01Icon,
  Delete02Icon,
  Link01Icon,
  PencilEdit02Icon,
  Tick02Icon,
  Tv01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import * as React from 'react'
import ReactGridLayout, {
  type Layout,
  useContainerWidth,
} from 'react-grid-layout'
import { DashboardScreens } from '@/app/_components/crm/dashboard/tv/dashboard-screens'
import { TvLinkDialog } from '@/app/_components/crm/dashboard/tv/tv-link-dialog'
import { WidgetPanel } from '@/app/_components/crm/dashboard/widget-panel'
import {
  pageOfWidget,
  widgetTitle,
} from '@/app/_components/crm/dashboard/widget-title'
import { WidgetView } from '@/app/_components/crm/dashboard/widget-view'
import { SteelIcon } from '@/components/icon/icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  updateCrmDashboardSettings,
  useCrmDashboard,
} from '@/src/hooks/use-crm-dashboard-tv'
import {
  applyCrmDashboardWidgetLayout,
  deleteCrmDashboardWidget,
  useCrmDashboardWidgets,
} from '@/src/hooks/use-crm-dashboard-widget'
import {
  type CrmDashboardSettings,
  CrmDashboardSettingsSchema,
  TV_MAX_BLOCKS_PER_PAGE,
} from '@/src/schemas/crm-dashboard.schema'
import type { CrmDashboardWidgetDTO } from '@/types/crm-dashboard'

// Re-exported: the ServiceDesk TV imports the title from here.
export { pageOfWidget, widgetTitle }

const COLS = 12
const ROW_HEIGHT = 40

function layoutSignature(layout: Layout): string {
  return layout
    .map((item) => `${item.i}:${item.x},${item.y},${item.w},${item.h}`)
    .sort()
    .join('|')
}

const DEFAULT_SETTINGS: CrmDashboardSettings = CrmDashboardSettingsSchema.parse(
  {},
)

export function DashboardCanvas({
  workspaceId,
  dashboardId,
  basePath = 'crm',
  slug,
}: {
  workspaceId: string
  dashboardId: string
  /** Segmento de módulo da API (`crm` ou `whatsapp`). */
  basePath?: string
  /** Slug do workspace (link do modo TV). */
  slug?: string
}) {
  const {
    widgets: allWidgets,
    setWidgets,
    isLoading,
  } = useCrmDashboardWidgets(workspaceId, dashboardId, basePath)
  const { width, containerRef, mounted } = useContainerWidth()
  // Telas e modo TV são do CRM (o painel de Vendas vive lá).
  const isCrm = basePath === 'crm'
  const { dashboard, setDashboard } = useCrmDashboard(
    isCrm ? workspaceId : '',
    dashboardId,
  )
  const settings = dashboard?.settings ?? DEFAULT_SETTINGS
  const pageCount = settings.pages.length
  const [page, setPage] = React.useState(0)
  const currentPage = Math.min(page, pageCount - 1)

  const widgets = React.useMemo(
    () => allWidgets.filter((w) => pageOfWidget(w, pageCount) === currentPage),
    [allWidgets, pageCount, currentPage],
  )
  const counts = React.useMemo(
    () =>
      settings.pages.map(
        (_, index) =>
          allWidgets.filter((w) => pageOfWidget(w, pageCount) === index).length,
      ),
    [allWidgets, settings.pages, pageCount],
  )

  const [editMode, setEditMode] = React.useState(false)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [tvLinkOpen, setTvLinkOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<CrmDashboardWidgetDTO | null>(
    null,
  )

  async function saveSettings(next: CrmDashboardSettings) {
    const previous = dashboard
    if (dashboard) setDashboard({ ...dashboard, settings: next })
    try {
      setDashboard(
        await updateCrmDashboardSettings(workspaceId, dashboardId, next),
      )
    } catch (error) {
      setDashboard(previous)
      notify.error(error)
    }
  }

  /** Remove uma tela: apaga os widgets dela e sobe as telas seguintes. */
  async function removeScreen(index: number) {
    const doomed = allWidgets.filter(
      (w) => pageOfWidget(w, pageCount) === index,
    )
    for (const widget of doomed) {
      const res = await deleteCrmDashboardWidget(
        workspaceId,
        dashboardId,
        widget.id,
        basePath,
      )
      if (!res.ok) {
        notify.error(res.message ?? 'Não foi possível remover a tela.')
        return
      }
    }
    const moved: CrmDashboardWidgetDTO[] = []
    const shifted = allWidgets
      .filter((w) => !doomed.includes(w))
      .map((w) => {
        const p = pageOfWidget(w, pageCount)
        if (p <= index) return w
        const next = { ...w, page: p - 1 }
        moved.push(next)
        return next
      })
    setWidgets(shifted)
    if (moved.length > 0) {
      await applyCrmDashboardWidgetLayout(
        workspaceId,
        dashboardId,
        moved.map((w) => ({
          id: w.id,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          page: w.page,
        })),
        basePath,
      )
    }
    setPage(Math.max(0, index - 1))
    await saveSettings({
      ...settings,
      pages: settings.pages.filter((_, i) => i !== index),
    })
  }

  const layout: Layout = React.useMemo(
    () =>
      widgets.map((w) => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: 2,
        // CHART precisa de altura mínima maior: com menos espaço, eixo/legenda
        // dos gráficos nivo se sobrepõem aos tick labels.
        minH: w.type === 'CHART' ? 5 : 3,
      })),
    [widgets],
  )

  const lastSig = React.useRef('')
  React.useEffect(() => {
    lastSig.current = layoutSignature(layout)
  }, [layout])

  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLayoutChange = React.useCallback(
    (next: Layout) => {
      if (!editMode) return
      const sig = layoutSignature(next)
      if (sig === lastSig.current) return
      lastSig.current = sig

      setWidgets((prev) =>
        prev.map((w) => {
          const item = next.find((n) => n.i === w.id)
          return item ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h } : w
        }),
      )

      if (persistTimer.current) clearTimeout(persistTimer.current)
      persistTimer.current = setTimeout(() => {
        void applyCrmDashboardWidgetLayout(
          workspaceId,
          dashboardId,
          next.map((item) => ({
            id: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
          })),
          basePath,
        )
      }, 600)
    },
    [editMode, workspaceId, dashboardId, basePath, setWidgets],
  )

  const nextY = React.useMemo(
    () => widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0),
    [widgets],
  )

  function openNew() {
    setEditing(null)
    setPanelOpen(true)
  }

  function openEdit(widget: CrmDashboardWidgetDTO) {
    setEditing(widget)
    setPanelOpen(true)
  }

  async function handleDelete(widget: CrmDashboardWidgetDTO) {
    const previous = allWidgets
    setWidgets((prev) => prev.filter((w) => w.id !== widget.id))
    const res = await deleteCrmDashboardWidget(
      workspaceId,
      dashboardId,
      widget.id,
      basePath,
    )
    if (!res.ok) {
      setWidgets(previous)
      notify.error(res.message ?? 'Não foi possível remover o widget.')
    }
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex shrink-0 flex-wrap items-center justify-end gap-2 border-b px-4 py-2'>
        {isCrm && dashboard ? (
          <div className='mr-auto min-w-0'>
            <DashboardScreens
              settings={settings}
              current={currentPage}
              counts={counts}
              onSelect={setPage}
              onChange={(next) => void saveSettings(next)}
              onRemove={(index) => void removeScreen(index)}
            />
          </div>
        ) : null}
        {isCrm && widgets.length > TV_MAX_BLOCKS_PER_PAGE ? (
          <span className='text-muted-foreground text-xs'>
            Na TV, até {TV_MAX_BLOCKS_PER_PAGE} blocos por tela leem bem.
          </span>
        ) : null}
        {isCrm && slug ? (
          <>
            <Link
              href={`/${slug}/crm/dashboards/${dashboardId}/tv`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <SteelIcon icon={Tv01Icon} strokeWidth={2} />
              Modo TV
            </Link>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setTvLinkOpen(true)}
            >
              <SteelIcon icon={Link01Icon} strokeWidth={2} />
              Link da TV
            </Button>
          </>
        ) : null}
        <Button variant='outline' size='sm' onClick={openNew}>
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Adicionar widget
        </Button>
        <Button
          variant={editMode ? 'default' : 'outline'}
          size='sm'
          onClick={() => setEditMode((v) => !v)}
        >
          <SteelIcon
            icon={editMode ? Tick02Icon : PencilEdit02Icon}
            strokeWidth={2}
          />
          {editMode ? 'Concluir' : 'Editar layout'}
        </Button>
      </div>

      <div ref={containerRef} className='min-h-0 flex-1 overflow-auto p-3'>
        {widgets.length === 0 && !isLoading ? (
          <div className='flex h-[60vh] flex-col items-center justify-center gap-3 text-center'>
            <p className='text-muted-foreground text-sm'>
              {pageCount > 1
                ? 'Esta tela ainda não tem widgets.'
                : 'Este dashboard ainda não tem widgets.'}
            </p>
            <Button variant='outline' size='sm' onClick={openNew}>
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar primeiro widget
            </Button>
          </div>
        ) : null}

        {mounted && width > 0 && widgets.length > 0 ? (
          <ReactGridLayout
            width={width}
            layout={layout}
            gridConfig={{
              cols: COLS,
              rowHeight: ROW_HEIGHT,
              margin: [12, 12],
              containerPadding: [0, 0],
            }}
            dragConfig={{ enabled: editMode, handle: '.widget-drag-handle' }}
            resizeConfig={{ enabled: editMode }}
            onLayoutChange={handleLayoutChange}
          >
            {widgets.map((widget) => (
              <div
                key={widget.id}
                className='flex h-full w-full flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm'
              >
                <div
                  className={cn(
                    'flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-1.5',
                    editMode && 'widget-drag-handle cursor-move bg-muted/40',
                  )}
                >
                  <span className='truncate font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                    {widgetTitle(widget)}
                  </span>
                  {editMode ? (
                    <div className='flex items-center gap-0.5'>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        onClick={() => openEdit(widget)}
                        aria-label='Editar widget'
                      >
                        <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        className='text-muted-foreground hover:text-destructive'
                        onClick={() => handleDelete(widget)}
                        aria-label='Remover widget'
                      >
                        <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className='min-h-0 flex-1 p-2'>
                  <WidgetView widget={widget} workspaceId={workspaceId} />
                </div>
              </div>
            ))}
          </ReactGridLayout>
        ) : null}
      </div>

      <WidgetPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        workspaceId={workspaceId}
        dashboardId={dashboardId}
        basePath={basePath}
        editing={editing}
        nextY={nextY}
        page={currentPage}
        onCreated={(widget) => setWidgets((prev) => [...prev, widget])}
        onUpdated={(widget) =>
          setWidgets((prev) =>
            prev.map((w) => (w.id === widget.id ? widget : w)),
          )
        }
      />
      {isCrm ? (
        <TvLinkDialog
          open={tvLinkOpen}
          onOpenChange={setTvLinkOpen}
          workspaceId={workspaceId}
          dashboardId={dashboardId}
        />
      ) : null}
    </div>
  )
}

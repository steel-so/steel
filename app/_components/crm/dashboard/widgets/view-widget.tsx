'use client'

import * as React from 'react'
import { useDashboardDisplay } from '@/app/_components/crm/dashboard/dashboard-display'
import { useDashboardRows } from '@/app/_components/crm/dashboard/use-dashboard-rows'
import {
  formatCell,
  refLabelsOf,
  viewRows,
  withDerivedFields,
} from '@/app/_components/crm/dashboard/widget-data'
import {
  sourceNeedsLookups,
  sourceResource,
  VIEW_SOURCE_FIELDS,
} from '@/app/_components/crm/dashboard/widget-meta'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useDashboardLookups } from '@/src/hooks/use-crm-dashboard-tv'
import type { ViewConfig } from '@/src/schemas/crm-dashboard.schema'

export function ViewWidget({
  workspaceId,
  config,
  widgetId,
}: {
  workspaceId: string
  config: ViewConfig
  /** Id do widget: no link da TV, os dados vêm por ele. */
  widgetId?: string
}) {
  const { variant, refreshKey, tvToken, lookups } = useDashboardDisplay()
  const tv = variant === 'tv'
  const tvSource = React.useMemo(
    () => (tvToken && widgetId ? { token: tvToken, widgetId } : undefined),
    [tvToken, widgetId],
  )
  const { items, isLoading } = useDashboardRows(
    workspaceId,
    sourceResource(config.source),
    refreshKey,
    tvSource,
  )
  const names = useDashboardLookups(
    tvToken || !sourceNeedsLookups(config.source) ? null : workspaceId,
    lookups,
  )
  const labels = React.useMemo(() => refLabelsOf(names), [names])

  const fields = React.useMemo(() => {
    const all = VIEW_SOURCE_FIELDS[config.source] ?? []
    if (config.fields.length === 0) return all
    // Respeita a ordem escolhida na config (a TV mostra as colunas nessa ordem).
    return config.fields
      .map((key) => all.find((field) => field.key === key))
      .filter((field): field is (typeof all)[number] => Boolean(field))
  }, [config.source, config.fields])

  const rows = React.useMemo(
    () =>
      viewRows(
        withDerivedFields(config.source, items),
        config,
        undefined,
        labels,
      ),
    [items, config, labels],
  )

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
        Carregando…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center text-muted-foreground',
          tv ? 'text-2xl' : 'text-sm',
        )}
      >
        Nenhum registro.
      </div>
    )
  }

  return (
    <div className='h-full overflow-auto'>
      <Table
        containerClassName='overflow-x-visible'
        className={cn(tv && 'text-[clamp(1rem,1.1vw,2.2rem)]')}
      >
        <TableHeader
          className={cn(
            'sticky top-0 z-10 backdrop-blur-md',
            tv ? 'bg-zinc-900/90' : 'bg-card/85',
          )}
        >
          <TableRow>
            {fields.map((field) => (
              <TableHead
                key={field.key}
                className={cn('whitespace-nowrap', tv && 'h-auto py-2')}
              >
                {field.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row.id)}>
              {fields.map((field) => (
                <TableCell
                  key={field.key}
                  className={cn('whitespace-nowrap', tv && 'py-2.5')}
                >
                  {formatCell(field.key, row[field.key], labels)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

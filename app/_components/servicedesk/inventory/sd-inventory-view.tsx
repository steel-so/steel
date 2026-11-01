'use client'

import Link from 'next/link'
import { useState } from 'react'
import { SdPill } from '@/app/_components/servicedesk/directory/shared/sd-directory-widgets'
import { SdInfoRow } from '@/app/_components/servicedesk/directory/shared/sd-form-bits'
import {
  type SdColumn,
  SdDataTable,
  SdFilterField,
  SdFilterSelect,
} from '@/app/_components/servicedesk/table/sd-data-table'
import { useSdTableState } from '@/app/_components/servicedesk/table/use-sd-table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  useSdInventoryAlerts,
  useSdInventoryDevice,
  useSdInventoryDeviceActions,
  useSdInventoryDevices,
  useSdInventorySoftware,
  useSdInventorySummary,
} from '@/src/hooks/use-sd-inventory'
import type {
  SdInventoryAlertDTO,
  SdInventoryDeviceDTO,
  SdInventorySoftwareCatalogRowDTO,
} from '@/types/sd-inventory'
import { SD_TONE } from '../sd-tone'
import {
  formatInventoryDateTime,
  formatMegabytes,
  SD_INVENTORY_ALERT_KIND_LABEL,
  SD_INVENTORY_SOURCE_LABEL,
  usageTone,
} from './sd-inventory-format'

function UsagePill({ percent }: { percent: number | null }) {
  if (percent === null) return <span className='text-muted-foreground'>—</span>
  return <SdPill className={usageTone(percent)}>{percent}%</SdPill>
}

function worstDisk(device: SdInventoryDeviceDTO): number | null {
  if (device.disks.length === 0) return null
  return Math.max(...device.disks.map((d) => d.usedPercent))
}

const SOURCE_TONE = {
  AGENT: SD_TONE.indigo,
  SNMP: SD_TONE.teal,
  DISCOVERY: SD_TONE.slate,
} as const

const DEVICE_COLUMNS: SdColumn<SdInventoryDeviceDTO>[] = [
  {
    id: 'hostname',
    header: 'Equipamento',
    hideable: false,
    cell: (d) => (
      <div className='flex min-w-44 flex-col'>
        <span className='font-medium'>{d.hostname}</span>
        <span className='text-muted-foreground text-xs'>
          {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}
        </span>
      </div>
    ),
  },
  {
    id: 'source',
    header: 'Origem',
    cell: (d) => (
      <SdPill className={SOURCE_TONE[d.source]}>
        {SD_INVENTORY_SOURCE_LABEL[d.source]}
      </SdPill>
    ),
  },
  {
    id: 'os',
    header: 'Sistema',
    cell: (d) =>
      [d.osName, d.osVersion].filter(Boolean).join(' ') || (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'ip',
    header: 'IP',
    cell: (d) =>
      d.ipAddresses[0] ? (
        <span className='font-mono text-xs'>{d.ipAddresses[0]}</span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'ram',
    header: 'Memória',
    cell: (d) => (
      <div className='flex items-center gap-2'>
        <span>{formatMegabytes(d.ramTotalMb)}</span>
        <UsagePill percent={d.ramUsedPercent} />
      </div>
    ),
  },
  {
    id: 'disk',
    header: 'Disco (pior volume)',
    cell: (d) => <UsagePill percent={worstDisk(d)} />,
  },
  {
    id: 'alerts',
    header: 'Alertas',
    cell: (d) =>
      d.openAlerts > 0 ? (
        <SdPill className={SD_TONE.red}>{d.openAlerts}</SdPill>
      ) : (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'lastSeen',
    header: 'Último contato',
    cell: (d) => (
      <div className='flex items-center gap-2'>
        <span>{formatInventoryDateTime(d.lastSeenAt)}</span>
        {d.stale ? <SdPill className={SD_TONE.amber}>Sem sinal</SdPill> : null}
      </div>
    ),
  },
]

const SOURCE_OPTIONS = [
  { value: 'AGENT', label: 'Agente' },
  { value: 'SNMP', label: 'SNMP' },
  { value: 'DISCOVERY', label: 'Descoberto' },
]
const DISCOVERED_FILTER_OPTIONS = [
  { value: 'true', label: 'Descobertos, para adotar' },
]
const ALERT_FILTER_OPTIONS = [{ value: 'true', label: 'Com alerta aberto' }]
const STALE_FILTER_OPTIONS = [{ value: 'true', label: 'Sem sinal' }]

function SummaryCards({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useSdInventorySummary(workspaceId)
  const items = [
    { label: 'Equipamentos', value: data?.total },
    { label: 'Com agente', value: data?.agents },
    { label: 'Descobertos por SNMP', value: data?.snmp },
    { label: 'Para adotar', value: data?.discovered },
    { label: 'Sem sinal', value: data?.stale },
    { label: 'Alertas abertos', value: data?.openAlerts },
  ]
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
      {items.map((item) => (
        <div
          key={item.label}
          className='flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3'
        >
          <span className='text-muted-foreground text-xs'>{item.label}</span>
          {isLoading ? (
            <Skeleton className='h-6 w-10' />
          ) : (
            <span className='font-semibold text-xl tabular-nums'>
              {item.value ?? 0}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** Escolhe outro equipamento para juntar ao que está aberto (mescla manual). */
function MergeDialog({
  workspaceId,
  device,
  onClose,
}: {
  workspaceId: string
  device: { id: string; hostname: string }
  onClose: () => void
}) {
  const [term, setTerm] = useState('')
  const search = term.trim() || undefined
  const managed = useSdInventoryDevices(workspaceId, {
    search,
    page: 1,
    pageSize: 8,
  })
  const discovered = useSdInventoryDevices(workspaceId, {
    search,
    page: 1,
    pageSize: 8,
    discovered: true,
  })
  const actions = useSdInventoryDeviceActions(workspaceId)
  const options = [
    ...(managed.data?.items ?? []),
    ...(discovered.data?.items ?? []),
  ].filter((item) => item.id !== device.id)

  function mergeIn(other: SdInventoryDeviceDTO) {
    actions.merge.mutate(
      { deviceId: other.id, data: { intoId: device.id } },
      {
        onSuccess: () => {
          notify.success(
            `"${other.hostname}" foi juntado a "${device.hostname}"`,
          )
          onClose()
        },
        onError: (err) => notify.error(err),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Juntar outro equipamento</DialogTitle>
          <DialogDescription>
            Escolha a ficha que é a mesma máquina de "{device.hostname}". Ela
            passa a aparecer dentro desta e deixa de duplicar o item da CMDB.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder='Nome, série ou IP…'
          autoFocus
        />
        {options.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhum equipamento encontrado.
          </p>
        ) : (
          <ul className='flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border'>
            {options.map((item) => (
              <li
                key={item.id}
                className='flex items-center justify-between gap-3 px-3 py-2'
              >
                <div className='flex min-w-0 flex-col'>
                  <span className='truncate font-medium text-sm'>
                    {item.hostname}
                  </span>
                  <span className='truncate text-muted-foreground text-xs'>
                    {SD_INVENTORY_SOURCE_LABEL[item.source]}
                    {item.ipAddresses[0] ? ` · ${item.ipAddresses[0]}` : ''}
                    {item.serialNumber ? ` · ${item.serialNumber}` : ''}
                  </span>
                </div>
                <Button
                  size='xs'
                  variant='outline'
                  disabled={actions.merge.isPending}
                  onClick={() => mergeIn(item)}
                >
                  Juntar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeviceSheet({
  workspaceId,
  slug,
  deviceId,
  isAdmin,
  onClose,
}: {
  workspaceId: string
  slug: string
  deviceId: string | null
  isAdmin: boolean
  onClose: () => void
}) {
  const { data, isLoading } = useSdInventoryDevice(workspaceId, deviceId)
  const actions = useSdInventoryDeviceActions(workspaceId)
  const [merging, setMerging] = useState(false)
  return (
    <Sheet open={!!deviceId} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent className='w-full gap-0 overflow-y-auto sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{data?.hostname ?? 'Equipamento'}</SheetTitle>
          <SheetDescription>
            {data
              ? `${SD_INVENTORY_SOURCE_LABEL[data.source]} · visto em ${formatInventoryDateTime(data.lastSeenAt)}`
              : 'Carregando…'}
          </SheetDescription>
        </SheetHeader>
        {isLoading || !data ? (
          <div className='flex flex-col gap-2 p-4'>
            <Skeleton className='h-5 w-1/2' />
            <Skeleton className='h-5 w-2/3' />
            <Skeleton className='h-5 w-1/3' />
          </div>
        ) : (
          <div className='flex flex-col gap-5 p-4'>
            {data.managed ? null : (
              <div className='flex flex-col gap-2 rounded-lg border border-border bg-muted px-3 py-2.5'>
                <p className='text-sm'>
                  Descoberto por ping/ARP e ainda sem gestão: não está na CMDB.
                </p>
                {isAdmin ? (
                  <div className='flex gap-2'>
                    <Button
                      size='xs'
                      disabled={actions.adopt.isPending}
                      onClick={() =>
                        actions.adopt.mutate(data.id, {
                          onSuccess: () =>
                            notify.success('Equipamento adotado'),
                          onError: (err) => notify.error(err),
                        })
                      }
                    >
                      Adotar
                    </Button>
                    <Button
                      size='xs'
                      variant='outline'
                      disabled={actions.dismiss.isPending}
                      onClick={() =>
                        actions.dismiss.mutate(data.id, {
                          onSuccess: () => {
                            notify.success('Equipamento descartado')
                            onClose()
                          },
                          onError: (err) => notify.error(err),
                        })
                      }
                    >
                      Descartar
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            <dl>
              <SdInfoRow label='Sistema'>
                {[data.osName, data.osVersion, data.arch]
                  .filter(Boolean)
                  .join(' ')}
              </SdInfoRow>
              <SdInfoRow label='Fabricante e modelo'>
                {[data.manufacturer, data.model].filter(Boolean).join(' ')}
              </SdInfoRow>
              <SdInfoRow label='Série'>{data.serialNumber}</SdInfoRow>
              <SdInfoRow label='Processador'>
                {data.cpuModel
                  ? `${data.cpuModel}${data.cpuCores ? ` (${data.cpuCores} núcleos)` : ''}`
                  : null}
              </SdInfoRow>
              <SdInfoRow label='Memória'>
                {data.ramTotalMb
                  ? `${formatMegabytes(data.ramUsedMb)} de ${formatMegabytes(data.ramTotalMb)}`
                  : null}
              </SdInfoRow>
              <SdInfoRow label='Endereços IP'>
                {data.ipAddresses.join(', ')}
              </SdInfoRow>
              <SdInfoRow label='Endereços MAC'>
                {data.macAddresses.join(', ')}
              </SdInfoRow>
              <SdInfoRow label='Primeiro contato'>
                {formatInventoryDateTime(data.firstSeenAt)}
              </SdInfoRow>
              <SdInfoRow label='Item da CMDB'>
                {data.configItemId ? (
                  <Link
                    className='text-primary underline-offset-2 hover:underline'
                    href={`/${slug}/servicedesk/config-items?record=${data.configItemId}`}
                  >
                    {data.configItemName ?? 'Abrir item'}
                  </Link>
                ) : null}
              </SdInfoRow>
            </dl>

            <section className='flex flex-col gap-2'>
              <div className='flex items-center justify-between gap-2'>
                <h4 className='font-semibold text-sm'>
                  Mesma máquina em outras origens ({data.mergedSources.length})
                </h4>
                {isAdmin ? (
                  <Button
                    size='xs'
                    variant='outline'
                    onClick={() => setMerging(true)}
                  >
                    Juntar outro
                  </Button>
                ) : null}
              </div>
              {data.mergedSources.length === 0 ? (
                <p className='text-muted-foreground text-xs'>
                  Nenhuma. Quando duas origens enxergam a mesma máquina
                  (mesma série, MAC ou nome), as fichas são juntadas sozinhas.
                </p>
              ) : (
                <ul className='flex flex-col gap-1.5'>
                  {data.mergedSources.map((source) => (
                    <li
                      key={source.id}
                      className='flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm'
                    >
                      <span className='flex min-w-0 items-center gap-2'>
                        <Badge variant='outline'>
                          {SD_INVENTORY_SOURCE_LABEL[source.source]}
                        </Badge>
                        <span className='truncate'>{source.hostname}</span>
                      </span>
                      {isAdmin ? (
                        <Button
                          size='xs'
                          variant='ghost'
                          disabled={actions.unmerge.isPending}
                          onClick={() =>
                            actions.unmerge.mutate(source.id, {
                              onSuccess: () =>
                                notify.success('Mescla desfeita'),
                              onError: (err) => notify.error(err),
                            })
                          }
                        >
                          Separar
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className='flex flex-col gap-2'>
              <h4 className='font-semibold text-sm'>Discos</h4>
              {data.disks.length === 0 ? (
                <p className='text-muted-foreground text-xs'>
                  Nenhum volume informado.
                </p>
              ) : (
                <ul className='flex flex-col gap-1.5'>
                  {data.disks.map((disk) => (
                    <li
                      key={disk.mount}
                      className='flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm'
                    >
                      <span className='min-w-0 truncate'>
                        <span className='font-mono text-xs'>{disk.mount}</span>
                        {disk.label ? ` · ${disk.label}` : ''}
                      </span>
                      <span className='flex shrink-0 items-center gap-2'>
                        <span className='text-muted-foreground text-xs'>
                          {formatMegabytes(disk.usedMb)} /{' '}
                          {formatMegabytes(disk.totalMb)}
                        </span>
                        <UsagePill percent={disk.usedPercent} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className='flex flex-col gap-2'>
              <h4 className='font-semibold text-sm'>
                Software instalado ({data.software.length})
              </h4>
              {data.software.length === 0 ? (
                <p className='text-muted-foreground text-xs'>
                  Nenhum programa informado.
                </p>
              ) : (
                <ul className='max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border'>
                  {data.software.map((item) => (
                    <li
                      key={item.id}
                      className='flex items-center justify-between gap-3 px-3 py-1.5 text-sm'
                    >
                      <span className='min-w-0 truncate'>{item.name}</span>
                      <span className='shrink-0 text-muted-foreground text-xs'>
                        {item.version || '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
      {merging && data ? (
        <MergeDialog
          workspaceId={workspaceId}
          device={{ id: data.id, hostname: data.hostname }}
          onClose={() => setMerging(false)}
        />
      ) : null}
    </Sheet>
  )
}

function DevicesTab({
  workspaceId,
  slug,
  isAdmin,
}: {
  workspaceId: string
  slug: string
  isAdmin: boolean
}) {
  const table = useSdTableState({
    sort: 'hostname',
    filters: { source: '', hasAlert: '', stale: '', discovered: '' },
  })
  const { data, isLoading, error } = useSdInventoryDevices(workspaceId, {
    search: table.q || undefined,
    page: table.page,
    pageSize: table.pageSize,
    source: (table.filters.source || undefined) as
      | 'AGENT'
      | 'SNMP'
      | 'DISCOVERY'
      | undefined,
    discovered: table.filters.discovered === 'true',
    hasAlert: table.filters.hasAlert === 'true',
    stale: table.filters.stale === 'true',
  })
  const [detailId, setDetailId] = useState<string | null>(null)

  return (
    <>
      <SdDataTable
        storageKey='inventory-devices'
        columns={DEVICE_COLUMNS}
        rows={data?.items ?? []}
        total={data?.total ?? 0}
        page={table.page}
        pageSize={table.pageSize}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        search={table.search}
        onSearchChange={table.setSearch}
        searchPlaceholder='Nome, série, sistema ou IP…'
        isLoading={isLoading}
        error={error ? error.message : null}
        onRowClick={(row) => setDetailId(row.id)}
        activeFilterCount={table.activeFilterCount}
        onClearFilters={table.clearFilters}
        filters={
          <>
            <SdFilterField label='Origem'>
              <SdFilterSelect
                value={table.filters.source}
                onChange={(v) => table.setFilter('source', v)}
                options={SOURCE_OPTIONS}
                allLabel='Todas'
              />
            </SdFilterField>
            <SdFilterField label='Alertas'>
              <SdFilterSelect
                value={table.filters.hasAlert}
                onChange={(v) => table.setFilter('hasAlert', v)}
                options={ALERT_FILTER_OPTIONS}
                allLabel='Todos'
              />
            </SdFilterField>
            <SdFilterField label='Situação'>
              <SdFilterSelect
                value={table.filters.discovered}
                onChange={(v) => table.setFilter('discovered', v)}
                options={DISCOVERED_FILTER_OPTIONS}
                allLabel='Geridos'
              />
            </SdFilterField>
            <SdFilterField label='Contato'>
              <SdFilterSelect
                value={table.filters.stale}
                onChange={(v) => table.setFilter('stale', v)}
                options={STALE_FILTER_OPTIONS}
                allLabel='Todos'
              />
            </SdFilterField>
          </>
        }
        emptyTitle='Nenhum equipamento no inventário'
        emptyDescription='Cadastre um alvo SNMP ou uma faixa de rede para a descoberta por ping em Ajustes > Inventário.'
      />
      <DeviceSheet
        workspaceId={workspaceId}
        slug={slug}
        deviceId={detailId}
        isAdmin={isAdmin}
        onClose={() => setDetailId(null)}
      />
    </>
  )
}

const ALERT_COLUMNS: SdColumn<SdInventoryAlertDTO>[] = [
  {
    id: 'hostname',
    header: 'Equipamento',
    hideable: false,
    cell: (a) => <span className='font-medium'>{a.hostname}</span>,
  },
  {
    id: 'kind',
    header: 'Tipo',
    cell: (a) =>
      `${SD_INVENTORY_ALERT_KIND_LABEL[a.kind]}${a.mount ? ` · ${a.mount}` : ''}`,
  },
  {
    id: 'usage',
    header: 'Ocupação',
    cell: (a) => (
      <span className='flex items-center gap-2'>
        <UsagePill percent={a.usedPercent} />
        <span className='text-muted-foreground text-xs'>
          limiar {a.threshold}%
        </span>
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Situação',
    cell: (a) => (
      <SdPill className={a.status === 'OPEN' ? SD_TONE.red : SD_TONE.emerald}>
        {a.status === 'OPEN' ? 'Aberto' : 'Normalizado'}
      </SdPill>
    ),
  },
  {
    id: 'openedAt',
    header: 'Aberto em',
    cell: (a) => formatInventoryDateTime(a.openedAt),
  },
  {
    id: 'resolvedAt',
    header: 'Normalizado em',
    cell: (a) => formatInventoryDateTime(a.resolvedAt),
  },
]

function AlertsTab({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<'OPEN' | ''>('OPEN')
  const { data, isLoading, error } = useSdInventoryAlerts(workspaceId, {
    status: status || undefined,
    limit: 200,
  })
  return (
    <SdDataTable
      storageKey='inventory-alerts'
      columns={ALERT_COLUMNS}
      rows={data ?? []}
      total={data?.length ?? 0}
      page={1}
      pageSize={200}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
      search=''
      onSearchChange={() => {}}
      hideToolbar
      isLoading={isLoading}
      error={error ? error.message : null}
      emptyTitle={
        status === 'OPEN' ? 'Nenhum alerta aberto' : 'Nenhum alerta registrado'
      }
      emptyDescription='Os alertas de disco e memória aparecem aqui quando um equipamento passa do limiar definido em Ajustes > Inventário.'
      emptyAction={
        <button
          type='button'
          className='text-primary text-sm underline-offset-2 hover:underline'
          onClick={() => setStatus(status === 'OPEN' ? '' : 'OPEN')}
        >
          {status === 'OPEN'
            ? 'Ver também os normalizados'
            : 'Ver só os abertos'}
        </button>
      }
    />
  )
}

const SOFTWARE_COLUMNS: SdColumn<
  SdInventorySoftwareCatalogRowDTO & { id: string }
>[] = [
  {
    id: 'name',
    header: 'Programa',
    hideable: false,
    cell: (s) => <span className='font-medium'>{s.name}</span>,
  },
  { id: 'version', header: 'Versão', cell: (s) => s.version || '—' },
  { id: 'publisher', header: 'Fabricante', cell: (s) => s.publisher || '—' },
  {
    id: 'devices',
    header: 'Equipamentos',
    cell: (s) => <span className='tabular-nums'>{s.deviceCount}</span>,
  },
]

function SoftwareTab({ workspaceId }: { workspaceId: string }) {
  const table = useSdTableState({ sort: 'name', filters: {} })
  const { data, isLoading, error } = useSdInventorySoftware(workspaceId, {
    search: table.q || undefined,
    page: table.page,
    pageSize: table.pageSize,
  })
  const rows = (data?.items ?? []).map((item) => ({
    ...item,
    id: `${item.name}@${item.version}`,
  }))
  return (
    <SdDataTable
      storageKey='inventory-software'
      columns={SOFTWARE_COLUMNS}
      rows={rows}
      total={data?.total ?? 0}
      page={table.page}
      pageSize={table.pageSize}
      onPageChange={table.setPage}
      onPageSizeChange={table.setPageSize}
      search={table.search}
      onSearchChange={table.setSearch}
      searchPlaceholder='Nome do programa…'
      isLoading={isLoading}
      error={error ? error.message : null}
      emptyTitle='Nenhum software inventariado'
      emptyDescription='A lista vem do inventário que já existia e do SNMP, quando o equipamento expõe.'
    />
  )
}

export function SdInventoryView({
  workspaceId,
  slug,
  isAdmin,
}: {
  workspaceId: string
  slug: string
  isAdmin: boolean
}) {
  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4'>
      <SummaryCards workspaceId={workspaceId} />
      <Tabs defaultValue='devices' className='min-h-0 flex-1 gap-3'>
        <TabsList>
          <TabsTrigger value='devices'>Equipamentos</TabsTrigger>
          <TabsTrigger value='alerts'>Alertas</TabsTrigger>
          <TabsTrigger value='software'>Software</TabsTrigger>
        </TabsList>
        <TabsContent value='devices'>
          <DevicesTab workspaceId={workspaceId} slug={slug} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value='alerts'>
          <AlertsTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value='software'>
          <SoftwareTab workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

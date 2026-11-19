'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Building03Icon,
  Download04Icon,
  FilterIcon,
  Search01Icon,
  UserIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { SimpleSelect } from '@/app/_components/crm/simple-select'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  type CrmCustomerQuery,
  crmCustomersExportUrl,
  useCrmCustomerOptions,
  useCrmCustomers,
} from '@/src/hooks/use-crm-customers'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type {
  CrmCustomerKind,
  CrmCustomerRowDTO,
  CrmCustomerSort,
} from '@/src/schemas/crm-customer.schema'
import { HEALTH_TONE } from '../health/health-tone'

const LOOKUP_KINDS: LookupKind[] = ['users']
const PAGE_SIZE = 25
const ALL = '__all__'
const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e', 'f']

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
})
const formatDate = (iso: string | null) =>
  iso ? dateFormat.format(new Date(iso)) : '—'

const HEALTH_LABEL = {
  LOW: 'Saudável',
  MEDIUM: 'Atenção',
  HIGH: 'Em risco',
} as const

const RENEWAL_ITEMS = [
  { value: ALL, label: 'Todos' },
  { value: 'yes', label: 'Com renovação prevista' },
  { value: 'no', label: 'Sem renovação' },
]

type Filters = {
  wonFrom: string
  wonTo: string
  minTotal: string
  maxTotal: string
  productId: string
  pipelineId: string
  ownerId: string
  hasRenewal: string
  inactiveDays: string
}

const NO_FILTERS: Filters = {
  wonFrom: '',
  wonTo: '',
  minTotal: '',
  maxTotal: '',
  productId: '',
  pipelineId: '',
  ownerId: '',
  hasRenewal: '',
  inactiveDays: '',
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function SummaryCard({
  label,
  value,
  loading,
}: {
  label: string
  value: string
  loading: boolean
}) {
  return (
    <div className='flex flex-col gap-1 rounded-xl border bg-card p-4'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      {loading ? (
        <Skeleton className='h-7 w-24' />
      ) : (
        <span className='font-semibold text-xl tabular-nums'>{value}</span>
      )}
    </div>
  )
}

function SortHeader({
  label,
  column,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string
  column: CrmCustomerSort
  sort: CrmCustomerSort
  dir: 'asc' | 'desc'
  onSort: (column: CrmCustomerSort) => void
  className?: string
}) {
  const active = sort === column
  return (
    <TableHead
      className={className}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type='button'
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1 font-medium hover:text-foreground',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        {active ? (
          <SteelIcon
            icon={dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon}
            size={14}
          />
        ) : null}
      </button>
    </TableHead>
  )
}

function CustomerRow({ row, slug }: { row: CrmCustomerRowDTO; slug: string }) {
  const href = `/${slug}/crm/${row.kind === 'COMPANY' ? 'companies' : 'people'}?record=${row.id}`
  return (
    <TableRow>
      <TableCell className='min-w-48'>
        <Link href={href} className='flex flex-col font-medium hover:underline'>
          <span className='truncate'>{row.name}</span>
          {row.subtitle ? (
            <span className='truncate font-normal text-muted-foreground text-xs'>
              {row.subtitle}
            </span>
          ) : null}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant='outline' className='gap-1'>
          <SteelIcon
            icon={row.kind === 'COMPANY' ? Building03Icon : UserIcon}
            size={12}
          />
          {row.kind === 'COMPANY' ? 'Empresa' : 'Pessoa'}
        </Badge>
      </TableCell>
      <TableCell className='text-right tabular-nums'>{row.deals}</TableCell>
      <TableCell className='text-right tabular-nums'>
        {money.format(row.totalWon)}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {money.format(row.averageTicket)}
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {formatDate(row.firstWonAt)}
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {formatDate(row.lastWonAt)}
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {formatDate(row.nextRenewalAt)}
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {row.ownerName ?? '—'}
      </TableCell>
      <TableCell>
        {row.health ? (
          <Badge
            variant='outline'
            className={HEALTH_TONE[row.health.level]}
            title={`Saúde ${row.health.score} de 100`}
          >
            {HEALTH_LABEL[row.health.level]} · {row.health.score}
          </Badge>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

export function CrmCustomersView({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [kind, setKind] = useState<CrmCustomerKind>('ALL')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState<CrmCustomerSort>('lastWonAt')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const options = useCrmCustomerOptions(workspaceId)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const query: CrmCustomerQuery = useMemo(
    () => ({
      kind,
      q: q || undefined,
      wonFrom: filters.wonFrom || undefined,
      wonTo: filters.wonTo || undefined,
      minTotal: numberOrUndefined(filters.minTotal),
      maxTotal: numberOrUndefined(filters.maxTotal),
      productId: filters.productId || undefined,
      pipelineId: filters.pipelineId || undefined,
      ownerId: filters.ownerId || undefined,
      hasRenewal:
        filters.hasRenewal === 'yes' || filters.hasRenewal === 'no'
          ? filters.hasRenewal
          : undefined,
      inactiveDays: numberOrUndefined(filters.inactiveDays),
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [kind, q, filters, sort, dir, page],
  )

  const list = useCrmCustomers(workspaceId, query)
  const data = list.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const activeFilters = Object.values(filters).filter((v) => v !== '').length

  function setFilter(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  function onSort(column: CrmCustomerSort) {
    if (column === sort) {
      setDir((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(column)
      setDir(column === 'name' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  const productItems = [
    { value: ALL, label: 'Todos os produtos' },
    ...(options.data?.products ?? []).map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ]
  const pipelineItems = [
    { value: ALL, label: 'Todos os funis' },
    ...(options.data?.pipelines ?? []).map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ]
  const ownerItems = [
    { value: ALL, label: 'Todos os responsáveis' },
    ...lookups.options.users.map((u) => ({ value: u.value, label: u.label })),
  ]

  const loadingTotals = list.isLoading
  const totals = data?.totals

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 md:p-6'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        <SummaryCard
          label='Clientes'
          value={String(totals?.customers ?? 0)}
          loading={loadingTotals}
        />
        <SummaryCard
          label='Receita ganha'
          value={money.format(totals?.revenue ?? 0)}
          loading={loadingTotals}
        />
        <SummaryCard
          label='Negócios ganhos'
          value={String(totals?.deals ?? 0)}
          loading={loadingTotals}
        />
        <SummaryCard
          label='Ticket médio'
          value={money.format(totals?.averageTicket ?? 0)}
          loading={loadingTotals}
        />
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Tabs
          value={kind}
          onValueChange={(value) => {
            setKind(value as CrmCustomerKind)
            setPage(1)
          }}
        >
          <TabsList>
            <TabsTrigger value='ALL'>Todos</TabsTrigger>
            <TabsTrigger value='COMPANY'>Empresas</TabsTrigger>
            <TabsTrigger value='PERSON'>Pessoas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='relative min-w-48 flex-1 md:max-w-sm'>
          <SteelIcon
            icon={Search01Icon}
            size={16}
            className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-muted-foreground'
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Buscar clientes…'
            aria-label='Buscar clientes'
            className='pl-8'
          />
        </div>
        <Button
          variant={showFilters ? 'secondary' : 'outline'}
          onClick={() => setShowFilters((current) => !current)}
          aria-expanded={showFilters}
        >
          <SteelIcon icon={FilterIcon} size={16} />
          Filtros{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </Button>
        <Button
          variant='outline'
          nativeButton={false}
          render={
            <a href={crmCustomersExportUrl(workspaceId, query)} download>
              <SteelIcon icon={Download04Icon} size={16} />
              Exportar CSV
            </a>
          }
        />
      </div>

      {showFilters ? (
        <section
          aria-label='Filtros'
          className='grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4'
        >
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cust-won-from'>Ganho a partir de</Label>
            <Input
              id='cust-won-from'
              type='date'
              value={filters.wonFrom}
              onChange={(e) => setFilter({ wonFrom: e.target.value })}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cust-won-to'>Ganho até</Label>
            <Input
              id='cust-won-to'
              type='date'
              value={filters.wonTo}
              onChange={(e) => setFilter({ wonTo: e.target.value })}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cust-min'>Valor total mínimo (R$)</Label>
            <Input
              id='cust-min'
              inputMode='decimal'
              placeholder='0'
              value={filters.minTotal}
              onChange={(e) => setFilter({ minTotal: e.target.value })}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cust-max'>Valor total máximo (R$)</Label>
            <Input
              id='cust-max'
              inputMode='decimal'
              placeholder='Sem limite'
              value={filters.maxTotal}
              onChange={(e) => setFilter({ maxTotal: e.target.value })}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label>Produto</Label>
            <SimpleSelect
              ariaLabel='Produto'
              value={filters.productId || ALL}
              items={productItems}
              onChange={(next) =>
                setFilter({ productId: next === ALL ? '' : next })
              }
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label>Funil</Label>
            <SimpleSelect
              ariaLabel='Funil'
              value={filters.pipelineId || ALL}
              items={pipelineItems}
              onChange={(next) =>
                setFilter({ pipelineId: next === ALL ? '' : next })
              }
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label>Responsável</Label>
            <SimpleSelect
              ariaLabel='Responsável'
              value={filters.ownerId || ALL}
              items={ownerItems}
              onChange={(next) =>
                setFilter({ ownerId: next === ALL ? '' : next })
              }
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label>Renovação</Label>
            <SimpleSelect
              ariaLabel='Renovação'
              value={filters.hasRenewal || ALL}
              items={RENEWAL_ITEMS}
              onChange={(next) =>
                setFilter({ hasRenewal: next === ALL ? '' : next })
              }
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='cust-inactive'>Sem compra há (dias)</Label>
            <Input
              id='cust-inactive'
              inputMode='numeric'
              placeholder='Ex.: 180'
              value={filters.inactiveDays}
              onChange={(e) =>
                setFilter({ inactiveDays: e.target.value.replace(/\D/g, '') })
              }
            />
          </div>
          <div className='flex items-end'>
            <Button
              variant='ghost'
              disabled={activeFilters === 0}
              onClick={() => {
                setFilters(NO_FILTERS)
                setPage(1)
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </section>
      ) : null}

      {list.isError ? (
        <div
          role='alert'
          className='flex flex-col items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm'
        >
          <span>Não foi possível carregar os clientes.</span>
          <Button size='sm' variant='outline' onClick={() => list.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <div className='rounded-xl border'>
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader
                    label='Nome'
                    column='name'
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                  />
                  <TableHead>Tipo</TableHead>
                  <SortHeader
                    label='Negócios'
                    column='deals'
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className='text-right'
                  />
                  <SortHeader
                    label='Total ganho'
                    column='total'
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className='text-right'
                  />
                  <SortHeader
                    label='Ticket médio'
                    column='average'
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                    className='text-right'
                  />
                  <SortHeader
                    label='Primeiro ganho'
                    column='firstWonAt'
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                  />
                  <SortHeader
                    label='Último ganho'
                    column='lastWonAt'
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                  />
                  <SortHeader
                    label='Próx. renovação'
                    column='nextRenewalAt'
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                  />
                  <TableHead>Responsável</TableHead>
                  <TableHead>Saúde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.isLoading
                  ? SKELETON_ROWS.map((key) => (
                      <TableRow key={key}>
                        <TableCell colSpan={10}>
                          <Skeleton className='h-6 w-full' />
                        </TableCell>
                      </TableRow>
                    ))
                  : (data?.items ?? []).map((row) => (
                      <CustomerRow
                        key={`${row.kind}-${row.id}`}
                        row={row}
                        slug={slug}
                      />
                    ))}
              </TableBody>
            </Table>
          </div>
          {!list.isLoading && (data?.items.length ?? 0) === 0 ? (
            <p className='p-8 text-center text-muted-foreground text-sm'>
              {activeFilters > 0 || q
                ? 'Nenhum cliente com esses filtros.'
                : 'Ainda não há clientes: empresas e pessoas aparecem aqui quando têm um negócio ganho.'}
            </p>
          ) : null}
        </div>
      )}

      <div className='flex items-center justify-between gap-3 text-muted-foreground text-sm'>
        <span>
          {data ? `${data.total} cliente${data.total === 1 ? '' : 's'}` : ' '}
        </span>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </Button>
          <span className='tabular-nums'>
            Página {page} de {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  )
}

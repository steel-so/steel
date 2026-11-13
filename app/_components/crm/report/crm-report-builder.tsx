'use client'

import {
  ArrowLeft02Icon,
  Delete02Icon,
  Download04Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import {
  type AvailableRelation,
  availableRelations,
  makeAlias,
  outputColumns,
  queryFields,
  reconcile,
} from '@/app/_components/crm/report/query-helpers'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  CRM_REPORT_SOURCE_LABELS,
  reportFields,
  setContactReportFields,
} from '@/src/config/crm-report-fields'
import {
  crmReportExportUrl,
  useCrmReport,
  useCrmReportData,
  useDeleteCrmReport,
  useUpdateCrmReport,
} from '@/src/hooks/use-crm-report'
import { useWhatsAppContactFields } from '@/src/hooks/use-whatsapp-contacts'
import {
  CRM_REPORT_AGGREGATION_FNS,
  CRM_REPORT_SOURCES,
  type CrmJoinQuery,
  type CrmReportAggregationFn,
  type CrmReportData,
  type CrmReportQuery,
  type CrmReportSource,
  type CrmUnionQuery,
} from '@/src/schemas/crm-report.schema'

const AGG_LABELS: Record<CrmReportAggregationFn, string> = {
  count: 'Contagem',
  sum: 'Soma',
  avg: 'Média',
  min: 'Mínimo',
  max: 'Máximo',
}

export function CrmReportBuilder({
  workspaceId,
  slug,
  reportId,
  basePath = 'crm',
  listHref,
}: {
  workspaceId: string
  slug: string
  reportId: string
  /** Segmento de módulo da API (`crm` ou `whatsapp`). */
  basePath?: string
  /** Rota de navegação da listagem (default `/{slug}/crm/reports`). */
  listHref?: string
}) {
  const {
    data: report,
    isLoading,
    error,
  } = useCrmReport(workspaceId, reportId, basePath)
  // WhatsApp reports offer the workspace's contact fields as extra columns.
  // Set during render (idempotent) so every child reads the up-to-date list.
  const contactFields = useWhatsAppContactFields(
    basePath === 'whatsapp' ? workspaceId : '',
  )
  setContactReportFields((contactFields.data ?? []).map((f) => f.label))

  if (isLoading) {
    return (
      <div className='flex h-full flex-col gap-4 p-6'>
        <Skeleton className='h-10 w-64' />
        <Skeleton className='h-full w-full' />
      </div>
    )
  }
  if (error || !report) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
        Relatório não encontrado.
      </div>
    )
  }
  return (
    <CrmReportBuilderInner
      workspaceId={workspaceId}
      basePath={basePath}
      listHref={listHref ?? `/${slug}/crm/reports`}
      initial={report}
    />
  )
}

function CrmReportBuilderInner({
  workspaceId,
  basePath,
  listHref,
  initial,
}: {
  workspaceId: string
  basePath: string
  listHref: string
  initial: { id: string; name: string; query: CrmReportQuery }
}) {
  const router = useRouter()
  const [name, setName] = React.useState(initial.name)
  const [query, setQueryState] = React.useState<CrmReportQuery>(initial.query)
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved'>(
    'idle',
  )

  const updateReport = useUpdateCrmReport(workspaceId, basePath)
  const deleteReport = useDeleteCrmReport(workspaceId, basePath)
  const {
    data,
    isFetching: loadingData,
    refetch,
  } = useCrmReportData(workspaceId, initial.id, basePath)

  const setQuery = React.useCallback(
    (next: CrmReportQuery | ((q: CrmReportQuery) => CrmReportQuery)) =>
      setQueryState((prev) =>
        reconcile(typeof next === 'function' ? next(prev) : next),
      ),
    [],
  )

  // Auto-save (debounce) — persiste e atualiza o preview. Pula a 1ª renderização.
  const mounted = React.useRef(false)
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (!isSavable(query)) return
    setStatus('saving')
    const timer = setTimeout(async () => {
      try {
        await updateReport.mutateAsync({
          reportId: initial.id,
          patch: { name: name.trim() || 'Relatório sem título', query },
        })
        setStatus('saved')
        await refetch()
      } catch (err) {
        setStatus('idle')
        notify.error(err, 'Não foi possível salvar.')
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [name, query])

  async function handleDelete() {
    try {
      await deleteReport.mutateAsync(initial.id)
      notify.success('Relatório excluído.')
      router.push(listHref)
    } catch (err) {
      notify.error(err, 'Não foi possível excluir o relatório.')
    }
  }

  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-14 shrink-0 items-center gap-2 border-b px-3'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Voltar'
          onClick={() => router.push(listHref)}
        >
          <SteelIcon icon={ArrowLeft02Icon} strokeWidth={2} />
        </Button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Relatório sem título'
          aria-label='Nome do relatório'
          className='min-w-0 flex-1 bg-transparent font-semibold text-sm outline-none placeholder:text-muted-foreground/60'
        />
        <span className='mr-1 text-muted-foreground text-xs tabular-nums'>
          {status === 'saving'
            ? 'Salvando…'
            : status === 'saved'
              ? 'Salvo'
              : ''}
        </span>
        <Button
          size='sm'
          variant='outline'
          nativeButton={false}
          render={
            <a
              href={crmReportExportUrl(
                workspaceId,
                initial.id,
                'csv',
                basePath,
              )}
              download
            >
              <SteelIcon icon={Download04Icon} strokeWidth={2} />
              CSV
            </a>
          }
        />
        <Button
          size='sm'
          variant='outline'
          nativeButton={false}
          render={
            <a
              href={crmReportExportUrl(
                workspaceId,
                initial.id,
                'xlsx',
                basePath,
              )}
              download
            >
              <SteelIcon icon={Download04Icon} strokeWidth={2} />
              Excel
            </a>
          }
        />
        <ConfirmAction
          trigger={
            <Button
              size='icon-sm'
              variant='ghost'
              aria-label='Excluir relatório'
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          }
          title={`Excluir o relatório "${name.trim() || 'sem título'}"?`}
          description='O relatório e a configuração dele serão apagados. Não dá para desfazer.'
          onConfirm={handleDelete}
        />
      </header>

      <div className='flex min-h-0 flex-1 flex-col lg:flex-row'>
        <div className='min-w-0 overflow-y-auto border-b lg:w-96 lg:shrink-0 lg:border-r lg:border-b-0'>
          <div className='flex flex-col gap-6 p-6'>
            <ModeSection query={query} setQuery={setQuery} />
            <DatasetsSection query={query} setQuery={setQuery} />
            <ColumnsSection query={query} setQuery={setQuery} />
            <GroupSection query={query} setQuery={setQuery} />
            <SortSection query={query} setQuery={setQuery} />
          </div>
        </div>

        <PreviewSection data={data ?? null} loading={loadingData} />
      </div>
    </div>
  )
}

type SectionProps = {
  query: CrmReportQuery
  setQuery: (
    next: CrmReportQuery | ((q: CrmReportQuery) => CrmReportQuery),
  ) => void
}

/* --------------------------------- Modo --------------------------------- */

function ModeSection({ query, setQuery }: SectionProps) {
  function switchTo(mode: 'join' | 'union') {
    if (mode === query.mode) return
    setQuery((q) => (mode === 'join' ? toJoin(q) : toUnion(q)))
  }
  return (
    <div className='flex flex-col gap-2'>
      <Label>Como montar o relatório</Label>
      <div className='grid grid-cols-2 gap-1.5'>
        <ModeChip
          active={query.mode === 'join'}
          title='Uma fonte principal'
          desc='Parte de uma lista (ex.: leads) e acrescenta colunas de dados ligados a ela'
          onClick={() => switchTo('join')}
        />
        <ModeChip
          active={query.mode === 'union'}
          title='Várias listas em uma'
          desc='Junta, uma embaixo da outra, listas de fontes diferentes (ex.: leads e pessoas)'
          onClick={() => switchTo('union')}
        />
      </div>
    </div>
  )
}

function ModeChip({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors ${
        active ? 'border-primary bg-primary/10' : 'hover:bg-muted/60'
      }`}
    >
      <span className='font-medium text-sm'>{title}</span>
      <span className='text-muted-foreground text-xs'>{desc}</span>
    </button>
  )
}

/* ------------------------------- Fontes -------------------------------- */

function DatasetsSection({ query, setQuery }: SectionProps) {
  return (
    <div className='flex flex-col gap-2'>
      <Label>Fontes</Label>
      <div className='flex flex-col gap-1.5'>
        {query.datasets.map((ds, i) => (
          <div
            key={ds.alias}
            className='flex items-center justify-between rounded-md border px-2.5 py-1.5'
          >
            <span className='text-sm'>
              {CRM_REPORT_SOURCE_LABELS[ds.source]}
              {i === 0 && (
                <span className='ml-1.5 text-muted-foreground text-xs'>
                  base
                </span>
              )}
            </span>
            {i > 0 && (
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Remover fonte'
                onClick={() => setQuery((q) => removeDataset(q, ds.alias))}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            )}
          </div>
        ))}
      </div>
      {query.mode === 'join' ? (
        <AddJoinDataset query={query} setQuery={setQuery} />
      ) : (
        <AddUnionDataset query={query} setQuery={setQuery} />
      )}
    </div>
  )
}

function AddJoinDataset({
  query,
  setQuery,
}: {
  query: CrmJoinQuery
  setQuery: SectionProps['setQuery']
}) {
  const relations = availableRelations(query)
  if (query.datasets.length >= 5 || relations.length === 0) return null
  return (
    <Select
      value='__add__'
      onValueChange={(v) => {
        const rel = relations[Number(v)]
        if (rel) setQuery((q) => addJoinDataset(q as CrmJoinQuery, rel))
      }}
    >
      <SelectTrigger className='w-full'>
        <span className='flex items-center gap-1.5 text-muted-foreground'>
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
          Mesclar outra fonte
        </span>
      </SelectTrigger>
      <SelectContent>
        {relations.map((rel, i) => (
          <SelectItem key={i} value={String(i)}>
            {rel.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AddUnionDataset({
  query,
  setQuery,
}: {
  query: CrmUnionQuery
  setQuery: SectionProps['setQuery']
}) {
  if (query.datasets.length >= 5) return null
  return (
    <Select
      value='__add__'
      onValueChange={(v) =>
        setQuery((q) =>
          addUnionDataset(q as CrmUnionQuery, v as CrmReportSource),
        )
      }
    >
      <SelectTrigger className='w-full'>
        <span className='flex items-center gap-1.5 text-muted-foreground'>
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
          Empilhar outra fonte
        </span>
      </SelectTrigger>
      <SelectContent>
        {CRM_REPORT_SOURCES.map((s) => (
          <SelectItem key={s} value={s}>
            {CRM_REPORT_SOURCE_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/* ------------------------------- Colunas ------------------------------- */

function ColumnsSection({ query, setQuery }: SectionProps) {
  if (query.mode === 'union') {
    return <UnionColumns query={query} setQuery={setQuery} />
  }
  return (
    <div className='flex flex-col gap-3'>
      <Label>Colunas</Label>
      {query.datasets.map((ds) => (
        <div key={ds.alias} className='flex flex-col gap-1.5'>
          {query.datasets.length > 1 && (
            <span className='text-muted-foreground text-xs'>
              {CRM_REPORT_SOURCE_LABELS[ds.source]}
            </span>
          )}
          <div className='flex flex-wrap gap-1.5'>
            {reportFields(ds.source).map((f) => {
              const key = `${ds.alias}.${f.key}`
              const selected = query.columns.includes(key)
              return (
                <button
                  type='button'
                  key={key}
                  onClick={() =>
                    setQuery((q) => toggleJoinColumn(q as CrmJoinQuery, key))
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {query.columns.length === 0 && (
        <p className='text-destructive text-xs'>
          Selecione ao menos uma coluna.
        </p>
      )}
    </div>
  )
}

function UnionColumns({
  query,
  setQuery,
}: {
  query: CrmUnionQuery
  setQuery: SectionProps['setQuery']
}) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <Label>Colunas mescladas</Label>
        <Button
          size='icon-sm'
          variant='ghost'
          aria-label='Adicionar coluna'
          onClick={() => setQuery((q) => addUnionColumn(q as CrmUnionQuery))}
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
        </Button>
      </div>
      <div className='flex flex-col gap-3'>
        {query.columns.map((col, i) => (
          <div
            key={i}
            className='flex flex-col gap-1.5 rounded-md border p-2.5'
          >
            <div className='flex items-center gap-1.5'>
              <Input
                value={col.label}
                placeholder='Rótulo'
                className='h-8'
                onChange={(e) =>
                  setQuery((q) =>
                    updateUnionColumnLabel(
                      q as CrmUnionQuery,
                      i,
                      e.target.value,
                    ),
                  )
                }
              />
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Remover coluna'
                onClick={() =>
                  setQuery((q) => removeUnionColumn(q as CrmUnionQuery, i))
                }
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
            {query.datasets.map((ds) => (
              <div key={ds.alias} className='flex items-center gap-2'>
                <span className='w-24 shrink-0 truncate text-muted-foreground text-xs'>
                  {CRM_REPORT_SOURCE_LABELS[ds.source]}
                </span>
                <Select
                  value={col.fields[ds.alias] ?? '__none__'}
                  onValueChange={(v) =>
                    setQuery((q) =>
                      setUnionColumnField(
                        q as CrmUnionQuery,
                        i,
                        ds.alias,
                        v === '__none__' ? null : v,
                      ),
                    )
                  }
                >
                  <SelectTrigger className='h-8 flex-1'>
                    <span>
                      {col.fields[ds.alias]
                        ? (reportFields(ds.source).find(
                            (f) => f.key === col.fields[ds.alias],
                          )?.label ?? col.fields[ds.alias])
                        : '—'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__none__'>—</SelectItem>
                    {reportFields(ds.source).map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className='flex items-center justify-between'>
        <span className='text-sm'>Incluir coluna de origem</span>
        <Switch
          checked={query.includeSource}
          onCheckedChange={(c) =>
            setQuery((q) => ({ ...(q as CrmUnionQuery), includeSource: c }))
          }
          aria-label='Incluir coluna de origem'
        />
      </div>
    </div>
  )
}

/* --------------------------- Agrupar & agregar -------------------------- */

function GroupSection({ query, setQuery }: SectionProps) {
  const fields = queryFields(query)
  const grouped = Boolean(query.group)

  function toggle(on: boolean) {
    setQuery((q) => {
      if (!on) return { ...q, group: undefined }
      const first = queryFields(q)[0]
      if (!first) return q
      return {
        ...q,
        group: {
          by: [first.key],
          aggregations: [{ fn: 'count', alias: 'Contagem' }],
        },
      }
    })
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <Label>Agrupar e agregar</Label>
        <Switch
          checked={grouped}
          onCheckedChange={toggle}
          aria-label='Agrupar e agregar'
        />
      </div>

      {query.group && (
        <div className='flex flex-col gap-3 rounded-md border p-2.5'>
          <div className='flex flex-col gap-1.5'>
            <span className='text-muted-foreground text-xs'>Agrupar por</span>
            <div className='flex flex-wrap gap-1.5'>
              {fields.map((f) => {
                const selected = query.group?.by.includes(f.key)
                return (
                  <button
                    type='button'
                    key={f.key}
                    onClick={() => setQuery((q) => toggleGroupBy(q, f.key))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted/60'
                    }`}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-xs'>Agregações</span>
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Adicionar agregação'
                onClick={() => setQuery((q) => addAggregation(q))}
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              </Button>
            </div>
            {query.group.aggregations.map((agg, i) => {
              const numeric = fields.filter((f) => f.type === 'number')
              return (
                <div key={i} className='flex items-center gap-1.5'>
                  <Select
                    value={agg.fn}
                    onValueChange={(v) =>
                      setQuery((q) =>
                        setAggFn(q, i, v as CrmReportAggregationFn),
                      )
                    }
                  >
                    <SelectTrigger className='h-8 w-28 shrink-0'>
                      <span>{AGG_LABELS[agg.fn]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {CRM_REPORT_AGGREGATION_FNS.map((fn) => (
                        <SelectItem key={fn} value={fn}>
                          {AGG_LABELS[fn]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {agg.fn !== 'count' && (
                    <Select
                      value={agg.field ?? '__none__'}
                      onValueChange={(v) =>
                        setQuery((q) =>
                          setAggField(
                            q,
                            i,
                            v && v !== '__none__' ? v : undefined,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className='h-8 flex-1'>
                        <span>
                          {agg.field
                            ? (numeric.find((f) => f.key === agg.field)
                                ?.label ?? 'campo')
                            : 'campo'}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {numeric.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Input
                    value={agg.alias}
                    placeholder='Rótulo'
                    className='h-8 w-24'
                    onChange={(e) =>
                      setQuery((q) => setAggAlias(q, i, e.target.value))
                    }
                  />
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    aria-label='Remover agregação'
                    onClick={() => setQuery((q) => removeAggregation(q, i))}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Ordenação ------------------------------ */

function SortSection({ query, setQuery }: SectionProps) {
  const cols = outputColumns(query)
  const current = query.sort
  return (
    <div className='flex flex-col gap-1.5'>
      <Label>Ordenar por (opcional)</Label>
      <div className='flex items-center gap-1.5'>
        <Select
          value={current?.field ?? '__none__'}
          onValueChange={(v) =>
            setQuery(
              (q) =>
                ({
                  ...q,
                  sort:
                    v && v !== '__none__'
                      ? { field: v, direction: current?.direction ?? 'asc' }
                      : undefined,
                }) as CrmReportQuery,
            )
          }
        >
          <SelectTrigger className='flex-1'>
            <span>
              {current
                ? (cols.find((c) => c.key === current.field)?.label ??
                  current.field)
                : 'Não ordenar'}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__none__'>Não ordenar</SelectItem>
            {cols.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {current && (
          <Button
            size='sm'
            variant='outline'
            onClick={() =>
              setQuery((q) => ({
                ...q,
                sort: {
                  field: current.field,
                  direction: current.direction === 'asc' ? 'desc' : 'asc',
                },
              }))
            }
          >
            {current.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
          </Button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------ Preview -------------------------------- */

function PreviewSection({
  data,
  loading,
}: {
  data: CrmReportData | null
  loading: boolean
}) {
  return (
    <div className='min-h-0 min-w-0 flex-1 overflow-auto bg-muted/30'>
      <div className='flex flex-col gap-3 p-6'>
        <div className='flex items-center justify-between'>
          <p className='text-muted-foreground text-xs uppercase tracking-wide'>
            Pré-visualização
          </p>
          <p className='text-muted-foreground text-xs tabular-nums'>
            {data?.total ?? 0} registros
          </p>
        </div>

        {loading ? (
          <Skeleton className='h-64 w-full' />
        ) : !data || data.rows.length === 0 ? (
          <p className='rounded-lg border border-dashed bg-card py-16 text-center text-muted-foreground text-sm'>
            Nenhum registro encontrado com esta configuração. Escolha ao menos uma
            coluna e, se houver filtros, afrouxe-os. Se a fonte ainda não tem
            registros, cadastre alguns no CRM e volte aqui.
          </p>
        ) : (
          <div className='overflow-auto rounded-lg border bg-card'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/40 text-muted-foreground text-xs'>
                <tr>
                  {data.columns.map((col) => (
                    <th
                      key={col.key}
                      className='px-3 py-2 text-left font-medium'
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 100).map((row, i) => (
                  <tr key={i} className='border-t'>
                    {data.columns.map((col) => (
                      <td key={col.key} className='px-3 py-1.5'>
                        {formatCell(row[col.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ----------------------------- mutadores -------------------------------- */

function isSavable(query: CrmReportQuery): boolean {
  if (query.mode === 'join') return query.columns.length > 0
  return (
    query.datasets.length >= 2 &&
    query.columns.length > 0 &&
    query.columns.every((c) => Object.keys(c.fields).length > 0)
  )
}

function toJoin(q: CrmReportQuery): CrmJoinQuery {
  if (q.mode === 'join') return q
  const base = q.datasets[0]
  const first = reportFields(base.source)[0]?.key
  return {
    mode: 'join',
    datasets: q.datasets,
    joins: [],
    columns: first ? [`${base.alias}.${first}`] : [],
    group: undefined,
    sort: undefined,
  }
}

function toUnion(q: CrmReportQuery): CrmUnionQuery {
  if (q.mode === 'union') return q
  const base = q.datasets[0]
  const field = reportFields(base.source)[0]
  return {
    mode: 'union',
    datasets: q.datasets,
    columns: field
      ? [
          {
            key: field.key,
            label: field.label,
            fields: { [base.alias]: field.key },
          },
        ]
      : [],
    includeSource: false,
    group: undefined,
    sort: undefined,
  }
}

function removeDataset(q: CrmReportQuery, alias: string): CrmReportQuery {
  const datasets = q.datasets.filter((d) => d.alias !== alias)
  if (q.mode === 'join') {
    return {
      ...q,
      datasets,
      joins: q.joins.filter(
        (j) => j.leftAlias !== alias && j.rightAlias !== alias,
      ),
      columns: q.columns.filter((c) => !c.startsWith(`${alias}.`)),
    }
  }
  return {
    ...q,
    datasets,
    columns: q.columns.map((c) => {
      const { [alias]: _drop, ...rest } = c.fields
      return { ...c, fields: rest }
    }),
  }
}

function addJoinDataset(q: CrmJoinQuery, rel: AvailableRelation): CrmJoinQuery {
  const alias = makeAlias(rel.to, new Set(q.datasets.map((d) => d.alias)))
  return {
    ...q,
    datasets: [...q.datasets, { alias, source: rel.to, filters: [] }],
    joins: [
      ...q.joins,
      {
        leftAlias: rel.fromAlias,
        rightAlias: alias,
        leftField: rel.field,
        rightField: rel.toField,
        type: 'left',
      },
    ],
  }
}

function addUnionDataset(
  q: CrmUnionQuery,
  source: CrmReportSource,
): CrmUnionQuery {
  const alias = makeAlias(source, new Set(q.datasets.map((d) => d.alias)))
  return { ...q, datasets: [...q.datasets, { alias, source, filters: [] }] }
}

function toggleJoinColumn(q: CrmJoinQuery, key: string): CrmJoinQuery {
  return {
    ...q,
    columns: q.columns.includes(key)
      ? q.columns.filter((c) => c !== key)
      : [...q.columns, key],
  }
}

function addUnionColumn(q: CrmUnionQuery): CrmUnionQuery {
  return {
    ...q,
    columns: [
      ...q.columns,
      { key: `col_${q.columns.length + 1}`, label: 'Nova coluna', fields: {} },
    ],
  }
}

function removeUnionColumn(q: CrmUnionQuery, i: number): CrmUnionQuery {
  return { ...q, columns: q.columns.filter((_, idx) => idx !== i) }
}

function updateUnionColumnLabel(
  q: CrmUnionQuery,
  i: number,
  label: string,
): CrmUnionQuery {
  const key =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || `col_${i + 1}`
  return {
    ...q,
    columns: q.columns.map((c, idx) => (idx === i ? { ...c, label, key } : c)),
  }
}

function setUnionColumnField(
  q: CrmUnionQuery,
  i: number,
  alias: string,
  field: string | null,
): CrmUnionQuery {
  return {
    ...q,
    columns: q.columns.map((c, idx) => {
      if (idx !== i) return c
      const fields = { ...c.fields }
      if (field) fields[alias] = field
      else delete fields[alias]
      return { ...c, fields }
    }),
  }
}

function withGroup(
  q: CrmReportQuery,
  fn: (
    g: NonNullable<CrmReportQuery['group']>,
  ) => NonNullable<CrmReportQuery['group']>,
): CrmReportQuery {
  if (!q.group) return q
  return { ...q, group: fn(q.group) } as CrmReportQuery
}

function toggleGroupBy(q: CrmReportQuery, key: string): CrmReportQuery {
  return withGroup(q, (g) => ({
    ...g,
    by: g.by.includes(key) ? g.by.filter((k) => k !== key) : [...g.by, key],
  }))
}

function addAggregation(q: CrmReportQuery): CrmReportQuery {
  return withGroup(q, (g) => ({
    ...g,
    aggregations: [
      ...g.aggregations,
      { fn: 'count', alias: `Agg ${g.aggregations.length + 1}` },
    ],
  }))
}

function removeAggregation(q: CrmReportQuery, i: number): CrmReportQuery {
  return withGroup(q, (g) => ({
    ...g,
    aggregations: g.aggregations.filter((_, idx) => idx !== i),
  }))
}

function setAggFn(
  q: CrmReportQuery,
  i: number,
  fn: CrmReportAggregationFn,
): CrmReportQuery {
  return withGroup(q, (g) => ({
    ...g,
    aggregations: g.aggregations.map((a, idx) =>
      idx === i ? { ...a, fn } : a,
    ),
  }))
}

function setAggField(
  q: CrmReportQuery,
  i: number,
  field: string | undefined,
): CrmReportQuery {
  return withGroup(q, (g) => ({
    ...g,
    aggregations: g.aggregations.map((a, idx) =>
      idx === i ? { ...a, field } : a,
    ),
  }))
}

function setAggAlias(
  q: CrmReportQuery,
  i: number,
  alias: string,
): CrmReportQuery {
  return withGroup(q, (g) => ({
    ...g,
    aggregations: g.aggregations.map((a, idx) =>
      idx === i ? { ...a, alias } : a,
    ),
  }))
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

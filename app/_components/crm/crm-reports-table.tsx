'use client'

import { Add01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  CRM_REPORT_FIELDS,
  CRM_REPORT_SOURCE_LABELS,
} from '@/src/config/crm-report-fields'
import { useCreateCrmReport, useCrmReports } from '@/src/hooks/use-crm-report'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import {
  CRM_REPORT_SOURCES,
  type CrmReportSource,
} from '@/src/schemas/crm-report.schema'
import type { CrmReportDTO } from '@/types/crm-report'

const LOOKUP_KINDS: LookupKind[] = ['users']

const SOURCE_STYLES: Record<CrmReportSource, string> = {
  company: 'bg-blue-500/15 text-blue-600',
  person: 'bg-emerald-500/15 text-emerald-600',
  opportunity: 'bg-violet-500/15 text-violet-600',
  lead: 'bg-amber-500/15 text-amber-600',
  task: 'bg-sky-500/15 text-sky-600',
  note: 'bg-rose-500/15 text-rose-600',
  product: 'bg-teal-500/15 text-teal-600',
  whatsapp_conversation: 'bg-green-500/15 text-green-600',
  whatsapp_ai_campaign: 'bg-cyan-500/15 text-cyan-600',
  whatsapp_broadcast: 'bg-lime-500/15 text-lime-600',
}

/** Ready-made reports: pick one and the builder opens already filled. */
const REPORT_PRESETS: {
  key: string
  name: string
  description: string
  source: CrmReportSource
  columns: string[]
}[] = [
  {
    key: 'leads',
    name: 'Lista de leads',
    description: 'Todos os leads com origem, status e pontuação.',
    source: 'lead',
    columns: ['name', 'emails', 'company', 'source', 'status', 'score'],
  },
  {
    key: 'opportunities',
    name: 'Oportunidades e valores',
    description: 'Oportunidades com valor, origem e data de fechamento.',
    source: 'opportunity',
    columns: ['name', 'amount', 'source', 'closeDate'],
  },
  {
    key: 'people-by-city',
    name: 'Contatos por cidade',
    description: 'Pessoas com e-mail, telefone e cidade.',
    source: 'person',
    columns: ['name', 'emails', 'phones', 'city'],
  },
  {
    key: 'tasks',
    name: 'Tarefas e prazos',
    description: 'Tarefas com status e data de vencimento.',
    source: 'task',
    columns: ['title', 'status', 'dueDate'],
  },
]

const COLUMNS: GridColumn[] = [
  {
    key: 'name',
    header: 'Nome',
    kind: 'text',
    primary: true,
    readonly: true,
    linkView: true,
    placeholder: 'Oportunidades por origem',
  },
  {
    key: 'source',
    header: 'Fonte',
    kind: 'select',
    readonly: true,
    options: CRM_REPORT_SOURCES.map((s) => ({
      value: s,
      label: CRM_REPORT_SOURCE_LABELS[s],
    })),
    optionStyles: SOURCE_STYLES,
  },
  {
    key: 'createdById',
    header: 'Criado por',
    kind: 'relation',
    relationKind: 'users',
    readonly: true,
  },
  { key: 'createdAt', header: 'Criado em', kind: 'readonly-date' },
  { key: 'updatedAt', header: 'Última atualização', kind: 'readonly-date' },
]

export function CrmReportsTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const { data: reports, isLoading, refetch } = useCrmReports(workspaceId)
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const columns = React.useMemo(() => COLUMNS, [])

  return (
    <DataTable
      columns={columns}
      data={reports ?? []}
      workspaceId={workspaceId}
      slug={slug}
      resource='reports'
      createTitle='relatório'
      lookups={lookups}
      isLoading={isLoading}
      searchPlaceholder='Buscar relatórios…'
      refetch={refetch}
      disableInlineCreate
      headerAction={
        <CreateCrmReportDialog workspaceId={workspaceId} slug={slug} />
      }
      onOpenRecord={(record: CrmReportDTO) =>
        router.push(`/${slug}/crm/reports/${record.id}`)
      }
    />
  )
}

/** Dialog de criação: define nome e fonte (imutável) e abre o construtor. */
function CreateCrmReportDialog({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [source, setSource] = React.useState<CrmReportSource>('company')
  const [presetKey, setPresetKey] = React.useState<string | null>(null)
  const createReport = useCreateCrmReport(workspaceId)
  const preset = REPORT_PRESETS.find((p) => p.key === presetKey)

  function reset() {
    setName('')
    setSource('company')
    setPresetKey(null)
  }

  function pickPreset(key: string) {
    const next = REPORT_PRESETS.find((p) => p.key === key)
    if (!next) return
    setPresetKey(key)
    setSource(next.source)
    setName((cur) => cur.trim() || next.name)
  }

  async function handleCreate() {
    if (!name.trim()) {
      notify.error('Informe o nome do relatório.')
      return
    }
    try {
      const created = await createReport.mutateAsync({
        name: name.trim(),
        source,
        // Começa com a primeira coluna da fonte; o usuário ajusta no construtor.
        columns:
          preset && preset.source === source
            ? preset.columns
            : [CRM_REPORT_FIELDS[source][0].key],
      })
      setOpen(false)
      router.push(`/${slug}/crm/reports/${created.id}`)
    } catch (err) {
      notify.error(err, 'Não foi possível criar o relatório.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button size='sm' data-tour='crm-reports-new'>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Novo relatório
          </Button>
        }
      />
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Novo relatório</DialogTitle>
          <DialogDescription>
            Escolha a fonte de dados. As colunas e filtros você define em
            seguida no construtor.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label>Comece por um relatório pronto (opcional)</Label>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
              {REPORT_PRESETS.map((item) => (
                <button
                  key={item.key}
                  type='button'
                  aria-pressed={presetKey === item.key}
                  onClick={() => pickPreset(item.key)}
                  className={`flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors ${
                    presetKey === item.key
                      ? 'border-primary bg-primary/10'
                      : 'hover:bg-muted/60'
                  }`}
                >
                  <span className='font-medium text-sm'>{item.name}</span>
                  <span className='text-muted-foreground text-xs'>
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='report-name'>Nome</Label>
            <Input
              id='report-name'
              value={name}
              placeholder='Oportunidades por origem'
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label>Fonte</Label>
            <Select
              value={source}
              onValueChange={(v) => {
                setSource(v as CrmReportSource)
                setPresetKey(null)
              }}
            >
              <SelectTrigger className='w-full'>
                <span>{CRM_REPORT_SOURCE_LABELS[source]}</span>
              </SelectTrigger>
              <SelectContent>
                {CRM_REPORT_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CRM_REPORT_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              A fonte não pode ser alterada depois de criada.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='outline' />}>
            Cancelar
          </DialogClose>
          <Button onClick={handleCreate} disabled={createReport.isPending}>
            {createReport.isPending ? 'Criando…' : 'Criar e abrir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

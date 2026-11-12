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
  const createReport = useCreateCrmReport(workspaceId)

  function reset() {
    setName('')
    setSource('company')
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
        columns: [CRM_REPORT_FIELDS[source][0].key],
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
          <Button size='sm'>
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
              onValueChange={(v) => setSource(v as CrmReportSource)}
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

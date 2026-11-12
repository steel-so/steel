'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  CRM_REPORT_FIELDS,
  CRM_REPORT_SOURCE_LABELS,
} from '@/src/config/crm-report-fields'
import {
  useCreateCrmReport,
  useCrmReports,
  useDeleteCrmReport,
} from '@/src/hooks/use-crm-report'
import type { CrmReportSource } from '@/src/schemas/crm-report.schema'

const WHATSAPP_REPORT_SOURCES: CrmReportSource[] = [
  'whatsapp_conversation',
  'whatsapp_ai_campaign',
  'whatsapp_broadcast',
]

export function WhatsappReportsList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const { data: reports, isLoading } = useCrmReports(workspaceId, 'whatsapp')
  const createReport = useCreateCrmReport(workspaceId, 'whatsapp')
  const deleteReport = useDeleteCrmReport(workspaceId, 'whatsapp')

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [source, setSource] = useState<CrmReportSource>('whatsapp_conversation')

  async function handleCreate() {
    if (!name.trim()) {
      notify.error('Informe o nome do relatório.')
      return
    }
    try {
      const created = await createReport.mutateAsync({
        name: name.trim(),
        source,
        columns: [CRM_REPORT_FIELDS[source][0].key],
      })
      setOpen(false)
      setName('')
      router.push(`/${slug}/zap/reports/${created.id}`)
    } catch (err) {
      notify.error(err, 'Não foi possível criar o relatório.')
    }
  }

  async function handleDelete(reportId: string) {
    try {
      await deleteReport.mutateAsync(reportId)
    } catch (err) {
      notify.error(err, 'Não foi possível remover o relatório.')
    }
  }

  return (
    <div className='space-y-4 p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='font-medium text-sm'>Relatórios</h3>
          <p className='text-muted-foreground text-xs'>
            Relatórios sobre conversas e transmissões do WhatsApp
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button size='sm'>
                <SteelIcon icon={Add01Icon} strokeWidth={2} />
                Novo relatório
              </Button>
            }
          />
          <DialogContent className='max-w-sm'>
            <DialogHeader>
              <DialogTitle>Novo relatório</DialogTitle>
            </DialogHeader>
            <div className='space-y-3'>
              <div className='space-y-1.5'>
                <Label htmlFor='reportName'>Nome</Label>
                <Input
                  id='reportName'
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='reportSource'>Fonte</Label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as CrmReportSource)}
                >
                  <SelectTrigger id='reportSource' className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {WHATSAPP_REPORT_SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {CRM_REPORT_SOURCE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  type='button'
                  disabled={createReport.isPending}
                  onClick={handleCreate}
                >
                  {createReport.isPending ? 'Criando...' : 'Criar relatório'}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className='divide-y rounded-md border'>
        {(reports ?? []).map((report) => (
          <div
            key={report.id}
            className='flex items-center justify-between gap-2 px-4 py-3'
          >
            <button
              type='button'
              className='flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline'
              onClick={() => router.push(`/${slug}/zap/reports/${report.id}`)}
            >
              <span className='truncate'>{report.name}</span>
              <Badge variant='outline' className='shrink-0'>
                {CRM_REPORT_SOURCE_LABELS[report.source as CrmReportSource] ??
                  report.source}
              </Badge>
            </button>
            <Button
              size='icon-xs'
              variant='ghost'
              aria-label='Remover relatório'
              onClick={() => handleDelete(report.id)}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
        ))}
        {!isLoading && (reports ?? []).length === 0 && (
          <p className='px-4 py-6 text-center text-muted-foreground text-sm'>
            Nenhum relatório criado ainda.
          </p>
        )}
      </div>
    </div>
  )
}

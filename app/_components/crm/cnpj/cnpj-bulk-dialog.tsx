'use client'

import { Database01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  LIVE_CNPJ_RUN_STATUSES,
  useCrmCnpjRuns,
  useStartCnpjRun,
} from '@/src/hooks/use-crm-cnpj-enrichment'
import {
  formatMoment,
  RUN_STATUS_LABELS,
  RUN_STATUS_VARIANT,
} from './cnpj-labels'

/**
 * "Enriquecer base": re-enriches every company that has a CNPJ in the
 * worker, with the progress of the latest runs below the options.
 */
export function CnpjBulkDialog({
  workspaceId,
  onFinished,
}: {
  workspaceId: string
  /** Reloads the company list when the dialog closes (names may change). */
  onFinished: () => void
}) {
  const [open, setOpen] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const runs = useCrmCnpjRuns(workspaceId, open)
  const start = useStartCnpjRun(workspaceId)
  const live = runs.data?.some((run) =>
    LIVE_CNPJ_RUN_STATUSES.includes(run.status),
  )

  function submit() {
    start.mutate(
      { onlyMissing, overwrite },
      {
        onSuccess: (run) =>
          notify.success(
            run.total === 0
              ? 'Nenhuma empresa com CNPJ para consultar'
              : `Consulta iniciada para ${run.total} empresa${run.total === 1 ? '' : 's'}`,
          ),
        onError: (error) => notify.error(error.message),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onFinished()
      }}
    >
      <DialogTrigger render={<Button size='sm' variant='outline' />}>
        <SteelIcon icon={Database01Icon} strokeWidth={2} />
        Enriquecer base
      </DialogTrigger>
      <DialogContent className='flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl flex-col gap-4 overflow-y-auto p-4 sm:p-6'>
        <DialogHeader>
          <DialogTitle>Enriquecer a base pelo CNPJ</DialogTitle>
          <DialogDescription>
            Consulta a Receita Federal de cada empresa que tem CNPJ e guarda
            razão social, CNAE, porte e sócios. Roda em segundo plano, cerca de
            uma empresa por segundo.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-3'>
          <div className='flex items-start gap-2'>
            <Switch
              id='cnpj-only-missing'
              checked={onlyMissing}
              onCheckedChange={setOnlyMissing}
            />
            <Label
              htmlFor='cnpj-only-missing'
              className='flex flex-col gap-0.5'
            >
              <span>Só empresas ainda não consultadas</span>
              <span className='font-normal text-muted-foreground text-xs'>
                Desligue para atualizar também as que já têm dados da Receita.
              </span>
            </Label>
          </div>
          <div className='flex items-start gap-2'>
            <Switch
              id='cnpj-bulk-overwrite'
              checked={overwrite}
              onCheckedChange={setOverwrite}
            />
            <Label
              htmlFor='cnpj-bulk-overwrite'
              className='flex flex-col gap-0.5'
            >
              <span>Substituir nome e endereço já preenchidos</span>
              <span className='font-normal text-muted-foreground text-xs'>
                Por padrão, só completa o que está em branco.
              </span>
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={start.isPending || live}>
            {live ? 'Consulta em andamento…' : 'Iniciar consulta'}
          </Button>
        </DialogFooter>

        {runs.data && runs.data.length > 0 ? (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Início</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className='text-right'>Progresso</TableHead>
                  <TableHead className='text-right'>Atualizadas</TableHead>
                  <TableHead className='text-right'>Sem registro</TableHead>
                  <TableHead className='text-right'>Falhas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.data.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className='whitespace-nowrap'>
                      {formatMoment(run.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-col gap-1'>
                        <Badge variant={RUN_STATUS_VARIANT[run.status]}>
                          {RUN_STATUS_LABELS[run.status]}
                        </Badge>
                        {run.error ? (
                          <span className='max-w-48 break-words text-destructive text-xs'>
                            {run.error}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {run.processed} / {run.total}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {run.enriched}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {run.notFound + run.invalid}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {run.failed}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

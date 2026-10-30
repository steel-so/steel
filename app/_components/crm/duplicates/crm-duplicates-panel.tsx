'use client'

import { GitMergeIcon, Search01Icon, Undo02Icon } from '@hugeicons-pro/core-stroke-rounded'
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
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  useCrmDuplicates,
  useCrmMerges,
  useDismissCrmDuplicate,
  useMergeCrmDuplicate,
  useScanCrmDuplicates,
  useUndoCrmMerge,
} from '@/src/hooks/use-crm-duplicates'
import type {
  CrmDuplicateDTO,
  CrmDuplicateEntity,
  CrmDuplicateRecordDTO,
} from '@/types/crm-duplicate'
import {
  ENTITY_LABEL,
  formatDate,
  formatDateTime,
  REASON_LABEL,
  recordFields,
} from './duplicate-labels'

function RecordColumn({
  entity,
  record,
  onKeep,
  disabled,
}: {
  entity: CrmDuplicateEntity
  record: CrmDuplicateRecordDTO
  onKeep: () => void
  disabled: boolean
}) {
  return (
    <div className='flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-card p-3'>
      <div className='min-w-0'>
        <p className='truncate font-medium'>{record.name}</p>
        <p className='text-muted-foreground text-xs'>
          Criado em {formatDate(record.createdAt)} · {record.historyCount}{' '}
          {record.historyCount === 1 ? 'item de histórico' : 'itens de histórico'}
        </p>
      </div>
      <dl className='grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-sm'>
        {recordFields(entity, record).map((field) => (
          <div key={field.label} className='contents'>
            <dt className='text-muted-foreground'>{field.label}</dt>
            <dd className='min-w-0 break-words'>{field.value}</dd>
          </div>
        ))}
      </dl>
      <Button
        variant='outline'
        size='sm'
        className='mt-auto self-start'
        onClick={onKeep}
        disabled={disabled}
      >
        Manter este
      </Button>
    </div>
  )
}

function PairCard({
  pair,
  busy,
  onKeep,
  onDismiss,
}: {
  pair: CrmDuplicateDTO
  busy: boolean
  onKeep: (survivor: CrmDuplicateRecordDTO, merged: CrmDuplicateRecordDTO) => void
  onDismiss: () => void
}) {
  return (
    <li className='flex flex-col gap-3 rounded-xl border p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant={pair.score >= 85 ? 'default' : 'secondary'}>
          {pair.score}% de chance
        </Badge>
        {pair.reasons.map((reason) => (
          <Badge key={reason} variant='outline'>
            {REASON_LABEL[reason]}
          </Badge>
        ))}
        <Button
          variant='ghost'
          size='sm'
          className='ml-auto'
          onClick={onDismiss}
          disabled={busy}
        >
          Não são duplicados
        </Button>
      </div>
      <div className='flex flex-col gap-3 md:flex-row'>
        <RecordColumn
          entity={pair.entity}
          record={pair.left}
          disabled={busy}
          onKeep={() => onKeep(pair.left, pair.right)}
        />
        <RecordColumn
          entity={pair.entity}
          record={pair.right}
          disabled={busy}
          onKeep={() => onKeep(pair.right, pair.left)}
        />
      </div>
    </li>
  )
}

/** "Duplicados" page: review queue of people and companies, merge and undo. */
export function CrmDuplicatesPanel({ workspaceId }: { workspaceId: string }) {
  const [entity, setEntity] = useState<CrmDuplicateEntity>('PERSON')
  const [page, setPage] = useState(1)
  const [pending, setPending] = useState<{
    candidateId: string
    survivor: CrmDuplicateRecordDTO
    merged: CrmDuplicateRecordDTO
  } | null>(null)

  const queue = useCrmDuplicates(workspaceId, entity, 'PENDING', page)
  const merges = useCrmMerges(workspaceId, entity)
  const scan = useScanCrmDuplicates(workspaceId)
  const merge = useMergeCrmDuplicate(workspaceId)
  const dismiss = useDismissCrmDuplicate(workspaceId)
  const undo = useUndoCrmMerge(workspaceId)

  const busy = merge.isPending || dismiss.isPending
  const label = ENTITY_LABEL[entity]
  const totalPages = queue.data
    ? Math.max(1, Math.ceil(queue.data.total / queue.data.pageSize))
    : 1

  function runScan() {
    scan.mutate(undefined, {
      onSuccess: (result) => {
        const created = result.person.created + result.company.created
        notify.success(
          created > 0
            ? `${created} ${created === 1 ? 'novo par encontrado' : 'novos pares encontrados'}`
            : 'Nenhum par novo encontrado',
        )
      },
      onError: (error) => notify.error(error),
    })
  }

  function confirmMerge() {
    if (!pending) return
    merge.mutate(
      { candidateId: pending.candidateId, survivorId: pending.survivor.id },
      {
        onSuccess: () => {
          setPending(null)
          notify.success(
            'Mesclado. Você pode desfazer em "Mesclagens recentes" por 24 horas.',
          )
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  function undoMerge(mergeId: string) {
    undo.mutate(mergeId, {
      onSuccess: () => notify.success('Mesclagem desfeita'),
      onError: (error) => notify.error(error),
    })
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='max-w-2xl text-muted-foreground text-sm'>
          O Steel procura todo dia pessoas e empresas repetidas (nome parecido,
          mesmo telefone, e-mail, CNPJ ou domínio) e também confere cada
          cadastro novo. Mesclar mantém um registro e leva para ele as notas,
          tarefas, oportunidades e atividades do outro.
        </p>
        <Button onClick={runScan} disabled={scan.isPending}>
          <SteelIcon icon={Search01Icon} />
          {scan.isPending ? 'Procurando…' : 'Procurar duplicados'}
        </Button>
      </div>

      <Tabs
        value={entity}
        onValueChange={(value) => {
          setEntity(value as CrmDuplicateEntity)
          setPage(1)
        }}
      >
        <TabsList>
          <TabsTrigger value='PERSON'>
            Pessoas
            {queue.data ? ` (${queue.data.pending.person})` : ''}
          </TabsTrigger>
          <TabsTrigger value='COMPANY'>
            Empresas
            {queue.data ? ` (${queue.data.pending.company})` : ''}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {queue.isLoading ? (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-48' />
          <Skeleton className='h-48' />
        </div>
      ) : queue.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar a fila de duplicados.
        </p>
      ) : (queue.data?.items ?? []).length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center'>
          <SteelIcon icon={GitMergeIcon} className='text-muted-foreground' />
          <p className='font-medium'>Nenhum duplicado para revisar</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Quando o Steel encontrar {label.plural} repetidas, os pares aparecem
            aqui. Use “Procurar duplicados” para conferir agora.
          </p>
        </div>
      ) : (
        <ul className='flex flex-col gap-3'>
          {queue.data?.items.map((pair) => (
            <PairCard
              key={pair.id}
              pair={pair}
              busy={busy}
              onKeep={(survivor, merged) =>
                setPending({ candidateId: pair.id, survivor, merged })
              }
              onDismiss={() =>
                dismiss.mutate(pair.id, {
                  onSuccess: () => notify.success('Par descartado'),
                  onError: (error) => notify.error(error),
                })
              }
            />
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className='flex items-center justify-center gap-3 text-sm'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Anterior
          </Button>
          <span className='text-muted-foreground'>
            Página {page} de {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Próxima
          </Button>
        </div>
      ) : null}

      <section className='flex flex-col gap-2' aria-label='Mesclagens recentes'>
        <h2 className='font-medium text-sm'>Mesclagens recentes</h2>
        {(merges.data ?? []).length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhuma mesclagem de {label.plural} ainda.
          </p>
        ) : (
          <ul className='flex flex-col divide-y rounded-lg border'>
            {merges.data?.map((item) => (
              <li
                key={item.id}
                className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
              >
                <span className='min-w-0 flex-1 break-words'>
                  “{item.mergedName}” foi mesclado em “{item.survivorName}”
                  <span className='text-muted-foreground'>
                    {' '}
                    · {formatDateTime(item.createdAt)}
                  </span>
                </span>
                {item.undoneAt ? (
                  <Badge variant='outline'>Desfeita</Badge>
                ) : item.canUndo ? (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => undoMerge(item.id)}
                    disabled={undo.isPending}
                  >
                    <SteelIcon icon={Undo02Icon} />
                    Desfazer
                  </Button>
                ) : (
                  <Badge variant='secondary'>Prazo encerrado</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mesclar {label.plural}</DialogTitle>
            <DialogDescription>
              Manter “{pending?.survivor.name}” e arquivar “{pending?.merged.name}
              ”. As notas, tarefas, oportunidades e atividades de “
              {pending?.merged.name}” passam para “{pending?.survivor.name}”, que
              também ganha o que faltava nele. Dá para desfazer por 24 horas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmMerge} disabled={merge.isPending}>
              {merge.isPending ? 'Mesclando…' : 'Mesclar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

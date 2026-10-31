'use client'

import Link from 'next/link'
import { useAdminOperations } from '@/src/hooks/use-admin'
import type { AdminOperationDTO } from '@/types/admin-workspace'
import { OPERATION_STEP_LABEL } from '../shell/admin-labels'
import {
  AdminPanel,
  EmptyState,
  ErrorState,
  formatDateTime,
  MonoId,
  OperationStatusPill,
  TableSkeleton,
} from '../shell/admin-ui'

const KIND_LABEL: Record<AdminOperationDTO['kind'], string> = {
  WORKSPACE_DELETE: 'Exclusão',
  WORKSPACE_RESTORE: 'Restauração',
}

const DELETE_STEPS = ['backup', 'purge_database', 'purge_files', 'done']
const RESTORE_STEPS = ['safety_backup', 'restore', 'restore_files', 'done']

/** Barra de passos: concluídos, atual (pulsa) e pendentes. */
function StepBar({ operation }: { operation: AdminOperationDTO }) {
  const steps =
    operation.kind === 'WORKSPACE_DELETE' ? DELETE_STEPS : RESTORE_STEPS
  const current = steps.indexOf(operation.step)
  const failed = operation.status === 'FAILED'
  return (
    <ol
      className='flex gap-1'
      aria-label={`Passo: ${OPERATION_STEP_LABEL[operation.step] ?? operation.step}`}
    >
      {steps.map((step, index) => {
        const done =
          operation.status === 'COMPLETED' || (current > index && !failed)
        const active = index === current && operation.status === 'RUNNING'
        return (
          <li
            key={step}
            title={OPERATION_STEP_LABEL[step]}
            className={
              done
                ? 'h-1 flex-1 rounded-full bg-emerald-500'
                : active
                  ? 'h-1 flex-1 animate-pulse rounded-full bg-sky-500'
                  : failed && index === Math.max(current, 0)
                    ? 'h-1 flex-1 rounded-full bg-destructive'
                    : 'h-1 flex-1 rounded-full bg-muted'
            }
          />
        )
      })}
    </ol>
  )
}

export function OperationRow({ operation }: { operation: AdminOperationDTO }) {
  return (
    <li className='space-y-2 px-4 py-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='min-w-0 truncate text-sm'>
          {KIND_LABEL[operation.kind]} de{' '}
          {operation.status === 'COMPLETED' &&
          operation.kind === 'WORKSPACE_DELETE' ? (
            <span className='font-mono'>{operation.workspaceSlug}</span>
          ) : (
            <Link
              href={`/admin/workspaces/${operation.workspaceId}`}
              className='font-mono hover:underline'
            >
              {operation.workspaceSlug}
            </Link>
          )}
        </p>
        <OperationStatusPill status={operation.status} />
      </div>
      <StepBar operation={operation} />
      <div className='flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground'>
        <span>{OPERATION_STEP_LABEL[operation.step] ?? operation.step}</span>
        <span>{operation.requestedByEmail}</span>
        <span className='font-mono'>{formatDateTime(operation.createdAt)}</span>
        {operation.backupId && (
          <span className='max-w-48'>
            backup <MonoId value={operation.backupId} />
          </span>
        )}
      </div>
      {operation.error && (
        <p className='wrap-break-word text-destructive text-xs'>
          {operation.error}
        </p>
      )}
      {operation.filesError && (
        <p className='text-amber-700 text-xs dark:text-amber-400'>
          {operation.kind === 'WORKSPACE_DELETE'
            ? 'Arquivos não apagados por completo'
            : 'Arquivos não restaurados (dados ok; rode pnpm restore:workspace --files-only)'}
          : {operation.filesError}
        </p>
      )}
      {operation.subscriptionsToCancel.length > 0 && (
        <p className='text-amber-700 text-xs dark:text-amber-400'>
          Cancele no AbacatePay (o cancelamento automático não foi feito):{' '}
          <span className='font-mono'>
            {operation.subscriptionsToCancel.map((s) => s.billId).join(', ')}
          </span>
        </p>
      )}
    </li>
  )
}

/** Exclusões e restaurações (polling enquanto houver alguma ativa). */
export function AdminOperationsList({
  workspaceId,
  title = 'Exclusões e restaurações',
  hideWhenEmpty = false,
}: {
  workspaceId?: string
  title?: string
  hideWhenEmpty?: boolean
}) {
  const { data, isLoading, isError } = useAdminOperations(workspaceId)

  if (hideWhenEmpty && !isLoading && !isError && data?.length === 0) {
    return null
  }

  return (
    <AdminPanel title={title} flush>
      {isLoading ? (
        <TableSkeleton rows={2} />
      ) : isError || !data ? (
        <div className='p-4'>
          <ErrorState message='Não foi possível carregar as operações.' />
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          title='Nenhuma operação'
          description='Exclusões e restaurações pedidas pelo painel aparecem aqui com o progresso.'
        />
      ) : (
        <ul className='divide-y'>
          {data.map((operation) => (
            <OperationRow key={operation.id} operation={operation} />
          ))}
        </ul>
      )}
    </AdminPanel>
  )
}

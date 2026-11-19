'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
  useDeletePlatformFlag,
  useUpdatePlatformFlag,
} from '@/src/hooks/use-platform-flags'
import type { PlatformFlagDTO } from '@/types/platform-flag'
import { DENSE_TABLE, EmptyState } from '../shell/admin-ui'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'

/** Tabela de flags: interruptor global, editar, liberar por workspace, excluir. */
export function PlatformFlagsTable({
  flags,
  onEdit,
  onGrants,
}: {
  flags: PlatformFlagDTO[]
  onEdit: (flag: PlatformFlagDTO) => void
  onGrants: (flag: PlatformFlagDTO) => void
}) {
  const update = useUpdatePlatformFlag()
  const remove = useDeletePlatformFlag()
  const [toDelete, setToDelete] = useState<PlatformFlagDTO | null>(null)

  async function toggle(flag: PlatformFlagDTO, enabled: boolean) {
    try {
      await update.mutateAsync({ id: flag.id, enabled })
    } catch (error) {
      notify.error(error)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      notify.success('Flag excluída')
      setToDelete(null)
    } catch (error) {
      notify.error(error)
    }
  }

  if (flags.length === 0) {
    return (
      <EmptyState
        title='Nenhuma feature flag ainda'
        description='Crie a primeira para liberar uma funcionalidade aos poucos.'
      />
    )
  }

  return (
    <>
      <Table className={DENSE_TABLE}>
        <TableHeader>
          <TableRow>
            <TableHead>Flag</TableHead>
            <TableHead>Todos</TableHead>
            <TableHead>Beta</TableHead>
            <TableHead>Workspaces</TableHead>
            <TableHead className='text-right'>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flags.map((flag) => (
            <TableRow key={flag.id}>
              <TableCell>
                <p className='font-medium'>{flag.name}</p>
                <p className='font-mono text-muted-foreground'>{flag.key}</p>
                {flag.description && (
                  <p className='text-muted-foreground'>{flag.description}</p>
                )}
              </TableCell>
              <TableCell>
                <Switch
                  aria-label={`Ligar ${flag.name} para todos`}
                  checked={flag.enabled}
                  disabled={update.isPending}
                  onCheckedChange={(value) => toggle(flag, value)}
                />
              </TableCell>
              <TableCell>
                <Switch
                  aria-label={`Ligar ${flag.name} para beta`}
                  checked={flag.betaEnabled}
                  disabled={update.isPending}
                  onCheckedChange={(value) =>
                    update
                      .mutateAsync({ id: flag.id, betaEnabled: value })
                      .catch((error) => notify.error(error))
                  }
                />
              </TableCell>
              <TableCell>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => onGrants(flag)}
                >
                  {flag.workspaceCount === 0
                    ? 'Liberar'
                    : `${flag.workspaceCount} liberado${flag.workspaceCount > 1 ? 's' : ''}`}
                </Button>
              </TableCell>
              <TableCell className='text-right'>
                <div className='flex justify-end gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => onEdit(flag)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-destructive'
                    onClick={() => setToDelete(flag)}
                  >
                    Excluir
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ConfirmDeleteDialog
        flag={toDelete}
        pending={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  )
}

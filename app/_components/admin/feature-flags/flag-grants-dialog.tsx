'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useAdminFlagWorkspaces,
  useSetFlagWorkspace,
} from '@/src/hooks/use-platform-flags'
import type { PlatformFlagDTO } from '@/types/platform-flag'
import { EmptyState, ErrorState, TableSkeleton } from '../shell/admin-ui'

/** Libera a flag para workspaces específicos (independe do global e do beta). */
export function FlagGrantsDialog({
  flag,
  onOpenChange,
}: {
  flag: PlatformFlagDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const workspaces = useAdminFlagWorkspaces(search.trim(), flag?.id)
  const setGrant = useSetFlagWorkspace(flag?.id ?? '')

  async function toggle(workspaceId: string, granted: boolean) {
    try {
      await setGrant.mutateAsync({ workspaceId, granted })
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Dialog open={flag !== null} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Liberar por workspace</DialogTitle>
          <DialogDescription>
            Workspaces com acesso explícito a{' '}
            <code className='font-mono text-xs'>{flag?.key}</code>.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          placeholder='Buscar por nome ou slug'
          aria-label='Buscar workspace'
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className='max-h-72 overflow-y-auto rounded-md border border-border'>
          {workspaces.isLoading ? (
            <TableSkeleton rows={4} />
          ) : workspaces.isError ? (
            <ErrorState message='Não foi possível carregar os workspaces.' />
          ) : !workspaces.data?.length ? (
            <EmptyState title='Nenhum workspace encontrado' />
          ) : (
            <ul className='divide-y'>
              {workspaces.data.map((ws) => (
                <li
                  key={ws.id}
                  className='flex items-center justify-between gap-3 px-3 py-2'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm'>{ws.name}</p>
                    <p className='font-mono text-muted-foreground text-xs'>
                      {ws.slug}
                    </p>
                  </div>
                  <Switch
                    aria-label={`Liberar para ${ws.name}`}
                    checked={ws.granted ?? false}
                    disabled={setGrant.isPending}
                    onCheckedChange={(value) => toggle(ws.id, value)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

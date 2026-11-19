'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useAdminFlagWorkspaces,
  useSetWorkspaceBeta,
} from '@/src/hooks/use-platform-flags'
import { EmptyState, ErrorState, TableSkeleton } from '../shell/admin-ui'

/** Workspaces beta: busca por nome/slug e interruptor de beta. */
export function BetaWorkspacesPanel() {
  const [search, setSearch] = useState('')
  const workspaces = useAdminFlagWorkspaces(search.trim())
  const setBeta = useSetWorkspaceBeta()

  async function toggle(workspaceId: string, beta: boolean) {
    try {
      await setBeta.mutateAsync({ workspaceId, beta })
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='space-y-3'>
      <Input
        value={search}
        placeholder='Buscar workspace por nome ou slug'
        aria-label='Buscar workspace'
        className='max-w-sm'
        onChange={(e) => setSearch(e.target.value)}
      />
      {workspaces.isLoading ? (
        <TableSkeleton />
      ) : workspaces.isError ? (
        <ErrorState message='Não foi possível carregar os workspaces.' />
      ) : !workspaces.data?.length ? (
        <EmptyState title='Nenhum workspace encontrado' />
      ) : (
        <ul className='divide-y rounded-md border border-border'>
          {workspaces.data.map((ws) => (
            <li
              key={ws.id}
              className='flex items-center justify-between gap-3 px-4 py-2.5'
            >
              <div className='min-w-0'>
                <p className='truncate text-sm'>{ws.name}</p>
                <p className='font-mono text-muted-foreground text-xs'>
                  {ws.slug}
                </p>
              </div>
              <Switch
                aria-label={`Beta para ${ws.name}`}
                checked={ws.beta}
                disabled={setBeta.isPending}
                onCheckedChange={(value) => toggle(ws.id, value)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAdminPlatformFlags } from '@/src/hooks/use-platform-flags'
import type { PlatformFlagDTO } from '@/types/platform-flag'
import { AdminPanel, ErrorState, TableSkeleton } from '../shell/admin-ui'
import { BetaWorkspacesPanel } from './beta-workspaces-panel'
import { FlagGrantsDialog } from './flag-grants-dialog'
import { PlatformFlagDialog } from './platform-flag-dialog'
import { PlatformFlagsTable } from './platform-flags-table'

type Tab = 'flags' | 'beta'

const TABS: { value: Tab; label: string }[] = [
  { value: 'flags', label: 'Flags' },
  { value: 'beta', label: 'Workspaces beta' },
]

/** Página de feature flags: flags (liga/desliga) e workspaces beta. */
export function PlatformFlagsPanel() {
  const [tab, setTab] = useState<Tab>('flags')
  const [dialog, setDialog] = useState<{ flag: PlatformFlagDTO | null } | null>(
    null,
  )
  const [grantsFlag, setGrantsFlag] = useState<PlatformFlagDTO | null>(null)
  const { data, isLoading, isError, refetch } = useAdminPlatformFlags()

  return (
    <AdminPanel
      flush={tab === 'flags'}
      title={
        <div role='tablist' className='flex gap-1'>
          {TABS.map((t) => (
            <button
              key={t.value}
              type='button'
              role='tab'
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'rounded-md px-2.5 py-1 text-sm',
                tab === t.value
                  ? 'bg-secondary font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
      actions={
        tab === 'flags' ? (
          <Button size='sm' onClick={() => setDialog({ flag: null })}>
            Nova flag
          </Button>
        ) : undefined
      }
    >
      {tab === 'beta' ? (
        <BetaWorkspacesPanel />
      ) : isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <div className='p-4'>
          <ErrorState
            message='Não foi possível carregar as feature flags.'
            action={
              <Button size='sm' variant='outline' onClick={() => refetch()}>
                Tentar de novo
              </Button>
            }
          />
        </div>
      ) : (
        <PlatformFlagsTable
          flags={data ?? []}
          onEdit={(flag) => setDialog({ flag })}
          onGrants={setGrantsFlag}
        />
      )}

      <PlatformFlagDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        flag={dialog?.flag ?? null}
      />
      <FlagGrantsDialog
        flag={grantsFlag}
        onOpenChange={(open) => !open && setGrantsFlag(null)}
      />
    </AdminPanel>
  )
}

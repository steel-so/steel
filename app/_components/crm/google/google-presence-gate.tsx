'use client'

import { GoogleIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCrmGoogleConnection,
  useDisconnectGoogle,
} from '@/src/hooks/use-crm-google-presence'
import type { CrmGoogleConnectionDTO } from '@/src/schemas/crm-google-presence.schema'
import { GoogleConnectCard } from './google-connect-card'
import { GoogleLocationPicker } from './google-location-picker'

/**
 * Wraps the three Google presence pages: loading, not connected / expired,
 * "choose the location" and, once ready, the page content under a slim bar
 * with the connected account and the actions to switch location or
 * disconnect.
 */
export function GooglePresenceGate({
  workspaceId,
  failureReason,
  children,
}: {
  workspaceId: string
  failureReason: string | null
  children: (connection: CrmGoogleConnectionDTO) => ReactNode
}) {
  const query = useCrmGoogleConnection(workspaceId)
  const disconnect = useDisconnectGoogle(workspaceId)
  const [changing, setChanging] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  if (query.isLoading) {
    return (
      <div className='mx-auto w-full max-w-5xl space-y-4'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  if (query.error || !query.data) {
    return (
      <div className='mx-auto max-w-md space-y-3 py-16 text-center'>
        <p role='alert' className='text-destructive text-sm'>
          {query.error?.message ?? 'Não foi possível carregar a conexão.'}
        </p>
        <Button variant='outline' size='sm' onClick={() => query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const connection = query.data

  if (!connection.connected) {
    return (
      <GoogleConnectCard
        workspaceId={workspaceId}
        connection={connection}
        failureReason={failureReason}
      />
    )
  }

  if (!connection.location || changing) {
    return (
      <GoogleLocationPicker
        workspaceId={workspaceId}
        googleEmail={connection.googleEmail}
        onCancel={connection.location ? () => setChanging(false) : undefined}
      />
    )
  }

  return (
    <div className='mx-auto w-full max-w-5xl space-y-5'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card/60 px-4 py-2.5'>
        <SteelIcon
          icon={GoogleIcon}
          size={16}
          className='text-muted-foreground'
        />
        <div className='min-w-0 flex-1'>
          <p className='truncate font-medium text-sm'>
            {connection.location.title}
          </p>
          {connection.googleEmail ? (
            <p className='truncate text-muted-foreground text-xs'>
              {connection.googleEmail}
            </p>
          ) : null}
        </div>
        <Button variant='ghost' size='sm' onClick={() => setChanging(true)}>
          Trocar local
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setConfirmDisconnect(true)}
        >
          Desconectar
        </Button>
      </div>

      {connection.lastSyncError ? (
        <p
          role='alert'
          className='rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-amber-700 text-sm dark:text-amber-400'
        >
          Última sincronização com o Google falhou: {connection.lastSyncError}
        </p>
      ) : null}

      {children(connection)}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar o Google?</AlertDialogTitle>
            <AlertDialogDescription>
              O Steel deixa de ler e editar o perfil, as avaliações e as
              métricas, e apaga o histórico guardado aqui. Nada muda no seu
              perfil do Google. Você pode conectar de novo quando quiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                disconnect.mutate(undefined, {
                  onSuccess: () => notify.success('Google desconectado.'),
                  onError: (error) => notify.error(error),
                })
              }
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

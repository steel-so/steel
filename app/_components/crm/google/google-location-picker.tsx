'use client'

import { Location01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCrmGoogleLocations,
  useSelectGoogleLocation,
} from '@/src/hooks/use-crm-google-presence'
import type { CrmGoogleLocationOptionDTO } from '@/src/schemas/crm-google-presence.schema'

/** Step after connecting: choose which Business Profile location Steel manages. */
export function GoogleLocationPicker({
  workspaceId,
  googleEmail,
  onCancel,
}: {
  workspaceId: string
  googleEmail: string | null
  /** Present when the picker was opened to change an already chosen location. */
  onCancel?: () => void
}) {
  const locations = useCrmGoogleLocations(workspaceId, true)
  const select = useSelectGoogleLocation(workspaceId)
  const [picked, setPicked] = useState<CrmGoogleLocationOptionDTO | null>(null)

  function confirm() {
    if (!picked) return
    select.mutate(
      { accountName: picked.accountName, locationName: picked.locationName },
      {
        onSuccess: () => {
          notify.success('Local conectado.')
          onCancel?.()
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <div className='mx-auto w-full max-w-2xl space-y-5 py-8'>
      <div className='space-y-1'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          Escolha o local que o Steel vai gerenciar
        </h2>
        <p className='text-muted-foreground text-sm'>
          {googleEmail
            ? `Locais da conta ${googleEmail}.`
            : 'Locais da conta do Google conectada.'}{' '}
          Você pode trocar depois.
        </p>
      </div>

      {locations.isLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : locations.error ? (
        <div className='space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4'>
          <p role='alert' className='text-destructive text-sm'>
            {locations.error.message}
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => locations.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : (locations.data ?? []).length === 0 ? (
        <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Esta conta do Google não administra nenhum local. Crie ou reivindique
          seu negócio em business.google.com e volte aqui, ou conecte outra
          conta.
        </p>
      ) : (
        <fieldset className='min-w-0 space-y-2'>
          <legend className='sr-only'>Locais</legend>
          {(locations.data ?? []).map((location) => (
            <label
              key={`${location.accountName}/${location.locationName}`}
              className='flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-4 text-left transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5'
            >
              <input
                type='radio'
                name='google-location'
                className='sr-only'
                checked={picked?.locationName === location.locationName}
                onChange={() => setPicked(location)}
              />
              <SteelIcon
                icon={Location01Icon}
                size={18}
                className='mt-0.5 shrink-0 text-primary'
              />
              <span className='min-w-0'>
                <span className='block truncate font-medium text-sm'>
                  {location.title}
                </span>
                <span className='block text-muted-foreground text-xs'>
                  {location.address ??
                    'Sem endereço (negócio de área de atuação)'}
                </span>
                <span className='block text-muted-foreground/80 text-xs'>
                  {location.accountLabel}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className='flex justify-end gap-2'>
        {onCancel ? (
          <Button variant='ghost' onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button disabled={!picked || select.isPending} onClick={confirm}>
          {select.isPending ? 'Conectando…' : 'Usar este local'}
        </Button>
      </div>
    </div>
  )
}

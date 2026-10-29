'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  useActOnSdStatusSubscription,
  useSdStatusSubscription,
} from '@/src/hooks/use-sd-status-pages'

/**
 * Confirmation / unsubscribe card of a status-page subscriber. The e-mail
 * link only opens this card: the change happens on the click (POST), so link
 * scanners never subscribe or unsubscribe anyone.
 */
export function SdStatusSubscriptionCard({
  slug,
  token,
}: {
  slug: string
  token: string
}) {
  const query = useSdStatusSubscription(slug, token)
  const act = useActOnSdStatusSubscription(slug, token)
  const data = query.data

  if (query.isLoading) {
    return <p className='text-muted-foreground text-sm'>Carregando…</p>
  }
  if (!data) {
    return (
      <div className='flex flex-col gap-2'>
        <h1 className='font-semibold text-lg'>Inscrição não encontrada</h1>
        <p className='text-muted-foreground text-sm'>
          O link pode ter sido cancelado ou estar incompleto. Se quiser receber
          os avisos, inscreva-se de novo na página de status.
        </p>
        <Button
          variant='outline'
          className='w-fit'
          render={<Link href={`/status-page/${slug}`} />}
        >
          Ir para a página de status
        </Button>
      </div>
    )
  }

  const back = (
    <Button
      variant='outline'
      className='w-fit'
      render={<Link href={`/status-page/${data.pageSlug}`} />}
    >
      Ver a página de status
    </Button>
  )

  if (data.unsubscribed) {
    return (
      <div className='flex flex-col gap-3'>
        <h1 className='font-semibold text-lg'>Inscrição cancelada</h1>
        <p className='text-muted-foreground text-sm'>
          {data.addressMasked} não receberá mais os avisos de {data.pageName}.
        </p>
        {back}
      </div>
    )
  }
  return (
    <div className='flex flex-col gap-3'>
      <h1 className='font-semibold text-lg'>
        {data.confirmed ? 'Você assina os avisos' : 'Confirme sua inscrição'}
      </h1>
      <p className='text-muted-foreground text-sm'>
        {data.confirmed
          ? `${data.addressMasked} recebe as atualizações de incidentes de ${data.pageName}.`
          : `Confirme para que ${data.addressMasked} receba as atualizações de incidentes de ${data.pageName}.`}
      </p>
      {act.error ? (
        <p role='alert' className='text-destructive text-sm'>
          {act.error.message}
        </p>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        {data.confirmed ? null : (
          <Button
            disabled={act.isPending}
            onClick={() => act.mutate('CONFIRM')}
          >
            Confirmar inscrição
          </Button>
        )}
        <Button
          variant={data.confirmed ? 'default' : 'outline'}
          disabled={act.isPending}
          onClick={() => act.mutate('UNSUBSCRIBE')}
        >
          Cancelar inscrição
        </Button>
      </div>
      {back}
    </div>
  )
}

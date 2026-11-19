'use client'

import {
  GoogleIcon,
  MapsLocation01Icon,
  StarIcon,
  Store01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CrmGoogleConnectionDTO } from '@/src/schemas/crm-google-presence.schema'
import { connectUrl, GOOGLE_CALLBACK_ERRORS } from './google-format'

const BENEFITS = [
  {
    icon: Store01Icon,
    title: 'Perfil da empresa',
    text: 'Edite nome, horários, descrição, categorias e fotos sem sair do Steel.',
  },
  {
    icon: MapsLocation01Icon,
    title: 'Desempenho no Maps',
    text: 'Veja quantas pessoas encontraram, ligaram e pediram rota até você.',
  },
  {
    icon: StarIcon,
    title: 'Avaliações',
    text: 'Responda clientes, receba alerta de nota baixa e acompanhe sua nota.',
  },
]

/**
 * "Not connected" screen shared by the three Google presence pages: says what
 * the connection gives, explains reconnect when the access expired and shows
 * why the last attempt failed.
 */
export function GoogleConnectCard({
  workspaceId,
  connection,
  failureReason,
}: {
  workspaceId: string
  connection: CrmGoogleConnectionDTO | undefined
  /** `reason` the OAuth callback put in the URL, when the last try failed. */
  failureReason: string | null
}) {
  const failure =
    failureReason !== null
      ? (GOOGLE_CALLBACK_ERRORS[failureReason] ??
        'Não foi possível concluir a conexão com o Google.')
      : null

  const configured = connection?.configured ?? true
  const reconnecting =
    connection?.status === 'EXPIRED' || connection?.status === 'REVOKED'

  return (
    <div className='mx-auto flex max-w-2xl flex-col items-center gap-6 py-10 text-center'>
      <div className='flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-card/70 text-muted-foreground'>
        <SteelIcon icon={GoogleIcon} size={24} />
      </div>
      <div className='space-y-1.5'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          {reconnecting
            ? 'Reconecte sua conta do Google'
            : 'Conecte seu Perfil da Empresa no Google'}
        </h2>
        <p className='text-muted-foreground text-sm'>
          {reconnecting
            ? 'O acesso ao Google expirou ou foi revogado. Conecte de novo para voltar a ver e responder avaliações e métricas.'
            : 'Entre com a conta do Google que administra o seu negócio. O Steel passa a mostrar e editar o perfil, as avaliações e o desempenho no Google e no Maps.'}
        </p>
      </div>

      {failure ? (
        <p
          role='alert'
          className='w-full rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive text-sm'
        >
          {failure}
        </p>
      ) : null}

      <ul className='grid w-full gap-3 text-left sm:grid-cols-3'>
        {BENEFITS.map((benefit) => (
          <li
            key={benefit.title}
            className='rounded-xl border border-border/60 bg-card/60 p-4'
          >
            <SteelIcon
              icon={benefit.icon}
              size={18}
              className='mb-2 text-primary'
            />
            <p className='font-medium text-sm'>{benefit.title}</p>
            <p className='mt-1 text-muted-foreground text-xs'>{benefit.text}</p>
          </li>
        ))}
      </ul>

      {configured ? (
        <a
          href={connectUrl(workspaceId)}
          className={cn(buttonVariants({ size: 'lg' }))}
        >
          {reconnecting ? 'Reconectar com o Google' : 'Conectar com o Google'}
        </a>
      ) : (
        <p className='rounded-lg border border-dashed px-4 py-3 text-muted-foreground text-sm'>
          A conexão com o Google ainda não foi habilitada neste ambiente. Fale
          com o administrador da plataforma.
        </p>
      )}

      <p className='max-w-md text-muted-foreground text-xs'>
        O Steel só pede a permissão do Google Meu Negócio. Você pode desconectar
        quando quiser e o acesso é revogado no Google.
      </p>
    </div>
  )
}

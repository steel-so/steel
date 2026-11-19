'use client'

import {
  ArrowUpRight01Icon,
  Navigation03Icon,
  StarIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  useCrmGoogleLinks,
  useReconnectOnAuthError,
} from '@/src/hooks/use-crm-google-presence'
import type { CrmGoogleConnectionDTO } from '@/src/schemas/crm-google-presence.schema'
import { formatInt, formatRating } from './google-format'
import { GooglePerformancePanel } from './google-performance-panel'
import { GooglePresenceGate } from './google-presence-gate'
import { copyText, GoogleQr } from './google-qr'
import { GoogleStars } from './google-stars'

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <div className='space-y-1'>
      <p className='font-medium text-xs'>{label}</p>
      <div className='flex items-center gap-2'>
        <input
          readOnly
          value={url}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          className='h-8 min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-2 text-xs outline-none'
        />
        <button
          type='button'
          onClick={() => copyText(url)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          Copiar
        </button>
      </div>
    </div>
  )
}

/** Google Maps: the location card, the shareable links and the performance. */
export function GoogleMapsView({
  workspaceId,
  connection,
}: {
  workspaceId: string
  connection: CrmGoogleConnectionDTO
}) {
  const links = useCrmGoogleLinks(workspaceId, true)
  useReconnectOnAuthError(workspaceId, links.error)
  const data = links.data

  return (
    <div className='space-y-8'>
      <section className='grid gap-4 lg:grid-cols-[1.4fr_1fr]'>
        <Card className='gap-0 overflow-hidden p-0'>
          {links.isLoading ? (
            <Skeleton className='h-72 w-full rounded-none' />
          ) : data?.embedUrl ? (
            <iframe
              title={`Mapa de ${data.title}`}
              src={data.embedUrl}
              loading='lazy'
              referrerPolicy='no-referrer-when-downgrade'
              className='h-72 w-full border-0'
            />
          ) : (
            <div className='flex h-72 items-center justify-center px-6 text-center text-muted-foreground text-sm'>
              {links.error?.message ??
                'Este local não tem endereço público para mostrar no mapa.'}
            </div>
          )}
          <div className='space-y-3 px-5 py-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='min-w-0'>
                <h3 className='truncate font-heading font-semibold text-base tracking-tight'>
                  {connection.location?.title}
                </h3>
                {data?.address ? (
                  <p className='text-muted-foreground text-sm'>
                    {data.address}
                  </p>
                ) : null}
              </div>
              {connection.averageRating !== null ? (
                <div className='flex items-center gap-2'>
                  <span className='font-heading font-semibold text-xl tabular-nums'>
                    {formatRating(connection.averageRating)}
                  </span>
                  <div className='flex flex-col'>
                    <GoogleStars value={connection.averageRating} />
                    <span className='text-muted-foreground text-xs'>
                      {formatInt(connection.totalReviewCount ?? 0)} avaliações
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className='flex flex-wrap gap-2'>
              {data?.mapsUrl ? (
                <a
                  href={data.mapsUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                  )}
                >
                  <SteelIcon icon={ArrowUpRight01Icon} size={14} />
                  Abrir no Google Maps
                </a>
              ) : null}
              {data?.directionsUrl ? (
                <a
                  href={data.directionsUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                  )}
                >
                  <SteelIcon icon={Navigation03Icon} size={14} />
                  Como chegar
                </a>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className='gap-4 px-5 py-5'>
          <div>
            <h3 className='font-heading font-semibold text-base tracking-tight'>
              Links para compartilhar
            </h3>
            <p className='text-muted-foreground text-xs'>
              Use no site, na assinatura de e-mail, em campanhas e no balcão.
            </p>
          </div>
          {links.isLoading ? (
            <Skeleton className='h-48 w-full' />
          ) : data ? (
            <div className='space-y-4'>
              {data.reviewUrl ? (
                <>
                  <LinkRow label='Link para avaliar' url={data.reviewUrl} />
                  <GoogleQr
                    url={data.reviewUrl}
                    label='QR code do link de avaliação no Google'
                    fileName='avaliar-no-google'
                  />
                </>
              ) : (
                <p className='flex items-center gap-2 text-muted-foreground text-sm'>
                  <SteelIcon icon={StarIcon} size={14} />O Google ainda não
                  liberou o link de avaliação deste local.
                </p>
              )}
              {data.directionsUrl ? (
                <LinkRow label='Link de rotas' url={data.directionsUrl} />
              ) : null}
              {data.mapsUrl ? (
                <LinkRow label='Link do local no Maps' url={data.mapsUrl} />
              ) : null}
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {links.error?.message ?? 'Links indisponíveis.'}
            </p>
          )}
        </Card>
      </section>

      <GooglePerformancePanel workspaceId={workspaceId} />
    </div>
  )
}

/** Page body of CRM > Presença no Google > Google Maps. */
export function GoogleMapsScreen({
  workspaceId,
  failureReason,
}: {
  workspaceId: string
  failureReason: string | null
}) {
  return (
    <GooglePresenceGate workspaceId={workspaceId} failureReason={failureReason}>
      {(connection) => (
        <GoogleMapsView workspaceId={workspaceId} connection={connection} />
      )}
    </GooglePresenceGate>
  )
}

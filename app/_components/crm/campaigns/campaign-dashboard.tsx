'use client'

import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Mail01Icon,
  PauseIcon,
  PlayIcon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  LIVE_CAMPAIGN_STATUSES,
  useControlCrmCampaign,
  useCrmCampaignRecipients,
  useCrmCampaignStats,
} from '@/src/hooks/use-crm-campaigns'
import type {
  CrmCampaignDetailDTO,
  CrmCampaignRecipientDTO,
  CrmCampaignStatsDTO,
} from '@/types/crm-campaign'
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_VARIANT,
  CONVERSION_KIND_LABEL,
  DELIVERY_LABEL,
  DESTINATION_TYPE_LABEL,
  formatCampaignDate,
  percent,
  SKIP_REASON_LABEL,
} from './campaign-labels'
import { CopyLinkRow } from './campaign-steps'

type FunnelStep = { label: string; value: number }

function Funnel({
  title,
  icon,
  steps,
  footer,
}: {
  title: string
  icon: typeof Mail01Icon
  steps: FunnelStep[]
  footer?: string
}) {
  const top = steps[0]?.value ?? 0
  return (
    <section
      aria-label={title}
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <h2 className='flex items-center gap-2 font-medium text-sm'>
        <SteelIcon icon={icon} size={16} /> {title}
      </h2>
      <ul className='flex flex-col gap-2'>
        {steps.map((step) => (
          <li key={step.label} className='flex flex-col gap-1'>
            <div className='flex items-baseline justify-between gap-2 text-sm'>
              <span>{step.label}</span>
              <span className='tabular-nums'>
                <strong>{step.value}</strong>{' '}
                <span className='text-muted-foreground text-xs'>
                  {percent(step.value, top)}
                </span>
              </span>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div
                className='h-full rounded-full bg-primary'
                style={{
                  width: top > 0 ? `${(step.value / top) * 100}%` : '0%',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      {footer ? (
        <p className='text-muted-foreground text-xs'>{footer}</p>
      ) : null}
    </section>
  )
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className='flex min-w-0 flex-col rounded-xl border p-3'>
      <span className='truncate text-muted-foreground text-xs'>{label}</span>
      <span className='font-semibold text-xl tabular-nums'>{value}</span>
      {hint ? (
        <span className='truncate text-muted-foreground text-xs'>{hint}</span>
      ) : null}
    </div>
  )
}

/** Conversions split by where they happened: site page views, forms sent
 * on site pages, the CRM form page and legacy landing pages. */
export function ConversionsByDestination({
  conversions,
}: {
  conversions: CrmCampaignStatsDTO['conversions']
}) {
  const split = conversions.byDestination
  const rows = [
    { key: 'siteView', label: 'Visitas no site', value: split.siteView },
    { key: 'siteForm', label: 'Formulários no site', value: split.siteForm },
    { key: 'crmForm', label: 'Formulário do CRM', value: split.crmForm },
    {
      key: 'landingView',
      label: 'Landing page antiga',
      value: split.landingView,
    },
  ].filter((row) => row.value > 0 || row.key !== 'landingView')
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <section
      aria-labelledby='conversions-by-destination'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <h2 id='conversions-by-destination' className='font-medium text-sm'>
        Conversões por destino
      </h2>
      <ul className='grid gap-2.5 sm:grid-cols-2'>
        {rows.map((row) => (
          <li key={row.key} className='flex min-w-0 flex-col gap-1'>
            <div className='flex items-baseline justify-between gap-2 text-sm'>
              <span className='truncate'>{row.label}</span>
              <span className='font-medium tabular-nums'>{row.value}</span>
            </div>
            <div className='h-1.5 w-full rounded-sm bg-muted' aria-hidden>
              <div
                className='h-full rounded-sm bg-primary'
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Funnel and conversion numbers of one campaign. */
export function CampaignResults({
  stats,
  whatsappEnabled,
  workspaceSlug,
}: {
  stats: CrmCampaignStatsDTO
  whatsappEnabled: boolean
  workspaceSlug: string
}) {
  const { email, whatsapp, conversions } = stats
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        <Tile label='Contatos' value={String(stats.recipients)} />
        <Tile
          label='E-mails abertos'
          value={percent(email.opened, email.sent)}
          hint={`${email.opened} de ${email.sent}`}
        />
        <Tile
          label='Cliques'
          value={String(email.clicked + whatsapp.clicked)}
        />
        <Tile
          label='Conversões'
          value={String(conversions.total)}
          hint={`${conversions.submissions} envio(s) · ${conversions.visits} visita(s)`}
        />
      </div>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Funnel
          title='E-mail'
          icon={Mail01Icon}
          steps={[
            { label: 'Enviados', value: email.sent },
            { label: 'Entregues', value: email.delivered },
            { label: 'Abertos', value: email.opened },
            { label: 'Clicaram', value: email.clicked },
          ]}
          footer={`${email.pending} na fila · ${email.failed} com falha · ${email.skipped} não enviados · ${email.unsubscribed} descadastros`}
        />
        {whatsappEnabled ? (
          <Funnel
            title='WhatsApp'
            icon={WhatsappIcon}
            steps={[
              { label: 'Enviados', value: whatsapp.sent },
              { label: 'Entregues', value: whatsapp.delivered },
              { label: 'Lidos', value: whatsapp.read },
              { label: 'Responderam', value: whatsapp.replied },
            ]}
            footer={`${whatsapp.pending} na fila · ${whatsapp.failed} com falha · ${whatsapp.clicked} clique(s) no link`}
          />
        ) : null}
      </div>
      <ConversionsByDestination conversions={conversions} />
      <section
        aria-label='Convertidos'
        className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
      >
        <h2 className='font-medium text-sm'>
          Convertidos no destino{' '}
          <span className='text-muted-foreground'>
            (e-mail {conversions.byChannel.email} · WhatsApp{' '}
            {conversions.byChannel.whatsapp} · outros{' '}
            {conversions.byChannel.unknown})
          </span>
        </h2>
        {stats.convertedContacts.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Ninguém converteu ainda.
          </p>
        ) : (
          <ul className='divide-y'>
            {stats.convertedContacts.map((row) => (
              <li
                key={row.id}
                className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'
              >
                <span className='min-w-0 truncate'>
                  {row.leadId ? (
                    <Link
                      className='underline-offset-4 hover:underline'
                      href={`/${workspaceSlug}/crm/leads?record=${row.leadId}`}
                    >
                      {row.name ?? 'Novo lead'}
                    </Link>
                  ) : (
                    (row.name ?? 'Visitante')
                  )}
                  <span className='text-muted-foreground'>
                    {' '}
                    · {CONVERSION_KIND_LABEL[row.kind]}
                    {row.channel
                      ? ` via ${row.channel === 'EMAIL' ? 'e-mail' : 'WhatsApp'}`
                      : ''}
                  </span>
                </span>
                <span className='text-muted-foreground text-xs'>
                  {formatCampaignDate(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function timeline(row: CrmCampaignRecipientDTO) {
  const events: { at: string; label: string }[] = []
  const push = (at: string | null, label: string) => {
    if (at) events.push({ at, label })
  }
  push(row.emailSentAt, 'E-mail enviado')
  push(row.emailDeliveredAt, 'E-mail entregue')
  push(row.emailOpenedAt, 'E-mail aberto')
  push(row.emailClickedAt, 'Clicou no e-mail')
  push(row.emailBouncedAt, 'E-mail voltou')
  push(row.unsubscribedAt, 'Descadastrou')
  push(row.whatsappSentAt, 'WhatsApp enviado')
  push(row.whatsappDeliveredAt, 'WhatsApp entregue')
  push(row.whatsappReadAt, 'WhatsApp lido')
  push(row.whatsappClickedAt, 'Clicou no WhatsApp')
  push(row.whatsappRepliedAt, 'Respondeu no WhatsApp')
  push(row.convertedAt, 'Converteu')
  return events.sort((a, b) => a.at.localeCompare(b.at))
}

function channelState(
  status: CrmCampaignRecipientDTO['emailStatus'],
  reason: string | null,
  error: string | null,
) {
  if (status === 'SKIPPED' && reason) return SKIP_REASON_LABEL[reason] ?? reason
  if (status === 'FAILED' && error) return `Falhou: ${error}`
  return DELIVERY_LABEL[status]
}

function RecipientsTable({
  workspaceId,
  campaignId,
  whatsappEnabled,
}: {
  workspaceId: string
  campaignId: string
  whatsappEnabled: boolean
}) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const recipients = useCrmCampaignRecipients(
    workspaceId,
    campaignId,
    page,
    search,
  )
  const data = recipients.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <section
      aria-label='Contatos'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='font-medium text-sm'>Contatos</h2>
        <Input
          aria-label='Buscar contato'
          placeholder='Buscar por nome, e-mail ou telefone'
          className='w-full sm:w-72'
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>
      {recipients.isLoading ? (
        <Skeleton className='h-32' />
      ) : (
        <ul className='divide-y'>
          {(data?.items ?? []).map((row) => (
            <li key={row.id} className='py-2'>
              <button
                type='button'
                className='flex w-full min-w-0 flex-col gap-1 text-left sm:flex-row sm:items-center sm:justify-between'
                aria-expanded={open === row.id}
                onClick={() => setOpen(open === row.id ? null : row.id)}
              >
                <span className='min-w-0'>
                  <span className='block truncate font-medium text-sm'>
                    {row.name}
                  </span>
                  <span className='block truncate text-muted-foreground text-xs'>
                    {[row.email, row.waId ? `+${row.waId}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className='flex flex-wrap gap-2 text-xs'>
                  <Badge variant='outline'>
                    E-mail:{' '}
                    {channelState(row.emailStatus, row.emailSkipReason, null)}
                  </Badge>
                  {whatsappEnabled ? (
                    <Badge variant='outline'>
                      WhatsApp:{' '}
                      {channelState(
                        row.whatsappStatus,
                        row.whatsappSkipReason,
                        null,
                      )}
                    </Badge>
                  ) : null}
                  {row.convertedAt ? <Badge>Converteu</Badge> : null}
                </span>
              </button>
              {open === row.id ? (
                <ol className='mt-2 flex flex-col gap-1 border-l pl-3 text-xs'>
                  {timeline(row).length === 0 ? (
                    <li className='text-muted-foreground'>
                      {channelState(
                        row.emailStatus,
                        row.emailSkipReason,
                        row.emailError,
                      )}
                    </li>
                  ) : (
                    timeline(row).map((event) => (
                      <li key={`${event.label}-${event.at}`}>
                        <span className='text-muted-foreground'>
                          {formatCampaignDate(event.at)}
                        </span>{' '}
                        {event.label}
                      </li>
                    ))
                  )}
                  {row.emailError ? (
                    <li className='text-destructive'>
                      E-mail: {row.emailError}
                    </li>
                  ) : null}
                  {row.whatsappError ? (
                    <li className='text-destructive'>
                      WhatsApp: {row.whatsappError}
                    </li>
                  ) : null}
                </ol>
              ) : null}
            </li>
          ))}
          {data && data.items.length === 0 ? (
            <li className='py-4 text-center text-muted-foreground text-sm'>
              Nenhum contato encontrado.
            </li>
          ) : null}
        </ul>
      )}
      {pages > 1 ? (
        <div className='flex items-center justify-end gap-2 text-sm'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </Button>
          <span className='tabular-nums'>
            {page} / {pages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </Button>
        </div>
      ) : null}
    </section>
  )
}

export function CrmCampaignDashboard({
  workspaceId,
  workspaceSlug,
  campaign,
}: {
  workspaceId: string
  workspaceSlug: string
  campaign: CrmCampaignDetailDTO
}) {
  const live = LIVE_CAMPAIGN_STATUSES.includes(campaign.status)
  const stats = useCrmCampaignStats(workspaceId, campaign.id, live)
  const control = useControlCrmCampaign(workspaceId, campaign.id)
  const [confirmCancel, setConfirmCancel] = useState(false)

  function act(action: 'pause' | 'resume' | 'cancel') {
    control.mutate(action, {
      onSuccess: () =>
        notify.success(
          action === 'pause'
            ? 'Campanha pausada'
            : action === 'resume'
              ? 'Campanha retomada'
              : 'Campanha cancelada',
        ),
      onError: (error) => notify.error(error, 'Erro ao atualizar a campanha'),
    })
  }

  const canPause =
    campaign.status === 'SCHEDULED' || campaign.status === 'SENDING'
  const canResume = campaign.status === 'PAUSED'
  const canCancel = canPause || canResume

  return (
    <div className='flex min-w-0 flex-col gap-6 p-4 sm:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-2'>
          <Button
            variant='ghost'
            size='icon'
            nativeButton={false}
            aria-label='Voltar para campanhas'
            render={
              <Link href={`/${workspaceSlug}/crm/campaigns`}>
                <SteelIcon icon={ArrowLeft01Icon} />
              </Link>
            }
          />
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h1 className='truncate font-semibold text-lg'>
                {campaign.name}
              </h1>
              <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>
                {CAMPAIGN_STATUS_LABEL[campaign.status]}
              </Badge>
            </div>
            <p className='text-muted-foreground text-xs'>
              {campaign.status === 'SCHEDULED' ? 'Começa' : 'Início'}:{' '}
              {formatCampaignDate(campaign.startAt)}
              {campaign.completedAt
                ? ` · Fim: ${formatCampaignDate(campaign.completedAt)}`
                : ''}
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          {canPause ? (
            <Button
              variant='outline'
              onClick={() => act('pause')}
              disabled={control.isPending}
            >
              <SteelIcon icon={PauseIcon} /> Pausar
            </Button>
          ) : null}
          {canResume ? (
            <Button onClick={() => act('resume')} disabled={control.isPending}>
              <SteelIcon icon={PlayIcon} /> Retomar
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              variant='destructive'
              onClick={() => setConfirmCancel(true)}
              disabled={control.isPending}
            >
              <SteelIcon icon={Cancel01Icon} /> Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      {campaign.destination ? (
        <p className='min-w-0 truncate text-muted-foreground text-sm'>
          {DESTINATION_TYPE_LABEL[campaign.destination.type]}:{' '}
          <span className='text-foreground'>
            {campaign.destination.name}
            {campaign.destination.pageTitle
              ? ` › ${campaign.destination.pageTitle}`
              : ''}
          </span>
        </p>
      ) : null}
      {campaign.links.email ? (
        <div className='grid gap-3 rounded-xl border bg-muted/30 p-4 lg:grid-cols-2'>
          <CopyLinkRow label='Link do e-mail' url={campaign.links.email} />
          {campaign.whatsappEnabled && campaign.links.whatsapp ? (
            <CopyLinkRow
              label='Link do WhatsApp'
              url={campaign.links.whatsapp}
            />
          ) : null}
        </div>
      ) : null}

      {stats.data ? (
        <CampaignResults
          stats={stats.data}
          whatsappEnabled={campaign.whatsappEnabled}
          workspaceSlug={workspaceSlug}
        />
      ) : (
        <Skeleton className='h-64 rounded-xl' />
      )}

      <RecipientsTable
        workspaceId={workspaceId}
        campaignId={campaign.id}
        whatsappEnabled={campaign.whatsappEnabled}
      />

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem ainda não recebeu não receberá mais. Os resultados até aqui
              continuam disponíveis.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCancel(false)
                act('cancel')
              }}
            >
              Cancelar campanha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

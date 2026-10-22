'use client'

import {
  ArrowLeft01Icon,
  Delete02Icon,
  Edit02Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  useArchiveWhatsAppAiCampaign,
  usePauseWhatsAppAiCampaign,
  usePlayWhatsAppAiCampaign,
  useWhatsAppAiCampaign,
  useWhatsAppAiCampaignActionRuns,
  useWhatsAppAiCampaignRecipients,
} from '@/src/hooks/use-whatsapp-ai-campaigns'
import {
  estimateAiCampaignDuration,
  formatDuration,
} from '@/src/lib/whatsapp/ai-campaign'
import { AI_CAMPAIGN_ACTION_KIND_LABEL } from '@/src/lib/whatsapp/ai-campaign-actions'
import type { AiCampaignAction } from '@/src/schemas/whatsapp-ai-campaign.schema'
import type {
  WhatsAppAiCampaignDTO,
  WhatsAppAiCampaignRecipientDTO,
  WhatsAppAiCampaignRecipientStatusDTO,
} from '@/types/whatsapp-ai-campaign'
import { AiCampaignNoWhatsapp } from './ai-campaign-no-whatsapp'
import {
  AiCampaignFunnel,
  AiCampaignStatusBadge,
  aiCampaignProgress,
  ProgressBar,
  StatTile,
} from './ai-campaign-ui'

const RECIPIENT_STATUS_LABEL: Record<
  WhatsAppAiCampaignRecipientStatusDTO,
  string
> = {
  PENDING: 'Na fila',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Pulado',
}

const STATUS_FILTER = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PENDING', label: 'Na fila' },
  { value: 'SENT', label: 'Enviados' },
  { value: 'FAILED', label: 'Falharam' },
  { value: 'SKIPPED', label: 'Pulados' },
]

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function formatDate(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : '—'
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

function conversationLabel(recipient: WhatsAppAiCampaignRecipientDTO): string {
  if (!recipient.conversationId) return '—'
  if (recipient.conversationStatus !== 'CLOSED') return 'Em andamento'
  if (recipient.closeOutcome === 'SUCCESS') return 'Deu certo'
  if (recipient.closeOutcome === 'FAILURE') return 'Não deu certo'
  return 'Fechada'
}

function RecipientsTab({
  workspaceId,
  slug,
  campaignId,
}: {
  workspaceId: string
  slug: string
  campaignId: string
}) {
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const recipients = useWhatsAppAiCampaignRecipients(workspaceId, campaignId, {
    status:
      status === 'ALL'
        ? undefined
        : (status as WhatsAppAiCampaignRecipientStatusDTO),
    search: search.trim() || undefined,
  })
  const items = recipients.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-2'>
        <div className='relative min-w-56 flex-1'>
          <SteelIcon
            icon={Search01Icon}
            size={14}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground'
          />
          <Input
            aria-label='Buscar contato'
            placeholder='Buscar por nome ou telefone'
            className='pl-8'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          items={STATUS_FILTER}
          value={status}
          onValueChange={(value) => setStatus((value as string) ?? 'ALL')}
        >
          <SelectTrigger aria-label='Filtrar por situação' className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {STATUS_FILTER.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {recipients.isLoading ? (
        <Skeleton className='h-40 rounded-lg' />
      ) : items.length === 0 ? (
        <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Nenhum contato nesta situação.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-left text-muted-foreground text-xs'>
              <tr>
                <th className='px-3 py-2 font-medium'>Contato</th>
                <th className='px-3 py-2 font-medium'>Envio</th>
                <th className='px-3 py-2 font-medium'>Respondeu</th>
                <th className='px-3 py-2 font-medium'>Conversa</th>
              </tr>
            </thead>
            <tbody>
              {items.map((recipient) => (
                <tr key={recipient.id} className='border-t'>
                  <td className='px-3 py-2'>
                    <p className='font-medium'>
                      {recipient.contactName ?? recipient.waId}
                    </p>
                    {recipient.contactName ? (
                      <p className='text-muted-foreground text-xs'>
                        {recipient.waId}
                      </p>
                    ) : null}
                  </td>
                  <td className='px-3 py-2'>
                    <Badge
                      variant={
                        recipient.status === 'FAILED'
                          ? 'destructive'
                          : 'outline'
                      }
                    >
                      {RECIPIENT_STATUS_LABEL[recipient.status]}
                    </Badge>
                    <p className='mt-0.5 text-muted-foreground text-xs'>
                      {recipient.errorMessage ?? formatDate(recipient.sentAt)}
                    </p>
                  </td>
                  <td className='px-3 py-2 text-xs'>
                    {recipient.repliedAt
                      ? formatDate(recipient.repliedAt)
                      : '—'}
                  </td>
                  <td className='px-3 py-2'>
                    {recipient.conversationId ? (
                      <Link
                        href={`/${slug}/zap?conversa=${recipient.conversationId}`}
                        className='text-primary text-xs underline-offset-2 hover:underline'
                      >
                        {conversationLabel(recipient)}
                      </Link>
                    ) : (
                      <span className='text-muted-foreground text-xs'>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recipients.hasNextPage ? (
        <div className='flex justify-center'>
          <Button
            variant='outline'
            size='sm'
            disabled={recipients.isFetchingNextPage}
            onClick={() => recipients.fetchNextPage()}
          >
            {recipients.isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ActionRunsTab({
  workspaceId,
  slug,
  campaignId,
}: {
  workspaceId: string
  slug: string
  campaignId: string
}) {
  const runs = useWhatsAppAiCampaignActionRuns(workspaceId, campaignId)

  if (runs.isLoading) return <Skeleton className='h-40 rounded-lg' />
  if (!runs.data?.length) {
    return (
      <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
        A IA ainda não executou nenhuma ação. Elas aparecem aqui conforme os
        contatos respondem.
      </p>
    )
  }

  return (
    <ul className='divide-y rounded-lg border'>
      {runs.data.map((run) => (
        <li
          key={run.id}
          className='flex flex-wrap items-start justify-between gap-2 p-3'
        >
          <div className='min-w-0 space-y-0.5'>
            <p className='font-medium text-sm'>
              {run.label}{' '}
              <span className='font-normal text-muted-foreground text-xs'>
                ·{' '}
                {AI_CAMPAIGN_ACTION_KIND_LABEL[
                  run.kind as AiCampaignAction['kind']
                ] ?? run.kind}
              </span>
            </p>
            <p className='text-muted-foreground text-xs'>
              {run.contactName ?? 'Contato'} · {formatDate(run.createdAt)}
            </p>
            {run.reason ? <p className='text-sm'>“{run.reason}”</p> : null}
            {run.error ? (
              <p className='text-destructive text-xs'>{run.error}</p>
            ) : null}
          </div>
          <div className='flex items-center gap-2'>
            <Badge
              variant={run.status === 'SUCCESS' ? 'secondary' : 'destructive'}
            >
              {run.status === 'SUCCESS' ? 'Executada' : 'Falhou'}
            </Badge>
            {run.conversationId ? (
              <Link
                href={`/${slug}/zap?conversa=${run.conversationId}`}
                className='text-primary text-xs underline-offset-2 hover:underline'
              >
                Ver conversa
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function CampaignControls({
  workspaceId,
  slug,
  campaign,
}: {
  workspaceId: string
  slug: string
  campaign: WhatsAppAiCampaignDTO
}) {
  const router = useRouter()
  const play = usePlayWhatsAppAiCampaign(workspaceId)
  const pause = usePauseWhatsAppAiCampaign(workspaceId)
  const archive = useArchiveWhatsAppAiCampaign(workspaceId)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const running = campaign.status === 'RUNNING'

  return (
    <div className='flex flex-wrap gap-2'>
      <Button
        variant='outline'
        nativeButton={false}
        render={
          <Link href={`/${slug}/zap/campanhas-ia/${campaign.id}/editar`} />
        }
      >
        <SteelIcon icon={Edit02Icon} size={14} />
        Editar
      </Button>
      {running ? (
        <Button
          variant='secondary'
          disabled={pause.isPending}
          onClick={() =>
            pause.mutate(campaign.id, {
              onSuccess: () => notify.success('Campanha pausada'),
            })
          }
        >
          <SteelIcon icon={PauseIcon} size={14} />
          Pausar
        </Button>
      ) : campaign.status !== 'DONE' || campaign.stats.pending > 0 ? (
        <Button
          disabled={campaign.problems.length > 0 || play.isPending}
          title={campaign.problems[0]}
          onClick={() =>
            play.mutate(campaign.id, {
              onSuccess: () => notify.success('Campanha iniciada'),
            })
          }
        >
          <SteelIcon icon={PlayIcon} size={14} />
          {campaign.status === 'PAUSED' ? 'Continuar' : 'Iniciar'}
        </Button>
      ) : null}
      <Button
        variant='ghost'
        size='icon'
        aria-label='Arquivar campanha'
        disabled={running}
        onClick={() => setConfirmArchive(true)}
      >
        <SteelIcon icon={Delete02Icon} size={16} />
      </Button>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar campanha</AlertDialogTitle>
            <AlertDialogDescription>
              "{campaign.name}" sai da lista e a IA deixa de seguir as
              instruções dela nas conversas. O histórico das conversas continua
              no WhatsApp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={archive.isPending}
              onClick={() =>
                archive.mutate(campaign.id, {
                  onSuccess: () => {
                    notify.success('Campanha arquivada')
                    router.push(`/${slug}/zap/campanhas-ia`)
                  },
                })
              }
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Acompanhamento de uma campanha: números, funil, contatos e ações da IA. */
export function WhatsappAiCampaignDetail({
  workspaceId,
  slug,
  campaignId,
}: {
  workspaceId: string
  slug: string
  campaignId: string
}) {
  const query = useWhatsAppAiCampaign(workspaceId, campaignId)

  if (query.isLoading) return <Skeleton className='h-96 rounded-lg' />
  if (!query.data) {
    return (
      <p className='text-muted-foreground text-sm'>Campanha não encontrada.</p>
    )
  }

  const campaign = query.data
  const { stats } = campaign
  const progress = aiCampaignProgress(stats)

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-2'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Voltar para as campanhas'
            nativeButton={false}
            render={<Link href={`/${slug}/zap/campanhas-ia`} />}
          >
            <SteelIcon icon={ArrowLeft01Icon} size={16} />
          </Button>
          <div>
            <div className='flex items-center gap-2'>
              <h3 className='font-medium text-sm'>{campaign.name}</h3>
              <AiCampaignStatusBadge status={campaign.status} />
            </div>
            {campaign.objective ? (
              <p className='text-muted-foreground text-sm'>
                {campaign.objective}
              </p>
            ) : null}
          </div>
        </div>
        <CampaignControls
          workspaceId={workspaceId}
          slug={slug}
          campaign={campaign}
        />
      </div>

      {campaign.lastError ? (
        <div className='rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm'>
          <span className='font-medium text-destructive'>Último erro: </span>
          {campaign.lastError}
        </div>
      ) : null}
      {campaign.status !== 'RUNNING' && campaign.problems.length > 0 ? (
        <div className='rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm'>
          Para iniciar: {campaign.problems.join(' · ')}
        </div>
      ) : null}

      <section className='space-y-2 rounded-lg border border-border bg-card p-4'>
        <div className='flex items-center justify-between text-sm'>
          <span className='font-medium'>Progresso dos envios</span>
          <span className='text-muted-foreground text-xs tabular-nums'>
            {stats.total - stats.pending} de {stats.total} · {progress}%
            {campaign.status === 'RUNNING' && stats.pending > 0
              ? ` · termina em ${formatDuration(
                  estimateAiCampaignDuration(
                    stats.pending,
                    campaign.intervalSeconds,
                  ),
                )}`
              : ''}
          </span>
        </div>
        <ProgressBar value={progress} className='h-2' />
      </section>

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        <StatTile
          label='Enviados'
          value={stats.sent}
          hint={`${stats.pending} na fila`}
        />
        <StatTile
          label='Responderam'
          value={stats.replied}
          hint={`${percent(stats.replied, stats.sent)} dos enviados`}
        />
        <StatTile
          label='Deu certo'
          value={stats.success}
          tone='positive'
          hint={`${percent(stats.success, stats.sent)} dos enviados`}
        />
        <StatTile
          label='Não deu certo'
          value={stats.failure}
          tone='negative'
          hint={`${stats.closedWithoutOutcome} sem resposta`}
        />
        <StatTile
          label='Falhas / pulados'
          value={stats.failed + stats.skipped}
          hint={
            stats.failed + stats.skipped > 0
              ? 'Veja o motivo na aba de contatos'
              : `${stats.open} conversa(s) aberta(s)`
          }
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-3'>
        <section className='space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-2'>
          <h2 className='font-medium text-sm'>Funil</h2>
          <AiCampaignFunnel stats={stats} />
        </section>
        <section className='space-y-2 rounded-lg border border-border bg-card p-4 text-sm'>
          <h2 className='font-medium'>Configuração</h2>
          <dl className='space-y-1.5'>
            <div className='flex justify-between gap-2'>
              <dt className='text-muted-foreground'>Template</dt>
              <dd className='truncate'>{campaign.template?.name ?? '—'}</dd>
            </div>
            <div className='flex justify-between gap-2'>
              <dt className='text-muted-foreground'>Intervalo</dt>
              <dd>{campaign.intervalSeconds}s entre envios</dd>
            </div>
            <div className='flex justify-between gap-2'>
              <dt className='text-muted-foreground'>IA</dt>
              <dd>{campaign.aiReplies ? 'Responde e age' : 'Só envia'}</dd>
            </div>
            <div className='flex justify-between gap-2'>
              <dt className='text-muted-foreground'>Início</dt>
              <dd>{formatDate(campaign.startedAt)}</dd>
            </div>
            <div className='flex justify-between gap-2'>
              <dt className='text-muted-foreground'>Último envio</dt>
              <dd>{formatDate(campaign.lastSentAt)}</dd>
            </div>
          </dl>
          <AiCampaignNoWhatsapp workspaceId={workspaceId} campaign={campaign} />
          {campaign.aiReplies && campaign.actions.length > 0 ? (
            <ul className='flex flex-wrap gap-1.5 pt-2'>
              {campaign.actions.map((action) => (
                <li
                  key={action.id}
                  className='rounded-full border px-2 py-0.5 text-xs'
                  title={action.when}
                >
                  {action.label}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <Tabs defaultValue='recipients'>
        <TabsList>
          <TabsTrigger value='recipients'>Contatos</TabsTrigger>
          <TabsTrigger value='actions'>Ações da IA</TabsTrigger>
        </TabsList>
        <TabsContent value='recipients' className='pt-3'>
          <RecipientsTab
            workspaceId={workspaceId}
            slug={slug}
            campaignId={campaign.id}
          />
        </TabsContent>
        <TabsContent value='actions' className='pt-3'>
          <ActionRunsTab
            workspaceId={workspaceId}
            slug={slug}
            campaignId={campaign.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

'use client'

import {
  AiMagicIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useMemo, useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateWhatsAppAiCampaign,
  usePauseWhatsAppAiCampaign,
  usePlayWhatsAppAiCampaign,
  useWhatsAppAiCampaigns,
} from '@/src/hooks/use-whatsapp-ai-campaigns'
import { AI_CAMPAIGN_PRESETS } from '@/src/lib/whatsapp/ai-campaign-presets'
import type {
  WhatsAppAiCampaignDTO,
  WhatsAppAiCampaignStatusDTO,
} from '@/types/whatsapp-ai-campaign'
import {
  AI_CAMPAIGN_STATUS_LABEL,
  AiCampaignStatusBadge,
  aiCampaignProgress,
  ProgressBar,
} from './ai-campaign-ui'

const FROM_SCRATCH = 'scratch'

type Filter = 'ALL' | WhatsAppAiCampaignStatusDTO

const FILTERS: Filter[] = ['ALL', 'RUNNING', 'PAUSED', 'DRAFT', 'DONE']

function CreateCampaignDialog({
  workspaceId,
  slug,
  open,
  onOpenChange,
}: {
  workspaceId: string
  slug: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const create = useCreateWhatsAppAiCampaign(workspaceId)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [presetId, setPresetId] = useState(FROM_SCRATCH)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const preset = AI_CAMPAIGN_PRESETS.find((p) => p.id === presetId)
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        objective: objective.trim() || preset?.objective,
      })
      onOpenChange(false)
      router.push(
        `/${slug}/zap/campanhas-ia/${created.id}/editar${
          preset ? `?modelo=${preset.id}` : ''
        }`,
      )
    } catch (error) {
      notify.error(error, 'Não foi possível criar a campanha')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'>
        <form onSubmit={handleSubmit} className='space-y-5'>
          <DialogHeader>
            <DialogTitle>Nova campanha de IA</DialogTitle>
            <DialogDescription>
              Dê um nome e, se quiser, comece de um modelo — dá para mudar tudo
              depois.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='campaignName'>Nome</Label>
              <Input
                id='campaignName'
                required
                maxLength={120}
                placeholder='Ex.: Cobrança de outubro'
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='campaignObjective'>Objetivo (opcional)</Label>
              <Textarea
                id='campaignObjective'
                rows={1}
                maxLength={500}
                placeholder='O que a IA deve conseguir'
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
            </div>
          </div>

          <fieldset className='space-y-2'>
            <legend className='mb-1 font-medium text-sm'>Começar de</legend>
            <div className='grid gap-2 sm:grid-cols-2'>
              {[
                {
                  id: FROM_SCRATCH,
                  name: 'Do zero',
                  description: 'Você escreve as instruções e as ações.',
                },
                ...AI_CAMPAIGN_PRESETS,
              ].map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  aria-pressed={presetId === preset.id}
                  onClick={() => setPresetId(preset.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors hover:bg-muted',
                    presetId === preset.id &&
                      'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                >
                  <p className='font-medium text-sm'>{preset.name}</p>
                  <p className='text-muted-foreground text-xs'>
                    {preset.description}
                  </p>
                </button>
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type='submit' disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Criando...' : 'Criar e configurar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CampaignCard({
  campaign,
  workspaceId,
  slug,
  canEdit,
}: {
  campaign: WhatsAppAiCampaignDTO
  workspaceId: string
  slug: string
  canEdit: boolean
}) {
  const play = usePlayWhatsAppAiCampaign(workspaceId)
  const pause = usePauseWhatsAppAiCampaign(workspaceId)
  const running = campaign.status === 'RUNNING'
  const { stats } = campaign
  const href = `/${slug}/zap/campanhas-ia/${campaign.id}`

  function handleToggle() {
    const mutation = running ? pause : play
    mutation.mutate(campaign.id, {
      onSuccess: () =>
        notify.success(running ? 'Campanha pausada' : 'Campanha iniciada'),
      onError: (error) =>
        notify.error(
          error,
          running ? 'Não foi possível pausar' : 'Não foi possível iniciar',
        ),
    })
  }

  return (
    <li className='group flex flex-col rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <Link
            href={href}
            className='line-clamp-1 font-medium hover:underline'
          >
            {campaign.name}
          </Link>
          <p className='line-clamp-2 min-h-8 text-muted-foreground text-xs'>
            {campaign.objective ??
              campaign.template?.name ??
              'Sem objetivo definido'}
          </p>
        </div>
        <AiCampaignStatusBadge status={campaign.status} />
      </div>

      <div className='mt-4 space-y-1.5'>
        <div className='flex justify-between text-muted-foreground text-xs'>
          <span>
            {stats.total - stats.pending} de {stats.total} processados
          </span>
          <span>{aiCampaignProgress(stats)}%</span>
        </div>
        <ProgressBar value={aiCampaignProgress(stats)} />
      </div>

      <dl className='mt-4 grid grid-cols-4 gap-2 text-center'>
        {[
          ['Enviados', stats.sent],
          ['Respostas', stats.replied],
          ['Deu certo', stats.success],
          ['Não deu', stats.failure],
        ].map(([label, value]) => (
          <div key={label} className='rounded-md bg-muted/50 py-1.5'>
            <dt className='text-[11px] text-muted-foreground'>{label}</dt>
            <dd className='font-semibold text-sm tabular-nums'>{value}</dd>
          </div>
        ))}
      </dl>

      {campaign.lastError ? (
        <p className='mt-3 line-clamp-2 rounded-md bg-destructive/10 px-2 py-1 text-destructive text-xs'>
          {campaign.lastError}
        </p>
      ) : null}

      <div className='mt-auto flex items-center justify-between gap-2 pt-4'>
        <span className='text-muted-foreground text-xs'>
          {campaign.lastSentAt
            ? `Último envio ${formatDistanceToNow(
                new Date(campaign.lastSentAt),
                {
                  addSuffix: true,
                  locale: ptBR,
                },
              )}`
            : 'Nenhum envio ainda'}
        </span>
        <div className='flex gap-1.5'>
          {canEdit && campaign.status !== 'DRAFT' ? (
            <Button
              size='xs'
              variant={running ? 'outline' : 'default'}
              aria-label={
                running ? `Pausar ${campaign.name}` : `Iniciar ${campaign.name}`
              }
              disabled={
                play.isPending ||
                pause.isPending ||
                (!running && campaign.problems.length > 0)
              }
              title={
                !running ? campaign.problems.join('. ') || undefined : undefined
              }
              onClick={handleToggle}
            >
              <SteelIcon icon={running ? PauseIcon : PlayIcon} size={12} />
              {running ? 'Pausar' : 'Iniciar'}
            </Button>
          ) : null}
          <Button
            size='xs'
            variant='ghost'
            nativeButton={false}
            render={
              <Link
                href={
                  campaign.status === 'DRAFT' && canEdit
                    ? `${href}/editar`
                    : href
                }
              />
            }
          >
            {campaign.status === 'DRAFT' && canEdit ? 'Continuar' : 'Abrir'}
          </Button>
        </div>
      </div>
    </li>
  )
}

/** Campanhas de IA: lista com o funil de cada uma e play/pause. */
export function WhatsappAiCampaignsPage({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const campaigns = useWhatsAppAiCampaigns(workspaceId)
  const canCreate = useCan('broadcasts', 'CREATE')
  const canEdit = useCan('broadcasts', 'EDIT')
  const [createOpen, setCreateOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (campaigns.data ?? []).filter(
      (campaign) =>
        (filter === 'ALL' || campaign.status === filter) &&
        (!term || campaign.name.toLowerCase().includes(term)),
    )
  }, [campaigns.data, filter, search])

  const running = (campaigns.data ?? []).filter((c) => c.status === 'RUNNING')

  return (
    <div className='space-y-6'>
      <section className='flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-5'>
        <div className='flex items-start gap-3'>
          <span className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
            <SteelIcon icon={AiMagicIcon} size={20} />
          </span>
          <div>
            <h1 className='font-semibold text-lg'>Campanhas de IA</h1>
            <p className='max-w-xl text-muted-foreground text-sm'>
              A IA envia um template para um grupo de contatos, conversa com
              quem responder e executa as ações que você definir — transferir,
              fechar com status, agendar retorno, chamar seu sistema.
            </p>
            {running.length > 0 ? (
              <p className='mt-1 text-primary text-xs'>
                {running.length === 1
                  ? '1 campanha enviando agora'
                  : `${running.length} campanhas enviando agora`}
              </p>
            ) : null}
          </div>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <SteelIcon icon={PlusSignIcon} size={16} />
            Nova campanha
          </Button>
        ) : null}
      </section>

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <fieldset
          className='flex flex-wrap gap-1.5'
          aria-label='Filtrar por situação'
        >
          {FILTERS.map((option) => (
            <Button
              key={option}
              size='xs'
              variant={filter === option ? 'default' : 'outline'}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {option === 'ALL' ? 'Todas' : AI_CAMPAIGN_STATUS_LABEL[option]}
            </Button>
          ))}
        </fieldset>
        <Input
          aria-label='Buscar campanha'
          placeholder='Buscar campanha'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className='max-w-xs'
        />
      </div>

      {campaigns.isLoading ? (
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {[1, 2, 3].map((key) => (
            <Skeleton key={key} className='h-56 rounded-xl' />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center'>
          <SteelIcon
            icon={AiMagicIcon}
            size={28}
            className='text-muted-foreground'
          />
          <div>
            <p className='font-medium'>
              {(campaigns.data ?? []).length === 0
                ? 'Nenhuma campanha ainda'
                : 'Nenhuma campanha com esse filtro'}
            </p>
            <p className='text-muted-foreground text-sm'>
              Crie a primeira: escolha o template, os contatos e diga à IA o que
              fazer com cada resposta.
            </p>
          </div>
          {canCreate && (campaigns.data ?? []).length === 0 ? (
            <Button onClick={() => setCreateOpen(true)}>
              <SteelIcon icon={PlusSignIcon} size={16} />
              Criar campanha
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {visible.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              workspaceId={workspaceId}
              slug={slug}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}

      <CreateCampaignDialog
        workspaceId={workspaceId}
        slug={slug}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  )
}

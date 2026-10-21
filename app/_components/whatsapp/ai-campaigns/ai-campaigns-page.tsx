'use client'

import {
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  const [presetId, setPresetId] = useState(FROM_SCRATCH)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const preset = AI_CAMPAIGN_PRESETS.find((p) => p.id === presetId)
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        objective: preset?.objective,
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
              Dê um nome e, se quiser, comece de um modelo. O objetivo e o resto
              você ajusta nos próximos passos.
            </DialogDescription>
          </DialogHeader>

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

function CampaignRow({
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
  const isDraft = campaign.status === 'DRAFT' && canEdit

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
    <TableRow>
      <TableCell className='max-w-72'>
        <Link href={href} className='block truncate hover:underline'>
          {campaign.name}
        </Link>
        <p className='truncate text-muted-foreground text-xs'>
          {campaign.objective ??
            campaign.template?.name ??
            'Sem objetivo definido'}
        </p>
        {campaign.lastError ? (
          <p className='truncate text-destructive text-xs'>
            {campaign.lastError}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        <AiCampaignStatusBadge status={campaign.status} />
      </TableCell>
      <TableCell className='min-w-40'>
        <div className='space-y-1'>
          <ProgressBar value={aiCampaignProgress(stats)} />
          <p className='text-muted-foreground text-xs'>
            {stats.total - stats.pending} de {stats.total} processados
          </p>
        </div>
      </TableCell>
      <TableCell className='text-muted-foreground text-xs tabular-nums'>
        {stats.sent} enviados · {stats.replied} respostas · {stats.success} deu
        certo · {stats.failure} não deu
      </TableCell>
      <TableCell className='text-muted-foreground text-xs'>
        {campaign.lastSentAt
          ? formatDistanceToNow(new Date(campaign.lastSentAt), {
              addSuffix: true,
              locale: ptBR,
            })
          : 'Nenhum envio ainda'}
      </TableCell>
      <TableCell>
        <div className='flex justify-end gap-1.5'>
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
            variant='outline'
            nativeButton={false}
            render={<Link href={isDraft ? `${href}/editar` : href} />}
          >
            {isDraft ? 'Continuar' : 'Abrir'}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Campanhas de IA: lista com o andamento de cada uma e play/pause. */
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

  const total = (campaigns.data ?? []).length

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h3 className='font-medium text-sm'>Campanhas de IA</h3>
          <p className='text-muted-foreground text-xs'>
            A IA envia um template a um grupo de contatos, conversa com quem
            responder e executa as ações que você definir
          </p>
        </div>
        {canCreate ? (
          <Button size='sm' onClick={() => setCreateOpen(true)}>
            <SteelIcon icon={PlusSignIcon} size={14} />
            Nova campanha
          </Button>
        ) : null}
      </div>

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

      <div className='overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Campanha</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progresso</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Último envio</TableHead>
              <TableHead className='w-40' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.isLoading
              ? [1, 2, 3].map((key) => (
                  <TableRow key={key}>
                    <TableCell colSpan={6}>
                      <Skeleton className='h-8 w-full' />
                    </TableCell>
                  </TableRow>
                ))
              : visible.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    workspaceId={workspaceId}
                    slug={slug}
                    canEdit={canEdit}
                  />
                ))}
            {!campaigns.isLoading && visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='text-muted-foreground text-sm'
                >
                  {total === 0
                    ? 'Nenhuma campanha ainda'
                    : 'Nenhuma campanha com esse filtro'}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <CreateCampaignDialog
        workspaceId={workspaceId}
        slug={slug}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  )
}

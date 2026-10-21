'use client'

import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  PlayIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  usePlayWhatsAppAiCampaign,
  useUpdateWhatsAppAiCampaign,
  useWhatsAppAiCampaign,
} from '@/src/hooks/use-whatsapp-ai-campaigns'
import { useWhatsAppBusinessHours } from '@/src/hooks/use-whatsapp-business-hours'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import {
  estimateAiCampaignDuration,
  formatDuration,
} from '@/src/lib/whatsapp/ai-campaign'
import { AI_CAMPAIGN_ACTION_KIND_LABEL } from '@/src/lib/whatsapp/ai-campaign-actions'
import type { WhatsAppAiCampaignDTO } from '@/types/whatsapp-ai-campaign'
import { AiCampaignStepAi } from './ai-campaign-step-ai'
import { AiCampaignStepContacts } from './ai-campaign-step-contacts'
import { AiCampaignStepTemplate } from './ai-campaign-step-template'
import { AiCampaignStatusBadge } from './ai-campaign-ui'

const STEPS = [
  { key: 'basics', title: 'Básico', hint: 'Nome e conexão' },
  { key: 'contacts', title: 'Contatos', hint: 'Quem recebe' },
  { key: 'template', title: 'Mensagem', hint: 'Template e variáveis' },
  { key: 'ai', title: 'IA', hint: 'Instruções e ações' },
  { key: 'review', title: 'Revisão', hint: 'Ritmo e início' },
] as const

type StepKey = (typeof STEPS)[number]['key']

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function aggressiveness(seconds: number): string {
  if (seconds <= 25) return 'Agressivo'
  if (seconds <= 45) return 'Moderado'
  return 'Cauteloso'
}

/** Which steps already have what they need (green check in the stepper). */
function stepDone(campaign: WhatsAppAiCampaignDTO, step: StepKey): boolean {
  switch (step) {
    case 'basics':
      return Boolean(campaign.name && campaign.connectionId)
    case 'contacts':
      return campaign.stats.total > 0
    case 'template':
      return (
        Boolean(campaign.templateId) &&
        !campaign.problems.some((p) => p.startsWith('Preencha as variáveis'))
      )
    case 'ai':
      return !campaign.aiReplies || campaign.instructions.trim().length > 0
    case 'review':
      return campaign.problems.length === 0
  }
}

function StepBasics({
  workspaceId,
  campaign,
  onDone,
}: {
  workspaceId: string
  campaign: WhatsAppAiCampaignDTO
  onDone: () => void
}) {
  const connections = useWhatsAppConnections(workspaceId)
  const update = useUpdateWhatsAppAiCampaign(workspaceId, campaign.id)
  const [name, setName] = useState(campaign.name)
  const [objective, setObjective] = useState(campaign.objective ?? '')
  const [connectionId, setConnectionId] = useState(campaign.connectionId)
  const locked = campaign.status === 'RUNNING'
  const metaConnections = (connections.data ?? []).filter(
    (connection) => connection.provider === 'META',
  )
  const items = metaConnections.map((connection) => ({
    value: connection.id,
    label: `${connection.label} (${connection.phoneNumber})`,
  }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      {
        name: name.trim(),
        objective: objective.trim() || null,
        ...(connectionId !== campaign.connectionId ? { connectionId } : {}),
      },
      {
        onSuccess: onDone,
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-xl space-y-4'>
      <div className='space-y-1.5'>
        <Label htmlFor='wizardName'>Nome da campanha</Label>
        <Input
          id='wizardName'
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='wizardObjective'>Objetivo</Label>
        <Textarea
          id='wizardObjective'
          rows={2}
          maxLength={500}
          placeholder='Ex.: confirmar as consultas de amanhã'
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
        <p className='text-muted-foreground text-xs'>
          A IA usa o objetivo para conduzir as conversas.
        </p>
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='wizardConnection'>Conexão (API oficial da Meta)</Label>
        <Select
          items={items}
          value={connectionId}
          disabled={locked}
          onValueChange={(value) => setConnectionId((value as string) ?? null)}
        >
          <SelectTrigger id='wizardConnection' className='w-full'>
            <SelectValue placeholder='Escolha o número que envia' />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {metaConnections.length === 0 && !connections.isLoading ? (
          <p className='text-destructive text-xs'>
            Nenhuma conexão da Meta. Campanhas usam templates aprovados, que só
            existem na API oficial — conecte em Configurações › Conexões.
          </p>
        ) : null}
        {connectionId &&
        campaign.connectionId &&
        connectionId !== campaign.connectionId ? (
          <p className='text-muted-foreground text-xs'>
            Trocar a conexão limpa o template escolhido.
          </p>
        ) : null}
      </div>
      <div className='flex justify-end'>
        <Button
          type='submit'
          disabled={!name.trim() || !connectionId || update.isPending}
        >
          {update.isPending ? 'Salvando...' : 'Salvar e continuar'}
        </Button>
      </div>
    </form>
  )
}

function StepReview({
  workspaceId,
  slug,
  campaign,
  onGoTo,
}: {
  workspaceId: string
  slug: string
  campaign: WhatsAppAiCampaignDTO
  onGoTo: (step: StepKey) => void
}) {
  const router = useRouter()
  const update = useUpdateWhatsAppAiCampaign(workspaceId, campaign.id)
  const play = usePlayWhatsAppAiCampaign(workspaceId)
  const hours = useWhatsAppBusinessHours(workspaceId)
  const [interval, setIntervalSeconds] = useState(campaign.intervalSeconds)
  const detail = `/${slug}/zap/campanhas-ia/${campaign.id}`

  useEffect(
    () => setIntervalSeconds(campaign.intervalSeconds),
    [campaign.intervalSeconds],
  )

  const estimate = formatDuration(
    estimateAiCampaignDuration(campaign.stats.pending, interval),
  )

  const PROBLEM_STEP: [string, StepKey][] = [
    ['conexão', 'basics'],
    ['Meta', 'basics'],
    ['template', 'template'],
    ['variáveis', 'template'],
    ['contatos', 'contacts'],
  ]

  function stepOf(problem: string): StepKey {
    return (
      PROBLEM_STEP.find(([needle]) => problem.includes(needle))?.[1] ?? 'basics'
    )
  }

  return (
    <div className='space-y-6'>
      {campaign.problems.length > 0 ? (
        <section className='space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4'>
          <p className='font-medium text-destructive text-sm'>
            Falta pouco para iniciar
          </p>
          <ul className='space-y-1'>
            {campaign.problems.map((problem) => (
              <li
                key={problem}
                className='flex items-center justify-between gap-2 text-sm'
              >
                <span>{problem}</span>
                <Button
                  size='xs'
                  variant='outline'
                  onClick={() => onGoTo(stepOf(problem))}
                >
                  Resolver
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className='flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm'>
          <SteelIcon
            icon={CheckmarkCircle02Icon}
            size={18}
            className='text-primary'
          />
          Tudo pronto para iniciar.
        </section>
      )}

      <dl className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <div className='rounded-lg border p-3'>
          <dt className='text-muted-foreground text-xs'>Contatos</dt>
          <dd className='font-semibold text-lg'>
            {campaign.stats.pending} a enviar
          </dd>
        </div>
        <div className='rounded-lg border p-3'>
          <dt className='text-muted-foreground text-xs'>Template</dt>
          <dd className='truncate font-semibold text-lg'>
            {campaign.template?.name ?? '—'}
          </dd>
        </div>
        <div className='rounded-lg border p-3'>
          <dt className='text-muted-foreground text-xs'>IA</dt>
          <dd className='font-semibold text-lg'>
            {campaign.aiReplies
              ? `${campaign.actions.length} ação(ões)`
              : 'Só envia'}
          </dd>
        </div>
        <div className='rounded-lg border p-3'>
          <dt className='text-muted-foreground text-xs'>Duração estimada</dt>
          <dd className='font-semibold text-lg'>{estimate}</dd>
        </div>
      </dl>

      {campaign.actions.length > 0 ? (
        <ul className='flex flex-wrap gap-1.5'>
          {campaign.actions.map((action) => (
            <li
              key={action.id}
              className='rounded-full border px-2.5 py-0.5 text-xs'
              title={action.when}
            >
              {action.label} · {AI_CAMPAIGN_ACTION_KIND_LABEL[action.kind]}
            </li>
          ))}
        </ul>
      ) : null}

      <section className='max-w-lg space-y-2'>
        <div className='flex items-center justify-between text-sm'>
          <Label htmlFor='wizardInterval'>Nível de agressividade</Label>
          <span className='text-muted-foreground text-xs'>
            {aggressiveness(interval)} · um envio a cada {interval}s
          </span>
        </div>
        <Slider
          id='wizardInterval'
          aria-label='Segundos entre envios'
          min={20}
          max={60}
          step={1}
          value={[interval]}
          onValueChange={(value) =>
            setIntervalSeconds(Array.isArray(value) ? value[0] : value)
          }
          onValueCommitted={(value) => {
            const seconds = Array.isArray(value) ? value[0] : value
            if (seconds === campaign.intervalSeconds) return
            update.mutate(
              { intervalSeconds: seconds },
              {
                onError: (error) => {
                  setIntervalSeconds(campaign.intervalSeconds)
                  notify.error(error, 'Não foi possível salvar o intervalo')
                },
              },
            )
          }}
        />
        <div className='flex justify-between text-muted-foreground text-xs'>
          <span>20s (mais agressivo)</span>
          <span>60s (mais cauteloso)</span>
        </div>
      </section>

      <p className='text-muted-foreground text-xs'>
        {hours.data?.enabled
          ? `Envios só no horário de atendimento: ${hours.data.start}–${hours.data.end} (${hours.data.days
              .map((day) => WEEKDAY[day])
              .join(', ')}). Fora dele a campanha espera e continua sozinha.`
          : 'Sem horário de atendimento configurado: a campanha envia a qualquer hora (Configurações › Atendimento).'}
      </p>

      <div className='flex flex-wrap justify-end gap-2'>
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link href={detail} />}
        >
          {campaign.status === 'DRAFT'
            ? 'Salvar como rascunho'
            : 'Ver campanha'}
        </Button>
        {campaign.status !== 'RUNNING' ? (
          <Button
            disabled={campaign.problems.length > 0 || play.isPending}
            onClick={() =>
              play.mutate(campaign.id, {
                onSuccess: () => {
                  notify.success('Campanha iniciada')
                  router.push(detail)
                },
                onError: (error) =>
                  notify.error(error, 'Não foi possível iniciar'),
              })
            }
          >
            <SteelIcon icon={PlayIcon} size={14} />
            Iniciar campanha
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Criação/edição da campanha em 5 passos, com o estado de cada um. */
export function WhatsappAiCampaignWizard({
  workspaceId,
  slug,
  campaignId,
  presetId,
}: {
  workspaceId: string
  slug: string
  campaignId: string
  presetId?: string
}) {
  const campaign = useWhatsAppAiCampaign(workspaceId, campaignId)
  const [step, setStep] = useState<StepKey>('basics')

  if (campaign.isLoading) {
    return <Skeleton className='h-96 rounded-xl' />
  }
  if (!campaign.data) {
    return (
      <p className='text-muted-foreground text-sm'>Campanha não encontrada.</p>
    )
  }

  const data = campaign.data
  const index = STEPS.findIndex((s) => s.key === step)
  const next = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)].key)

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Voltar para as campanhas'
            nativeButton={false}
            render={<Link href={`/${slug}/zap/campanhas-ia`} />}
          >
            <SteelIcon icon={ArrowLeft01Icon} size={16} />
          </Button>
          <h1 className='font-semibold text-lg'>{data.name}</h1>
          <AiCampaignStatusBadge status={data.status} />
        </div>
      </div>

      <ol className='grid gap-2 sm:grid-cols-5'>
        {STEPS.map((item, position) => {
          const done = stepDone(data, item.key)
          const active = item.key === step
          return (
            <li key={item.key}>
              <button
                type='button'
                aria-current={active ? 'step' : undefined}
                onClick={() => setStep(item.key)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted',
                  active && 'border-primary bg-primary/5 ring-1 ring-primary',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
                    done && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {done ? (
                    <SteelIcon icon={CheckmarkCircle02Icon} size={14} />
                  ) : (
                    position + 1
                  )}
                </span>
                <span className='min-w-0'>
                  <span className='block font-medium text-sm'>
                    {item.title}
                  </span>
                  <span className='block truncate text-muted-foreground text-xs'>
                    {item.hint}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <section className='rounded-xl border bg-card p-5'>
        {step === 'basics' ? (
          <StepBasics workspaceId={workspaceId} campaign={data} onDone={next} />
        ) : step === 'contacts' ? (
          <AiCampaignStepContacts
            workspaceId={workspaceId}
            campaign={data}
            onDone={next}
          />
        ) : step === 'template' ? (
          <AiCampaignStepTemplate
            workspaceId={workspaceId}
            campaign={data}
            onDone={next}
          />
        ) : step === 'ai' ? (
          <AiCampaignStepAi
            workspaceId={workspaceId}
            campaign={data}
            presetId={presetId}
            onDone={next}
          />
        ) : (
          <StepReview
            workspaceId={workspaceId}
            slug={slug}
            campaign={data}
            onGoTo={setStep}
          />
        )}
      </section>
    </div>
  )
}

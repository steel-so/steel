'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useUpdateWhatsAppUsageLimits,
  useWhatsAppUsage,
} from '@/src/hooks/use-whatsapp-usage'
import { WHATSAPP_USAGE_LIMIT_MAX } from '@/src/schemas/whatsapp-usage.schema'
import type {
  WhatsAppUsageDTO,
  WhatsAppUsageMetricDTO,
} from '@/types/whatsapp-usage'
import { useIsWorkspaceAdmin } from '../workspace/workspace-permissions'

const integer = new Intl.NumberFormat('pt-BR')

const METRICS = [
  {
    key: 'conversations',
    title: 'Conversas',
    unit: 'conversas',
    hint: 'Conversas abertas ou reabertas no mês, recebidas ou iniciadas pela equipe.',
    blocked:
      'O limite foi atingido: a equipe não pode iniciar nem reabrir conversas até o próximo mês. Conversas iniciadas pelos contatos continuam chegando.',
  },
  {
    key: 'messages',
    title: 'Mensagens enviadas',
    unit: 'mensagens',
    hint: 'Tudo o que sai pelo WhatsApp: atendimento, resposta automática da IA, transmissões e campanhas. Reações não contam.',
    blocked:
      'O limite foi atingido: os envios ficam bloqueados até o próximo mês. Mensagens recebidas continuam chegando.',
  },
] as const

function periodLabel(period: string) {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function WhatsAppUsageSection({ workspaceId }: { workspaceId: string }) {
  const { data: usage, isLoading, error } = useWhatsAppUsage(workspaceId)
  // Role resolved in the layout; outside it, falls back to the API flag.
  // The API refuses writes from non-admins either way.
  const isAdmin = useIsWorkspaceAdmin()

  if (isLoading) {
    return (
      <p className='text-muted-foreground text-sm'>Carregando consumo...</p>
    )
  }
  if (!usage) {
    return (
      <p className='text-destructive text-sm'>
        {error instanceof Error
          ? error.message
          : 'Não foi possível carregar o consumo da Comunicação.'}
      </p>
    )
  }

  return (
    <div className='grid max-w-4xl gap-6'>
      <div className='grid gap-6 md:grid-cols-2'>
        {METRICS.map((metric) => (
          <UsageCard
            key={metric.key}
            title={metric.title}
            unit={metric.unit}
            hint={metric.hint}
            blocked={metric.blocked}
            period={usage.period}
            metric={usage[metric.key]}
          />
        ))}
      </div>
      {(isAdmin ?? usage.canManage) ? (
        <LimitsForm workspaceId={workspaceId} usage={usage} />
      ) : (
        <p className='text-muted-foreground text-sm'>
          Apenas o dono e os administradores do workspace podem alterar os
          limites mensais.
        </p>
      )}
    </div>
  )
}

function UsageCard({
  title,
  unit,
  hint,
  blocked,
  period,
  metric,
}: {
  title: string
  unit: string
  hint: string
  blocked: string
  period: string
  metric: WhatsAppUsageMetricDTO
}) {
  const percent = metric.percent ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {hint} Ciclo de {periodLabel(period)}.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='font-semibold text-2xl tabular-nums'>
          {integer.format(metric.used)}
          <span className='font-normal text-muted-foreground text-sm'>
            {' '}
            {metric.limit === null
              ? `${unit} · sem limite`
              : `de ${integer.format(metric.limit)} ${unit}`}
          </span>
        </p>
        {metric.limit !== null && (
          <div
            className='h-2 w-full overflow-hidden rounded-full bg-muted'
            role='progressbar'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`Consumo do limite mensal de ${unit}`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                metric.reached
                  ? 'bg-destructive'
                  : percent >= 80
                    ? 'bg-amber-500'
                    : 'bg-primary',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        {metric.reached && (
          <p className='rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm'>
            {blocked}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

interface FormState {
  monthlyConversationLimit: string
  monthlyMessageLimit: string
}

function toForm(usage: WhatsAppUsageDTO): FormState {
  return {
    monthlyConversationLimit:
      usage.conversations.limit === null
        ? ''
        : String(usage.conversations.limit),
    monthlyMessageLimit:
      usage.messages.limit === null ? '' : String(usage.messages.limit),
  }
}

/** Empty = unlimited; `undefined` = invalid. Accepts `10.000`. */
function parseLimit(value: string): number | null | undefined {
  const digits = value.trim().replace(/[.\s]/g, '')
  if (digits === '') return null
  if (!/^\d+$/.test(digits)) return undefined
  const parsed = Number(digits)
  if (parsed < 1 || parsed > WHATSAPP_USAGE_LIMIT_MAX) return undefined
  return parsed
}

function LimitsForm({
  workspaceId,
  usage,
}: {
  workspaceId: string
  usage: WhatsAppUsageDTO
}) {
  const update = useUpdateWhatsAppUsageLimits(workspaceId)
  const [form, setForm] = useState<FormState>(() => toForm(usage))

  // Re-sync when the saved limits change (another tab, or after saving).
  useEffect(() => {
    setForm(toForm(usage))
  }, [usage])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const conversations = parseLimit(form.monthlyConversationLimit)
    const messages = parseLimit(form.monthlyMessageLimit)
    if (conversations === undefined || messages === undefined) {
      notify.error(
        new Error(
          'Informe um número inteiro maior que zero, ou deixe em branco para ilimitado.',
        ),
      )
      return
    }

    update.mutate(
      {
        monthlyConversationLimit: conversations,
        monthlyMessageLimit: messages,
      },
      {
        onSuccess: () => notify.success('Limites da Comunicação salvos'),
        onError: (error) =>
          notify.error(error, 'Não foi possível salvar os limites'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='grid gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>Limites mensais</CardTitle>
          <CardDescription>
            Deixe em branco para não limitar. Todos os membros recebem um aviso
            no inbox ao atingir 50%, 80% e 100% de cada limite. Em 100%, os
            envios e as conversas iniciadas pela equipe ficam bloqueados até o
            próximo mês; o que os contatos mandam continua chegando. Não vale
            para o WhatsApp do ServiceDesk.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='monthlyConversationLimit'>Conversas por mês</Label>
            <Input
              id='monthlyConversationLimit'
              inputMode='numeric'
              placeholder='Ilimitado'
              value={form.monthlyConversationLimit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  monthlyConversationLimit: event.target.value,
                }))
              }
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='monthlyMessageLimit'>Mensagens por mês</Label>
            <Input
              id='monthlyMessageLimit'
              inputMode='numeric'
              placeholder='Ilimitado'
              value={form.monthlyMessageLimit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  monthlyMessageLimit: event.target.value,
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button type='submit' disabled={update.isPending}>
          {update.isPending ? 'Salvando...' : 'Salvar limites'}
        </Button>
      </div>
    </form>
  )
}

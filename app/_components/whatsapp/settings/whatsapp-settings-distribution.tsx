'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppSettings,
  useWhatsAppSettings,
} from '@/src/hooks/use-whatsapp-settings'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'

type Mode = WhatsAppSettingsDTO['distributionMode']

const MAX_REMINDER_MINUTES = 1440
const MAX_OPEN_LIMIT = 500

const MODES: { value: Mode; title: string; description: string }[] = [
  {
    value: 'OFF',
    title: 'Manual',
    description:
      'As conversas ficam na fila e cada atendente escolhe quais assumir, como sempre foi.',
  },
  {
    value: 'ROUND_ROBIN',
    title: 'Rodízio',
    description:
      'Cada conversa nova vai para o próximo atendente da vez, um após o outro, em ordem. Todos recebem a mesma quantidade ao longo do tempo.',
  },
  {
    value: 'LEAST_LOADED',
    title: 'Menos ocupado',
    description:
      'A conversa vai para quem tem menos conversas abertas no momento. Em caso de empate, para quem recebeu a última há mais tempo.',
  },
]

function isWholeNumberIn(value: string, min: number, max: number): boolean {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
}

/**
 * Fila de conversas sem atendente (OWNER/ADMIN): avisos aos supervisores,
 * lembrete e distribuição automática entre os atendentes.
 */
export function WhatsappSettingsDistribution({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppSettings(workspaceId)

  const [notifyInApp, setNotifyInApp] = useState(true)
  const [notifyEmail, setNotifyEmail] = useState(false)
  const [reminder, setReminder] = useState('10')
  const [mode, setMode] = useState<Mode>('OFF')
  const [limitEnabled, setLimitEnabled] = useState(false)
  const [limit, setLimit] = useState('10')
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const [respectHours, setRespectHours] = useState(true)

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setNotifyInApp(data.unassignedAlertNotifyInApp)
    setNotifyEmail(data.unassignedAlertNotifyEmail)
    setReminder(String(data.unassignedReminderMinutes))
    setMode(data.distributionMode)
    setLimitEnabled(data.distributionMaxOpenPerAgent !== null)
    setLimit(String(data.distributionMaxOpenPerAgent ?? 10))
    setOnlyAvailable(data.distributionOnlyAvailable)
    setRespectHours(data.distributionRespectBusinessHours)
  }, [settings.data])

  if (!isAdmin) return null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isWholeNumberIn(reminder, 0, MAX_REMINDER_MINUTES)) {
      notify.error(`O lembrete deve ser de 0 a ${MAX_REMINDER_MINUTES} minutos`)
      return
    }
    if (
      mode !== 'OFF' &&
      limitEnabled &&
      !isWholeNumberIn(limit, 1, MAX_OPEN_LIMIT)
    ) {
      notify.error(`O limite deve ser de 1 a ${MAX_OPEN_LIMIT} conversas`)
      return
    }
    update.mutate(
      {
        unassignedAlertNotifyInApp: notifyInApp,
        unassignedAlertNotifyEmail: notifyEmail,
        unassignedReminderMinutes: Number(reminder),
        distributionMode: mode,
        distributionMaxOpenPerAgent:
          limitEnabled && mode !== 'OFF' ? Number(limit) : null,
        distributionOnlyAvailable: onlyAvailable,
        distributionRespectBusinessHours: respectHours,
      },
      {
        onSuccess: () => notify.success('Fila e distribuição salvas'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-lg space-y-8'>
      <section className='space-y-4'>
        <div>
          <h3 className='font-medium text-sm'>Conversas sem atendente</h3>
          <p className='text-muted-foreground text-xs'>
            Quando uma conversa chega e ninguém a assume, os supervisores são
            avisados: as pessoas escolhidas no alerta de sentimento, ou os
            proprietários e administradores. Líderes de equipe também são
            avisados das conversas da própria equipe.
          </p>
        </div>

        <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
          <p className='font-medium text-sm'>Avisar no app</p>
          <Switch
            aria-label='Avisar no app sobre conversas sem atendente'
            checked={notifyInApp}
            onCheckedChange={setNotifyInApp}
          />
        </div>
        <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
          <p className='font-medium text-sm'>Avisar por e-mail</p>
          <Switch
            aria-label='Avisar por e-mail sobre conversas sem atendente'
            checked={notifyEmail}
            onCheckedChange={setNotifyEmail}
          />
        </div>

        <div className='space-y-1.5'>
          <Label htmlFor='unassignedReminderMinutes'>
            Lembrar após quantos minutos sem atendente
          </Label>
          <Input
            id='unassignedReminderMinutes'
            type='number'
            min={0}
            max={MAX_REMINDER_MINUTES}
            step={1}
            value={reminder}
            onChange={(event) => setReminder(event.target.value)}
            className='w-40'
          />
          <p className='text-muted-foreground text-xs'>
            Um lembrete por conversa que continua sem atendente. Use 0 para
            desligar. Padrão: 10 minutos.
          </p>
        </div>
      </section>

      <section className='space-y-4'>
        <div>
          <h3 className='font-medium text-sm'>Distribuição automática</h3>
          <p className='text-muted-foreground text-xs'>
            Entrega as conversas da fila aos atendentes sem que ninguém precise
            assumir uma a uma. Quem já tem atendente, ou está sendo atendido
            pela IA, nunca é redistribuído, e uma atribuição feita por uma
            pessoa sempre vale. Vale para a equipe da conversa; sem equipe, para
            os membros do workspace com papel de membro.
          </p>
        </div>

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as Mode)}
          aria-label='Modo de distribuição'
        >
          {MODES.map((option) => (
            <Label
              key={option.value}
              className='flex cursor-pointer items-start gap-3 rounded-md border p-3'
            >
              <RadioGroupItem value={option.value} className='mt-0.5' />
              <span className='space-y-0.5'>
                <span className='block font-medium text-sm'>
                  {option.title}
                </span>
                <span className='block font-normal text-muted-foreground text-xs'>
                  {option.description}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        {mode !== 'OFF' ? (
          <div className='space-y-4'>
            <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
              <div>
                <p className='font-medium text-sm'>
                  Só para quem está disponível
                </p>
                <p className='text-muted-foreground text-xs'>
                  Atendentes marcados como ausentes não recebem conversas. Cada
                  um troca o próprio estado no menu lateral do WhatsApp.
                </p>
              </div>
              <Switch
                aria-label='Distribuir só para atendentes disponíveis'
                checked={onlyAvailable}
                onCheckedChange={setOnlyAvailable}
              />
            </div>

            <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
              <div>
                <p className='font-medium text-sm'>
                  Respeitar o horário de atendimento
                </p>
                <p className='text-muted-foreground text-xs'>
                  Fora do horário a conversa espera na fila e é distribuída
                  quando o horário abrir. Os supervisores continuam sendo
                  avisados.
                </p>
              </div>
              <Switch
                aria-label='Respeitar o horário de atendimento na distribuição'
                checked={respectHours}
                onCheckedChange={setRespectHours}
              />
            </div>

            <div className='space-y-3 rounded-md border p-3'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <p className='font-medium text-sm'>
                    Limite de conversas abertas por atendente
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Quem atingiu o limite deixa de receber até fechar alguma
                    conversa. Se todos estiverem no limite, a conversa fica na
                    fila e os supervisores são avisados.
                  </p>
                </div>
                <Switch
                  aria-label='Limitar conversas abertas por atendente'
                  checked={limitEnabled}
                  onCheckedChange={setLimitEnabled}
                />
              </div>
              {limitEnabled ? (
                <div className='space-y-1.5'>
                  <Label htmlFor='distributionMaxOpenPerAgent'>
                    Máximo de conversas abertas
                  </Label>
                  <Input
                    id='distributionMaxOpenPerAgent'
                    type='number'
                    min={1}
                    max={MAX_OPEN_LIMIT}
                    step={1}
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                    className='w-40'
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar fila e distribuição'}
      </Button>
    </form>
  )
}

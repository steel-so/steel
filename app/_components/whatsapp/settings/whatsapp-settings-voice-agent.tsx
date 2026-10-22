'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useUpdateVoiceAgentSettings,
  useVoiceAgentSettings,
  useVoiceAgentUsage,
} from '@/src/hooks/use-voice-agent'
import { useWhatsAppAssignableMembers } from '@/src/hooks/use-whatsapp-conversations'
import {
  VOICE_AGENT_MAX_CALL_SECONDS,
  VOICE_AGENT_MONTHLY_MINUTES,
  VOICE_AGENT_SILENCE_SECONDS,
  VOICE_AGENT_VOICES,
} from '@/src/schemas/voice-agent.schema'
import { WhatsappSettingsVoiceAgentRoutes } from './whatsapp-settings-voice-agent-routes'

const NO_MEMBER = 'none'
const NOTICE_MAX = 500
const INSTRUCTIONS_MAX = 2000

const VOICE_LABELS: Record<string, string> = {
  alloy: 'Alloy (neutra)',
  ash: 'Ash',
  ballad: 'Ballad',
  coral: 'Coral',
  echo: 'Echo',
  sage: 'Sage',
  shimmer: 'Shimmer',
  verse: 'Verse',
  marin: 'Marin',
  cedar: 'Cedar',
}

function wholeNumberIn(value: string, min: number, max: number): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null
}

/**
 * Atendente de voz com IA na URA (ADR 0046), só OWNER/ADMIN: liga o
 * atendimento automatizado por telefone, define o aviso falado, os limites de
 * duração e de minutos por mês, quem o atendente representa e o que ele pode
 * fazer. As filas/números e o segredo do PABX ficam logo abaixo.
 */
export function WhatsappSettingsVoiceAgent({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useVoiceAgentSettings(workspaceId, isAdmin)
  const usage = useVoiceAgentUsage(workspaceId, isAdmin)
  const members = useWhatsAppAssignableMembers(workspaceId)
  const update = useUpdateVoiceAgentSettings(workspaceId)

  const [enabled, setEnabled] = useState(false)
  const [notice, setNotice] = useState('')
  const [instructions, setInstructions] = useState('')
  const [voice, setVoice] = useState('alloy')
  const [maxCall, setMaxCall] = useState('300')
  const [monthlyMinutes, setMonthlyMinutes] = useState('300')
  const [silence, setSilence] = useState('20')
  const [runAs, setRunAs] = useState(NO_MEMBER)
  const [canOpenTickets, setCanOpenTickets] = useState(true)
  const [canLookupTickets, setCanLookupTickets] = useState(true)
  const [fallbackTarget, setFallbackTarget] = useState('')

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setEnabled(data.enabled)
    setNotice(data.noticeText ?? '')
    setInstructions(data.instructions ?? '')
    setVoice(data.voice)
    setMaxCall(String(data.maxCallSeconds))
    setMonthlyMinutes(String(data.monthlyMinutesCap))
    setSilence(String(data.silenceTimeoutSeconds))
    setRunAs(data.runAsUserId ?? NO_MEMBER)
    setCanOpenTickets(data.canOpenTickets)
    setCanLookupTickets(data.canLookupTickets)
    setFallbackTarget(data.fallbackTarget ?? '')
  }, [settings.data])

  if (!isAdmin) {
    return (
      <p className='text-muted-foreground text-sm'>
        Só administradores do workspace configuram o atendente de voz.
      </p>
    )
  }

  const memberOptions = [
    { value: NO_MEMBER, label: 'Escolha um membro' },
    ...(members.data ?? []).map((member) => ({
      value: member.id,
      label: member.name,
    })),
  ]
  const voiceOptions = VOICE_AGENT_VOICES.map((value) => ({
    value,
    label: VOICE_LABELS[value] ?? value,
  }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const maxCallSeconds = wholeNumberIn(
      maxCall,
      VOICE_AGENT_MAX_CALL_SECONDS.min,
      VOICE_AGENT_MAX_CALL_SECONDS.max,
    )
    const monthlyMinutesCap = wholeNumberIn(
      monthlyMinutes,
      VOICE_AGENT_MONTHLY_MINUTES.min,
      VOICE_AGENT_MONTHLY_MINUTES.max,
    )
    const silenceTimeoutSeconds = wholeNumberIn(
      silence,
      VOICE_AGENT_SILENCE_SECONDS.min,
      VOICE_AGENT_SILENCE_SECONDS.max,
    )
    if (maxCallSeconds === null) {
      notify.error(
        `A duração máxima vai de ${VOICE_AGENT_MAX_CALL_SECONDS.min} a ${VOICE_AGENT_MAX_CALL_SECONDS.max} segundos`,
      )
      return
    }
    if (monthlyMinutesCap === null) {
      notify.error('Informe o teto de minutos por mês (número inteiro)')
      return
    }
    if (silenceTimeoutSeconds === null) {
      notify.error(
        `O silêncio tolerado vai de ${VOICE_AGENT_SILENCE_SECONDS.min} a ${VOICE_AGENT_SILENCE_SECONDS.max} segundos`,
      )
      return
    }
    if (enabled && runAs === NO_MEMBER) {
      notify.error('Escolha em nome de quem o atendente age')
      return
    }
    update.mutate(
      {
        enabled,
        noticeText: notice.trim() || null,
        instructions: instructions.trim() || null,
        voice: voice as (typeof VOICE_AGENT_VOICES)[number],
        maxCallSeconds,
        monthlyMinutesCap,
        silenceTimeoutSeconds,
        runAsUserId: runAs === NO_MEMBER ? null : runAs,
        canOpenTickets,
        canLookupTickets,
        fallbackTarget: fallbackTarget.trim() || null,
      },
      {
        onSuccess: () => notify.success('Atendente de voz salvo'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  const data = settings.data
  const percent =
    usage.data && usage.data.minutesCap > 0
      ? Math.min(100, (usage.data.minutesUsed / usage.data.minutesCap) * 100)
      : 0

  return (
    <section className='max-w-2xl space-y-6'>
      <form onSubmit={handleSubmit} className='space-y-4'>
        <div>
          <h2 className='font-semibold text-base'>Atendente de voz (URA)</h2>
          <p className='text-muted-foreground text-sm'>
            Atende as ligações recebidas nas filas e números que você escolher,
            identifica o contato, abre ou consulta chamados e passa para uma
            pessoa quando precisar. Desligado por padrão.
          </p>
        </div>

        {data && !data.serverReady ? (
          <Alert>
            <AlertTitle>Servidor ainda não está pronto</AlertTitle>
            <AlertDescription>
              Falta a chave da OpenAI ou a porta do AudioSocket no servidor.
              Peça ao time de TI para seguir o runbook do atendente de voz. Você
              pode salvar as configurações enquanto isso.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
          <div>
            <p className='font-medium text-sm'>Ligar o atendente de voz</p>
            <p className='text-muted-foreground text-xs'>
              Só vale para as filas e números cadastrados abaixo. Falar com uma
              IA por telefone é tratamento de dado pessoal (LGPD): o aviso
              falado no começo é obrigatório e fica registrado em cada ligação.
            </p>
          </div>
          <Switch
            aria-label='Ligar o atendente de voz'
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {usage.data ? (
          <div className='space-y-1.5 rounded-md border p-3'>
            <div className='flex items-center justify-between text-sm'>
              <span className='font-medium'>Minutos neste mês</span>
              <span className='text-muted-foreground'>
                {usage.data.minutesUsed} de {usage.data.minutesCap} min ·{' '}
                {usage.data.calls}{' '}
                {usage.data.calls === 1 ? 'ligação' : 'ligações'}
              </span>
            </div>
            <div
              role='progressbar'
              aria-label='Minutos do atendente de voz neste mês'
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
              className='h-2 overflow-hidden rounded-full bg-muted'
            >
              <div
                className='h-full rounded-full bg-primary'
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className='text-muted-foreground text-xs'>
              O custo entra no uso de IA do workspace (Atendente de voz) e conta
              na cota mensal.
            </p>
          </div>
        ) : null}

        <div className='space-y-1.5'>
          <Label htmlFor='voiceAgentNotice'>Aviso falado no começo</Label>
          <Textarea
            id='voiceAgentNotice'
            value={notice}
            maxLength={NOTICE_MAX}
            rows={3}
            placeholder={data?.effectiveNotice}
            onChange={(event) => setNotice(event.target.value)}
          />
          <p className='text-muted-foreground text-xs'>
            Falado palavra por palavra antes de qualquer outra coisa. Em branco,
            usa o texto padrão (mostrado acima).
          </p>
        </div>

        <div className='space-y-1.5'>
          <Label htmlFor='voiceAgentInstructions'>
            Orientações da empresa (opcional)
          </Label>
          <Textarea
            id='voiceAgentInstructions'
            value={instructions}
            maxLength={INSTRUCTIONS_MAX}
            rows={4}
            placeholder='Ex.: Somos uma operadora de telecom. Horário de atendimento: 8h às 18h. Para segunda via de boleto, transfira para o financeiro.'
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='voiceAgentRunAs'>O atendente age em nome de</Label>
            <Select
              items={memberOptions}
              value={runAs}
              onValueChange={(value) => setRunAs(value ?? NO_MEMBER)}
            >
              <SelectTrigger id='voiceAgentRunAs' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {memberOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              Vale a permissão dessa pessoa: o chamado aberto pelo atendente sai
              no nome dela. Prefira uma conta de serviço.
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='voiceAgentVoice'>Voz</Label>
            <Select
              items={voiceOptions}
              value={voice}
              onValueChange={(value) => setVoice(value ?? 'alloy')}
            >
              <SelectTrigger id='voiceAgentVoice' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {voiceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='grid gap-4 sm:grid-cols-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='voiceAgentMaxCall'>Duração máxima (s)</Label>
            <Input
              id='voiceAgentMaxCall'
              type='number'
              min={VOICE_AGENT_MAX_CALL_SECONDS.min}
              max={VOICE_AGENT_MAX_CALL_SECONDS.max}
              step={1}
              value={maxCall}
              onChange={(event) => setMaxCall(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='voiceAgentMonthly'>Teto de minutos por mês</Label>
            <Input
              id='voiceAgentMonthly'
              type='number'
              min={VOICE_AGENT_MONTHLY_MINUTES.min}
              max={VOICE_AGENT_MONTHLY_MINUTES.max}
              step={1}
              value={monthlyMinutes}
              onChange={(event) => setMonthlyMinutes(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='voiceAgentSilence'>Silêncio tolerado (s)</Label>
            <Input
              id='voiceAgentSilence'
              type='number'
              min={VOICE_AGENT_SILENCE_SECONDS.min}
              max={VOICE_AGENT_SILENCE_SECONDS.max}
              step={1}
              value={silence}
              onChange={(event) => setSilence(event.target.value)}
            />
          </div>
        </div>
        <p className='-mt-2 text-muted-foreground text-xs'>
          Ao chegar na duração máxima, no teto do mês ou no silêncio, a ligação
          é passada para uma pessoa.
        </p>

        <div className='space-y-1.5'>
          <Label htmlFor='voiceAgentFallback'>
            Ramal ou fila que atende uma pessoa
          </Label>
          <Input
            id='voiceAgentFallback'
            value={fallbackTarget}
            maxLength={40}
            placeholder='Ex.: 200 ou suporte'
            onChange={(event) => setFallbackTarget(event.target.value)}
            className='max-w-xs'
          />
          <p className='text-muted-foreground text-xs'>
            Usado em erro, silêncio, limite de tempo ou quando o cliente pede
            uma pessoa. Cada fila ou número pode ter o seu. Sem destino, o
            atendente se despede e encerra.
          </p>
        </div>

        <fieldset className='space-y-2'>
          <legend className='mb-1 font-medium text-sm'>
            O que o atendente pode fazer
          </legend>
          <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
            <div>
              <p className='font-medium text-sm'>Abrir chamado</p>
              <p className='text-muted-foreground text-xs'>
                No máximo um por ligação, só depois de o cliente confirmar por
                voz.
              </p>
            </div>
            <Switch
              aria-label='Abrir chamado'
              checked={canOpenTickets}
              onCheckedChange={setCanOpenTickets}
            />
          </div>
          <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
            <div>
              <p className='font-medium text-sm'>Consultar chamado</p>
              <p className='text-muted-foreground text-xs'>
                Só chamados do próprio telefone de quem ligou: código, título,
                fase e prazo.
              </p>
            </div>
            <Switch
              aria-label='Consultar chamado'
              checked={canLookupTickets}
              onCheckedChange={setCanLookupTickets}
            />
          </div>
        </fieldset>

        <Button type='submit' disabled={update.isPending || settings.isLoading}>
          {update.isPending ? 'Salvando...' : 'Salvar atendente de voz'}
        </Button>
      </form>

      <WhatsappSettingsVoiceAgentRoutes workspaceId={workspaceId} />
    </section>
  )
}

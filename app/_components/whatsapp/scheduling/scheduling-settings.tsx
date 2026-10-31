'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppFlows } from '@/src/hooks/use-whatsapp-flows'
import {
  useUpdateWhatsAppSchedulingSettings,
  useWhatsAppSchedulingSettings,
} from '@/src/hooks/use-whatsapp-scheduling'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import { SimpleSelect } from '../chatbots/chatbot-select'

const NONE = '__none'

const REMINDER_OPTIONS = [
  { value: '1440', label: '24 horas antes' },
  { value: '720', label: '12 horas antes' },
  { value: '120', label: '2 horas antes' },
  { value: '60', label: '1 hora antes' },
]

/**
 * Agendamento (Z10), só OWNER/ADMIN. Nasce desligado: a confirmação e o
 * lembrete saem por templates aprovados pela Meta, que o dono cria antes.
 */
export function SchedulingSettings({ workspaceId }: { workspaceId: string }) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppSchedulingSettings(workspaceId)
  const update = useUpdateWhatsAppSchedulingSettings(workspaceId)
  const connections = useWhatsAppConnections(workspaceId)
  const templates = useWhatsAppTemplates(workspaceId)
  const flows = useWhatsAppFlows(workspaceId)

  const [enabled, setEnabled] = useState(false)
  const [connectionId, setConnectionId] = useState('')
  const [confirmationId, setConfirmationId] = useState(NONE)
  const [reminderId, setReminderId] = useState(NONE)
  const [offset, setOffset] = useState('1440')
  const [slotMinutes, setSlotMinutes] = useState('30')
  const [notice, setNotice] = useState('60')
  const [daysAhead, setDaysAhead] = useState('30')
  const [flowId, setFlowId] = useState(NONE)

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setEnabled(data.enabled)
    setConnectionId(data.connectionId ?? '')
    setConfirmationId(data.confirmationTemplateId ?? NONE)
    setReminderId(data.reminderTemplateId ?? NONE)
    setOffset(String(data.reminderOffsets[0] ?? 1440))
    setSlotMinutes(String(data.slotMinutes))
    setNotice(String(data.minNoticeMinutes))
    setDaysAhead(String(data.maxDaysAhead))
    setFlowId(data.bookingFlowId ?? NONE)
  }, [settings.data])

  if (!isAdmin) {
    return (
      <p className='text-muted-foreground text-sm'>
        Só administradores configuram a agenda.
      </p>
    )
  }

  const approved = (templates.data ?? [])
    .filter(
      (template) =>
        template.status === 'APPROVED' &&
        (!connectionId || template.connectionId === connectionId),
    )
    .map((template) => ({ value: template.id, label: template.name }))
  const templateOptions = [{ value: NONE, label: 'Nenhum' }, ...approved]
  const flowOptions = [
    { value: NONE, label: 'Nenhum' },
    ...(flows.data ?? [])
      .filter((flow) => flow.sendable)
      .map((flow) => ({ value: flow.id, label: flow.name })),
  ]
  const asNullable = (value: string) => (value === NONE ? null : value)
  const asInt = (value: string, fallback: number) =>
    Number.parseInt(value, 10) || fallback

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      {
        enabled,
        connectionId: connectionId || null,
        confirmationTemplateId: asNullable(confirmationId),
        reminderTemplateId: asNullable(reminderId),
        reminderOffsets: [asInt(offset, 1440)],
        slotMinutes: asInt(slotMinutes, 30),
        minNoticeMinutes: Number.parseInt(notice, 10) || 0,
        maxDaysAhead: asInt(daysAhead, 30),
        bookingFlowId: asNullable(flowId),
      },
      {
        onSuccess: () => notify.success('Configuração da agenda salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-xl space-y-4'>
      <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
        <div>
          <p className='font-medium text-sm'>Agendamento pelo WhatsApp</p>
          <p className='text-muted-foreground text-xs'>
            Liga a agenda de serviços e profissionais, a confirmação e os
            lembretes por mensagem.
          </p>
        </div>
        <Switch
          aria-label='Agendamento pelo WhatsApp'
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      <div className='space-y-1.5'>
        <Label>Conexão do WhatsApp</Label>
        <SimpleSelect
          ariaLabel='Conexão do WhatsApp'
          value={connectionId}
          placeholder='Escolha uma conexão da API oficial'
          options={(connections.data ?? [])
            .filter((connection) => connection.provider === 'META')
            .map((connection) => ({
              value: connection.id,
              label: `${connection.label} (${connection.phoneNumber})`,
            }))}
          onChange={setConnectionId}
        />
      </div>

      <div className='space-y-1.5'>
        <Label>Template de confirmação</Label>
        <SimpleSelect
          ariaLabel='Template de confirmação'
          value={confirmationId}
          options={templateOptions}
          onChange={setConfirmationId}
        />
        <p className='text-muted-foreground text-xs'>
          Variáveis do template, nesta ordem: {'{{1}}'} nome do cliente,{' '}
          {'{{2}}'} serviço, {'{{3}}'} data e hora, {'{{4}}'} profissional.
          Crie-o na aba Templates e espere a aprovação da Meta. Botões
          "Confirmar" e "Cancelar" também funcionam.
        </p>
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-1.5'>
          <Label>Template de lembrete</Label>
          <SimpleSelect
            ariaLabel='Template de lembrete'
            value={reminderId}
            options={templateOptions}
            onChange={setReminderId}
          />
        </div>
        <div className='space-y-1.5'>
          <Label>Quando lembrar</Label>
          <SimpleSelect
            ariaLabel='Quando lembrar'
            value={offset}
            options={REMINDER_OPTIONS}
            onChange={setOffset}
          />
        </div>
      </div>

      <div className='grid grid-cols-3 gap-3'>
        <div className='space-y-1.5'>
          <Label htmlFor='slotMinutes'>Grade (min)</Label>
          <Input
            id='slotMinutes'
            type='number'
            min={5}
            value={slotMinutes}
            onChange={(event) => setSlotMinutes(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='minNotice'>Antecedência (min)</Label>
          <Input
            id='minNotice'
            type='number'
            min={0}
            value={notice}
            onChange={(event) => setNotice(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='daysAhead'>Agenda aberta (dias)</Label>
          <Input
            id='daysAhead'
            type='number'
            min={1}
            max={180}
            value={daysAhead}
            onChange={(event) => setDaysAhead(event.target.value)}
          />
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label>Formulário de agendamento (Flow)</Label>
        <SimpleSelect
          ariaLabel='Formulário de agendamento'
          value={flowId}
          options={flowOptions}
          onChange={setFlowId}
        />
        <p className='text-muted-foreground text-xs'>
          Crie um formulário com o modelo "Agendamento" e deixe os títulos das
          opções de serviço iguais aos nomes cadastrados aqui. A resposta marca
          o primeiro horário livre do dia e período escolhidos.
        </p>
      </div>

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar agenda'}
      </Button>
    </form>
  )
}

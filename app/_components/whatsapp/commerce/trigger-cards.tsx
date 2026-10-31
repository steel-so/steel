'use client'

import { useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppCommerceSettings,
  useUpsertWhatsAppEcomTrigger,
  useWhatsAppCommerceSettings,
  useWhatsAppEcomTriggers,
} from '@/src/hooks/use-whatsapp-commerce'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import { STORE_VARIABLE_TOKENS } from '@/src/lib/ecommerce/normalize'
import type {
  WhatsAppEcomTriggerDTO,
  WhatsAppEcomTriggerKindDTO,
} from '@/types/whatsapp-commerce'
import { SimpleSelect } from '../chatbots/chatbot-select'

const KIND_COPY: Record<
  WhatsAppEcomTriggerKindDTO,
  { title: string; help: string; delayLabel: string }
> = {
  ABANDONED_CART: {
    title: 'Carrinho abandonado',
    help: 'Lembra o cliente que deixou itens no carrinho. Se ele comprar antes do envio, a mensagem é cancelada.',
    delayLabel: 'Esperar após o abandono (minutos)',
  },
  ORDER_SHIPPED: {
    title: 'Pedido enviado',
    help: 'Avisa que o pedido saiu para entrega, com o código de rastreio.',
    delayLabel: 'Esperar após o envio (minutos)',
  },
  POST_PURCHASE: {
    title: 'Pós-compra',
    help: 'Pede avaliação ou oferece algo depois que o pedido foi entregue.',
    delayLabel: 'Esperar após a entrega (minutos)',
  },
}

function TriggerCard({
  workspaceId,
  trigger,
  canEdit,
}: {
  workspaceId: string
  trigger: WhatsAppEcomTriggerDTO
  canEdit: boolean
}) {
  const copy = KIND_COPY[trigger.kind]
  const templates = useWhatsAppTemplates(workspaceId)
  const save = useUpsertWhatsAppEcomTrigger(workspaceId)
  const [enabled, setEnabled] = useState(trigger.enabled)
  const [templateId, setTemplateId] = useState(trigger.templateId ?? '')
  const [delay, setDelay] = useState(String(trigger.delayMinutes))
  const [variables, setVariables] = useState(trigger.variables.join('\n'))

  useEffect(() => {
    setEnabled(trigger.enabled)
    setTemplateId(trigger.templateId ?? '')
    setDelay(String(trigger.delayMinutes))
    setVariables(trigger.variables.join('\n'))
  }, [trigger])

  const approved = (templates.data ?? []).filter(
    (template) => template.status === 'APPROVED',
  )

  function submit() {
    save.mutate(
      {
        kind: trigger.kind,
        data: {
          enabled,
          templateId: templateId || null,
          delayMinutes: Math.max(0, Number.parseInt(delay, 10) || 0),
          variables: variables
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        },
      },
      {
        onSuccess: () => notify.success(`${copy.title}: gatilho salvo`),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <section className='space-y-3 rounded-md border p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h3 className='font-medium'>{copy.title}</h3>
          <p className='text-muted-foreground text-xs'>{copy.help}</p>
        </div>
        <Switch
          aria-label={`Gatilho ${copy.title}`}
          checked={enabled}
          disabled={!canEdit}
          onCheckedChange={setEnabled}
        />
      </div>
      <div className='space-y-1.5'>
        <Label>Template aprovado</Label>
        <SimpleSelect
          ariaLabel={`Template de ${copy.title}`}
          value={templateId}
          placeholder={
            approved.length === 0
              ? 'Nenhum template aprovado'
              : 'Escolha o template'
          }
          disabled={!canEdit}
          options={approved.map((template) => ({
            value: template.id,
            label: `${template.name} (${template.language})`,
          }))}
          onChange={setTemplateId}
        />
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor={`delay-${trigger.kind}`}>{copy.delayLabel}</Label>
        <Input
          id={`delay-${trigger.kind}`}
          type='number'
          min={0}
          className='w-40'
          value={delay}
          disabled={!canEdit}
          onChange={(event) => setDelay(event.target.value)}
        />
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor={`vars-${trigger.kind}`}>
          Variáveis do template (uma por linha, na ordem de {'{{1}}'}, {'{{2}}'}
          ...)
        </Label>
        <Textarea
          id={`vars-${trigger.kind}`}
          rows={3}
          value={variables}
          disabled={!canEdit}
          placeholder='{nome}'
          onChange={(event) => setVariables(event.target.value)}
        />
        <p className='text-muted-foreground text-xs'>
          Disponíveis:{' '}
          {STORE_VARIABLE_TOKENS.map((item) => `{${item.token}}`).join(', ')}
        </p>
      </div>
      {canEdit ? (
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Salvando...' : 'Salvar gatilho'}
        </Button>
      ) : null}
    </section>
  )
}

/** Gatilhos de e-commerce (Z9): chave geral, frequência e um cartão por tipo. */
export function TriggerCards({ workspaceId }: { workspaceId: string }) {
  const canEdit = useIsPrivileged()
  const triggers = useWhatsAppEcomTriggers(workspaceId)
  const settings = useWhatsAppCommerceSettings(workspaceId)
  const update = useUpdateWhatsAppCommerceSettings(workspaceId)
  const [throttle, setThrottle] = useState('24')

  useEffect(() => {
    if (settings.data) setThrottle(String(settings.data.throttleHours))
  }, [settings.data])

  return (
    <div className='space-y-4'>
      <section className='max-w-xl space-y-3 rounded-md border p-4'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <h3 className='font-medium'>Mensagens automáticas das lojas</h3>
            <p className='text-muted-foreground text-xs'>
              Chave geral. Desligada, as lojas conectadas não disparam nada.
              Quem pediu para sair das transmissões não recebe.
            </p>
          </div>
          <Switch
            aria-label='Mensagens automáticas das lojas'
            checked={settings.data?.triggersEnabled ?? false}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(triggersEnabled) =>
              update.mutate(
                { triggersEnabled },
                {
                  onError: (error) =>
                    notify.error(error, 'Não foi possível atualizar'),
                },
              )
            }
          />
        </div>
        <div className='flex items-end gap-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='throttleHours'>
              Intervalo mínimo entre mensagens ao mesmo cliente (horas)
            </Label>
            <Input
              id='throttleHours'
              type='number'
              min={0}
              max={720}
              className='w-32'
              value={throttle}
              disabled={!canEdit}
              onChange={(event) => setThrottle(event.target.value)}
            />
          </div>
          {canEdit ? (
            <Button
              variant='outline'
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { throttleHours: Number.parseInt(throttle, 10) || 0 },
                  {
                    onSuccess: () => notify.success('Intervalo salvo'),
                    onError: (error) =>
                      notify.error(error, 'Não foi possível salvar'),
                  },
                )
              }
            >
              Salvar
            </Button>
          ) : null}
        </div>
      </section>

      <div className='grid gap-4 lg:grid-cols-3'>
        {triggers.data?.map((trigger) => (
          <TriggerCard
            key={trigger.kind}
            workspaceId={workspaceId}
            trigger={trigger}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  )
}

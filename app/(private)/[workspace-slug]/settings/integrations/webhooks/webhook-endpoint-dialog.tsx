'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { CreateWebhookEndpointSchema } from '@/src/schemas/webhook.schema'
import type { WebhookEndpointDTO } from '@/types/webhook'
import { Field } from '../integration-kit'
import { webhookEventGroups } from './webhook-format'

/**
 * Create / edit an endpoint: URL, description and the events (grouped by
 * module, or "Todos os eventos"). Validated with the same Zod schema as the
 * API before sending.
 */

export interface WebhookEndpointFormValue {
  url: string
  description: string
  events: string[]
}

const GROUPS = webhookEventGroups()

export function WebhookEndpointDialog({
  open,
  onOpenChange,
  endpoint,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null`: creating. */
  endpoint: WebhookEndpointDTO | null
  pending: boolean
  onSubmit: (value: WebhookEndpointFormValue) => void
}) {
  const formId = useId()
  const [url, setUrl] = useState(endpoint?.url ?? '')
  const [description, setDescription] = useState(endpoint?.description ?? '')
  const [events, setEvents] = useState<string[]>(endpoint?.events ?? ['*'])
  const [error, setError] = useState<string | null>(null)
  const all = events.includes('*')

  const toggle = (type: string, checked: boolean) => {
    setEvents((current) => {
      const base = current.filter((item) => item !== '*')
      return checked
        ? Array.from(new Set([...base, type]))
        : base.filter((item) => item !== type)
    })
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = CreateWebhookEndpointSchema.safeParse({
      url,
      description: description || undefined,
      events,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    setError(null)
    onSubmit({
      url: parsed.data.url,
      description: parsed.data.description ?? '',
      events: parsed.data.events,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <form id={formId} onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>
              {endpoint ? 'Editar webhook' : 'Novo webhook'}
            </DialogTitle>
            <DialogDescription>
              O Steel envia um POST JSON assinado para esta URL a cada evento
              escolhido.
            </DialogDescription>
          </DialogHeader>

          <Field
            id={`${formId}-url`}
            label='URL do endpoint'
            hint='Só HTTPS, num endereço público. Redirecionamentos não são seguidos.'
          >
            <Input
              id={`${formId}-url`}
              type='url'
              inputMode='url'
              placeholder='https://erp.suaempresa.com.br/steel'
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoComplete='off'
              required
            />
          </Field>

          <Field id={`${formId}-description`} label='Descrição (opcional)'>
            <Input
              id={`${formId}-description`}
              placeholder='ERP financeiro'
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <fieldset className='flex min-w-0 flex-col gap-3'>
            <legend className='mb-2 text-xs font-medium text-muted-foreground'>
              Eventos
            </legend>
            <Label className='flex items-start gap-2 font-normal'>
              <Checkbox
                checked={all}
                onCheckedChange={(checked) => setEvents(checked ? ['*'] : [])}
              />
              <span className='min-w-0'>
                <span className='block font-medium'>Todos os eventos</span>
                <span className='block text-xs text-muted-foreground'>
                  Inclui os tipos que o Steel passar a enviar no futuro.
                </span>
              </span>
            </Label>
            {GROUPS.map((group) => (
              <div key={group.module} className='flex min-w-0 flex-col gap-2'>
                <span className='text-xs font-semibold text-foreground'>
                  {group.label}
                </span>
                {group.events.map((item) => (
                  <Label
                    key={item.type}
                    className='flex items-start gap-2 font-normal'
                  >
                    <Checkbox
                      checked={all || events.includes(item.type)}
                      disabled={all}
                      onCheckedChange={(checked) =>
                        toggle(item.type, checked === true)
                      }
                    />
                    <span className='min-w-0'>
                      <span className='block break-words'>
                        {item.description}
                      </span>
                      <code className='block break-all text-[11px] text-muted-foreground'>
                        {item.type}
                      </code>
                    </span>
                  </Label>
                ))}
              </div>
            ))}
          </fieldset>

          {error ? (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={pending}>
              {endpoint ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

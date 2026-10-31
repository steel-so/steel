'use client'

import { PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  type AiProcedureInput,
  useAiProcedureCatalog,
  useCreateAiProcedure,
  useUpdateAiProcedure,
} from '@/src/hooks/use-ai-procedures'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'
import type { AiProcedureDTO } from '@/types/ai-procedure'
import {
  blankStep,
  nextStepKey,
  PROCEDURE_STATUS_LABEL,
} from './ai-procedure-labels'
import { AiProcedureStepForm } from './ai-procedure-step-form'

function initialState(procedure: AiProcedureDTO | undefined): AiProcedureInput {
  return {
    name: procedure?.name ?? '',
    description: procedure?.description ?? null,
    whenToUse: procedure?.whenToUse ?? '',
    status: procedure?.status ?? 'DRAFT',
    steps: procedure?.steps ?? [
      blankStep('COLLECT', 'passo_1', 'Pedir o dado ao cliente'),
    ],
    maxAttempts: procedure?.maxAttempts ?? 3,
    handoffMessage: procedure?.handoffMessage ?? null,
    whatsappEnabled: procedure?.whatsappEnabled ?? true,
    agentIds: procedure?.agentIds ?? [],
  }
}

/**
 * Procedure form (A5): the natural-language runbook as an ordered list of
 * steps with conditions. The engine runs them strictly in this order.
 */
export function AiProcedureEditor({
  workspaceId,
  slug,
  procedure,
  canManage,
}: {
  workspaceId: string
  slug: string
  procedure?: AiProcedureDTO
  canManage: boolean
}) {
  const router = useRouter()
  const catalog = useAiProcedureCatalog(workspaceId)
  const create = useCreateAiProcedure(workspaceId)
  const update = useUpdateAiProcedure(workspaceId, procedure?.id ?? '')
  const [form, setForm] = useState<AiProcedureInput>(() =>
    initialState(procedure),
  )
  const [changeNote, setChangeNote] = useState('')
  const disabled = !canManage || create.isPending || update.isPending

  const set = <K extends keyof AiProcedureInput>(
    key: K,
    value: AiProcedureInput[K],
  ) => setForm((current) => ({ ...current, [key]: value }))

  const setStep = (index: number, next: ProcedureStep) =>
    set(
      'steps',
      form.steps.map((step, i) => (i === index ? next : step)),
    )
  const moveStep = (index: number, delta: -1 | 1) => {
    const steps = form.steps.slice()
    const target = index + delta
    if (target < 0 || target >= steps.length) return
    ;[steps[index], steps[target]] = [steps[target], steps[index]]
    set('steps', steps)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const payload: AiProcedureInput = {
      ...form,
      description: form.description?.trim() || null,
      handoffMessage: form.handoffMessage?.trim() || null,
      ...(procedure && { changeNote: changeNote.trim() || null }),
    }
    if (procedure) {
      update.mutate(payload, {
        onSuccess: () => {
          notify.success('Procedimento salvo.')
          setChangeNote('')
        },
        onError: notify.error,
      })
      return
    }
    create.mutate(payload, {
      onSuccess: (created) => {
        notify.success('Procedimento criado.')
        router.push(`/${slug}/ai/procedures/${created.id}`)
      },
      onError: notify.error,
    })
  }

  return (
    <form onSubmit={submit} className='space-y-6'>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='procedure-name'>Nome</FieldLabel>
          <Input
            id='procedure-name'
            value={form.name}
            maxLength={80}
            required
            disabled={disabled}
            placeholder='Ex.: Segunda via de boleto'
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='procedure-when'>Quando usar</FieldLabel>
          <Textarea
            id='procedure-when'
            rows={2}
            maxLength={500}
            required
            value={form.whenToUse}
            disabled={disabled}
            placeholder='Ex.: O cliente pede a segunda via ou o código de barras de um boleto'
            onChange={(e) => set('whenToUse', e.target.value)}
          />
          <FieldDescription>
            A IA lê este texto para decidir se o procedimento serve para o
            pedido do cliente.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='procedure-description'>
            Descrição (opcional)
          </FieldLabel>
          <Input
            id='procedure-description'
            value={form.description ?? ''}
            maxLength={500}
            disabled={disabled}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
      </FieldGroup>

      <section className='space-y-3'>
        <div>
          <h2 className='font-medium text-sm'>Passos</h2>
          <p className='text-muted-foreground text-sm'>
            O sistema executa na ordem e não deixa a IA pular nem reordenar. Um
            passo obrigatório que falha passa a conversa para um atendente.
          </p>
        </div>
        <ol className='space-y-3'>
          {form.steps.map((step, index) => (
            <AiProcedureStepForm
              key={step.key}
              step={step}
              index={index}
              total={form.steps.length}
              catalog={catalog.data}
              disabled={disabled}
              onChange={(next) => setStep(index, next)}
              onMove={(delta) => moveStep(index, delta)}
              onRemove={() =>
                set(
                  'steps',
                  form.steps.filter((_, i) => i !== index),
                )
              }
            />
          ))}
        </ol>
        <Button
          type='button'
          variant='outline'
          disabled={disabled || form.steps.length >= 30}
          onClick={() =>
            set('steps', [
              ...form.steps,
              blankStep('MESSAGE', nextStepKey(form.steps)),
            ])
          }
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Adicionar passo
        </Button>
      </section>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='procedure-attempts'>
            Tentativas por dado pedido
          </FieldLabel>
          <Input
            id='procedure-attempts'
            type='number'
            min={1}
            max={5}
            className='w-24'
            value={form.maxAttempts}
            disabled={disabled}
            onChange={(e) => set('maxAttempts', Number(e.target.value) || 1)}
          />
          <FieldDescription>
            Depois dessas tentativas com valor inválido, um atendente assume.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='procedure-handoff'>
            Mensagem ao transferir para um atendente
          </FieldLabel>
          <Textarea
            id='procedure-handoff'
            rows={2}
            maxLength={1000}
            value={form.handoffMessage ?? ''}
            disabled={disabled}
            placeholder='Vou te transferir para um de nossos atendentes, só um momento.'
            onChange={(e) => set('handoffMessage', e.target.value)}
          />
        </Field>
      </FieldGroup>

      <FieldGroup>
        <Field>
          <FieldLabel>Situação</FieldLabel>
          <Select
            items={Object.entries(PROCEDURE_STATUS_LABEL).map(
              ([value, label]) => ({ value, label }),
            )}
            value={form.status}
            disabled={disabled}
            onValueChange={(next) =>
              next && set('status', next as AiProcedureInput['status'])
            }
          >
            <SelectTrigger aria-label='Situação' className='w-full sm:w-56'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROCEDURE_STATUS_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Só procedimentos ativos são oferecidos à IA.
          </FieldDescription>
        </Field>
        <label className='flex items-center gap-2 text-sm'>
          <Switch
            checked={form.whatsappEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => set('whatsappEnabled', checked)}
          />
          Disponível na resposta automática do WhatsApp
        </label>
        <Field>
          <FieldLabel>Agentes que podem iniciar</FieldLabel>
          {(catalog.data?.agents ?? []).length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              Nenhum agente no workspace.
            </p>
          ) : (
            <div className='grid gap-2 sm:grid-cols-2'>
              {catalog.data?.agents.map((agent) => (
                <label key={agent.id} className='flex items-center gap-2 text-sm'>
                  <Switch
                    checked={form.agentIds.includes(agent.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      set(
                        'agentIds',
                        checked
                          ? [...form.agentIds, agent.id]
                          : form.agentIds.filter((id) => id !== agent.id),
                      )
                    }
                  />
                  {agent.name}
                </label>
              ))}
            </div>
          )}
        </Field>
      </FieldGroup>

      {procedure ? (
        <Field>
          <FieldLabel htmlFor='procedure-note'>
            O que mudou (opcional)
          </FieldLabel>
          <Input
            id='procedure-note'
            value={changeNote}
            maxLength={300}
            disabled={disabled}
            placeholder='Entra no histórico de versões'
            onChange={(e) => setChangeNote(e.target.value)}
          />
        </Field>
      ) : null}

      {canManage ? (
        <div className='flex justify-end'>
          <Button type='submit' disabled={disabled}>
            {procedure ? 'Salvar' : 'Criar procedimento'}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { EmailSenderPicker } from '@/app/_components/crm/email-sender-picker'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateCrmCadence,
  useUpdateCrmCadence,
} from '@/src/hooks/use-crm-cadences'
import { useCrmCampaignOptions } from '@/src/hooks/use-crm-campaigns'
import { CADENCE_MERGE_FIELDS } from '@/src/lib/crm-cadence/merge'
import { CRM_CADENCE_MAX_STEPS } from '@/src/schemas/crm-cadence.schema'
import type {
  CrmCadenceDelayUnitDTO,
  CrmCadenceDTO,
  CrmCadenceStepTypeDTO,
} from '@/types/crm-cadence'
import {
  DELAY_UNIT_LABEL,
  describeDelay,
  STEP_TYPE_LABEL,
} from './cadence-labels'

interface StepDraft {
  key: string
  type: CrmCadenceStepTypeDTO
  delayValue: number
  delayUnit: CrmCadenceDelayUnitDTO
  subject: string
  body: string
  whatsappTemplateId: string | null
  templateVariables: string[]
}

interface Draft {
  name: string
  description: string
  emailFrom: string
  emailReplyTo: string
  whatsappConnectionId: string | null
  stopOnReply: boolean
  restrictWindow: boolean
  windowStartHour: number
  windowEndHour: number
  weekdaysOnly: boolean
  steps: StepDraft[]
}

let stepCounter = 0
const newStep = (patch: Partial<StepDraft> = {}): StepDraft => {
  stepCounter += 1
  return {
    key: `step-${stepCounter}`,
    type: 'EMAIL',
    delayValue: 1,
    delayUnit: 'DAYS',
    subject: '',
    body: '',
    whatsappTemplateId: null,
    templateVariables: [],
    ...patch,
  }
}

function toDraft(cadence: CrmCadenceDTO | null): Draft {
  if (!cadence) {
    return {
      name: '',
      description: '',
      emailFrom: '',
      emailReplyTo: '',
      whatsappConnectionId: null,
      stopOnReply: true,
      restrictWindow: true,
      windowStartHour: 9,
      windowEndHour: 18,
      weekdaysOnly: true,
      steps: [newStep({ delayValue: 0 })],
    }
  }
  return {
    name: cadence.name,
    description: cadence.description ?? '',
    emailFrom: cadence.emailFrom ?? '',
    emailReplyTo: cadence.emailReplyTo ?? '',
    whatsappConnectionId: cadence.whatsappConnectionId,
    stopOnReply: cadence.stopOnReply,
    restrictWindow: cadence.windowStartHour !== null,
    windowStartHour: cadence.windowStartHour ?? 9,
    windowEndHour: cadence.windowEndHour ?? 18,
    weekdaysOnly: cadence.weekdaysOnly,
    steps: cadence.steps.map((step) =>
      newStep({
        type: step.type,
        delayValue: step.delayValue,
        delayUnit: step.delayUnit,
        subject: step.subject ?? '',
        body: step.body,
        whatsappTemplateId: step.whatsappTemplateId,
        templateVariables: step.templateVariables,
      }),
    ),
  }
}

const TYPE_ITEMS = (
  Object.keys(STEP_TYPE_LABEL) as CrmCadenceStepTypeDTO[]
).map((value) => ({ value, label: STEP_TYPE_LABEL[value] }))
const UNIT_ITEMS = (
  Object.keys(DELAY_UNIT_LABEL) as CrmCadenceDelayUnitDTO[]
).map((value) => ({ value, label: DELAY_UNIT_LABEL[value] }))

export function CadenceEditorSheet({
  workspaceId,
  workspaceSlug,
  cadence,
  open,
  onOpenChange,
}: {
  workspaceId: string
  workspaceSlug: string
  /** `null` = a new cadence. */
  cadence: CrmCadenceDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(cadence))
  const options = useCrmCampaignOptions(workspaceId)
  const create = useCreateCrmCadence(workspaceId)
  const update = useUpdateCrmCadence(workspaceId)
  const saving = create.isPending || update.isPending

  useEffect(() => {
    if (open) setDraft(toDraft(cadence))
  }, [open, cadence])

  const connections = options.data?.whatsapp.connections ?? []
  const connection = connections.find(
    (item) => item.id === draft.whatsappConnectionId,
  )
  const needsEmail = draft.steps.some((step) => step.type === 'EMAIL')
  const needsWhatsApp = draft.steps.some((step) => step.type === 'WHATSAPP')

  const patch = (changes: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...changes }))
  const patchStep = (key: string, changes: Partial<StepDraft>) =>
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.key === key ? { ...step, ...changes } : step,
      ),
    }))
  const moveStep = (index: number, direction: -1 | 1) =>
    setDraft((current) => {
      const target = index + direction
      if (target < 0 || target >= current.steps.length) return current
      const steps = [...current.steps]
      ;[steps[index], steps[target]] = [steps[target], steps[index]]
      return { ...current, steps }
    })

  function submit() {
    if (!draft.name.trim()) {
      notify.error(null, 'Dê um nome à cadência')
      return
    }
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      emailFrom: needsEmail && draft.emailFrom ? draft.emailFrom : null,
      emailReplyTo: draft.emailReplyTo.trim() || null,
      whatsappConnectionId: needsWhatsApp ? draft.whatsappConnectionId : null,
      stopOnReply: draft.stopOnReply,
      windowStartHour: draft.restrictWindow ? draft.windowStartHour : null,
      windowEndHour: draft.restrictWindow ? draft.windowEndHour : null,
      weekdaysOnly: draft.weekdaysOnly,
      steps: draft.steps.map((step) => ({
        type: step.type,
        delayValue: step.delayValue,
        delayUnit: step.delayUnit,
        subject: step.type === 'WHATSAPP' ? null : step.subject.trim() || null,
        body: step.body,
        whatsappTemplateId:
          step.type === 'WHATSAPP' ? step.whatsappTemplateId : null,
        templateVariables:
          step.type === 'WHATSAPP' ? step.templateVariables : [],
      })),
    }
    const done = {
      onSuccess: () => {
        notify.success(cadence ? 'Cadência salva' : 'Cadência criada')
        onOpenChange(false)
      },
      onError: (error: unknown) => notify.error(error),
    }
    if (cadence) update.mutate({ cadenceId: cadence.id, ...body }, done)
    else create.mutate(body, done)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full gap-0 overflow-y-auto sm:max-w-2xl'>
        <SheetHeader>
          <SheetTitle>
            {cadence ? 'Editar cadência' : 'Nova cadência'}
          </SheetTitle>
          <SheetDescription>
            Uma sequência de passos para cada lead, com intervalos entre eles.
            Ela para sozinha quando o lead responde.
          </SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-6 px-4 pb-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cadence-name'>Nome</Label>
            <Input
              id='cadence-name'
              value={draft.name}
              maxLength={120}
              placeholder='Ex.: Prospecção outbound'
              onChange={(event) => patch({ name: event.target.value })}
            />
            <Textarea
              aria-label='Descrição'
              value={draft.description}
              maxLength={1000}
              rows={2}
              placeholder='Para que serve esta cadência (opcional)'
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>

          <section className='flex flex-col gap-3'>
            <h3 className='font-medium text-sm'>Passos</h3>
            <ol className='flex flex-col gap-3'>
              {draft.steps.map((step, index) => (
                <li
                  key={step.key}
                  className='flex flex-col gap-3 rounded-lg border bg-card p-3'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='flex size-6 items-center justify-center rounded-full bg-muted font-medium text-xs'>
                      {index + 1}
                    </span>
                    <Select
                      items={TYPE_ITEMS}
                      value={step.type}
                      onValueChange={(value) =>
                        patchStep(step.key, {
                          type: value as CrmCadenceStepTypeDTO,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Tipo do passo ${index + 1}`}
                        className='w-36'
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className='ml-auto flex items-center gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        aria-label={`Subir o passo ${index + 1}`}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <SteelIcon icon={ArrowUp01Icon} />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        aria-label={`Descer o passo ${index + 1}`}
                        disabled={index === draft.steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <SteelIcon icon={ArrowDown01Icon} />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        aria-label={`Remover o passo ${index + 1}`}
                        disabled={draft.steps.length === 1}
                        onClick={() =>
                          patch({
                            steps: draft.steps.filter(
                              (item) => item.key !== step.key,
                            ),
                          })
                        }
                      >
                        <SteelIcon icon={Delete02Icon} />
                      </Button>
                    </div>
                  </div>

                  <div className='flex flex-wrap items-center gap-2 text-sm'>
                    <span className='text-muted-foreground'>Executar</span>
                    <Input
                      type='number'
                      min={0}
                      max={365}
                      aria-label={`Intervalo do passo ${index + 1}`}
                      className='w-20'
                      value={step.delayValue}
                      onChange={(event) =>
                        patchStep(step.key, {
                          delayValue: Math.max(
                            0,
                            Math.min(365, Number(event.target.value) || 0),
                          ),
                        })
                      }
                    />
                    <Select
                      items={UNIT_ITEMS}
                      value={step.delayUnit}
                      onValueChange={(value) =>
                        patchStep(step.key, {
                          delayUnit: value as CrmCadenceDelayUnitDTO,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Unidade do passo ${index + 1}`}
                        className='w-28'
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className='text-muted-foreground'>
                      (
                      {describeDelay(
                        step.delayValue,
                        step.delayUnit,
                        index === 0,
                      )}
                      )
                    </span>
                  </div>

                  <StepFields
                    step={step}
                    index={index}
                    templates={connection?.templates ?? []}
                    isMeta={connection?.provider === 'META'}
                    onChange={(changes) => patchStep(step.key, changes)}
                  />
                </li>
              ))}
            </ol>
            <Button
              type='button'
              variant='outline'
              className='self-start'
              disabled={draft.steps.length >= CRM_CADENCE_MAX_STEPS}
              onClick={() => patch({ steps: [...draft.steps, newStep()] })}
            >
              <SteelIcon icon={PlusSignIcon} />
              Adicionar passo
            </Button>
          </section>

          {needsEmail ? (
            <section className='flex flex-col gap-3'>
              <h3 className='font-medium text-sm'>E-mail</h3>
              <EmailSenderPicker
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                value={draft.emailFrom}
                onChange={(email) => patch({ emailFrom: email })}
                id='cadence-email-from'
              />
              <div className='flex flex-col gap-2'>
                <Label htmlFor='cadence-reply-to'>Responder para</Label>
                <Input
                  id='cadence-reply-to'
                  type='email'
                  value={draft.emailReplyTo}
                  placeholder='Vazio: o e-mail do responsável pelo lead'
                  onChange={(event) =>
                    patch({ emailReplyTo: event.target.value })
                  }
                />
              </div>
            </section>
          ) : null}

          {needsWhatsApp ? (
            <section className='flex flex-col gap-2'>
              <h3 className='font-medium text-sm'>WhatsApp</h3>
              <Label htmlFor='cadence-connection'>Conexão</Label>
              <Select
                items={connections.map((item) => ({
                  value: item.id,
                  label: `${item.label} · ${item.phoneNumber}`,
                }))}
                value={draft.whatsappConnectionId}
                onValueChange={(value) =>
                  patch({ whatsappConnectionId: value as string })
                }
              >
                <SelectTrigger id='cadence-connection' className='w-full'>
                  <SelectValue placeholder='Escolha a conexão' />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label} · {item.phoneNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!options.isLoading && connections.length === 0 ? (
                <p className='text-muted-foreground text-xs'>
                  {options.data?.whatsapp.reason ??
                    'Nenhuma conexão de WhatsApp conectada neste workspace.'}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className='flex flex-col gap-3'>
            <h3 className='font-medium text-sm'>Regras</h3>
            <div className='flex items-center justify-between gap-3 text-sm'>
              <Label htmlFor='cadence-stop-on-reply' className='block'>
                Parar quando o lead responder
                <span className='block font-normal text-muted-foreground text-xs'>
                  Por WhatsApp ou por e-mail registrado no CRM.
                </span>
              </Label>
              <Switch
                id='cadence-stop-on-reply'
                checked={draft.stopOnReply}
                onCheckedChange={(checked) => patch({ stopOnReply: checked })}
              />
            </div>
            <div className='flex items-center justify-between gap-3 text-sm'>
              <Label htmlFor='cadence-window' className='block'>
                Enviar só em horário comercial
                <span className='block font-normal text-muted-foreground text-xs'>
                  E-mails e mensagens esperam a janela abrir (horário de
                  Brasília). Tarefas não esperam.
                </span>
              </Label>
              <Switch
                id='cadence-window'
                checked={draft.restrictWindow}
                onCheckedChange={(checked) =>
                  patch({ restrictWindow: checked })
                }
              />
            </div>
            {draft.restrictWindow ? (
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <span>Das</span>
                <Input
                  type='number'
                  min={0}
                  max={23}
                  aria-label='Hora inicial'
                  className='w-20'
                  value={draft.windowStartHour}
                  onChange={(event) =>
                    patch({
                      windowStartHour: Math.max(
                        0,
                        Math.min(23, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
                <span>às</span>
                <Input
                  type='number'
                  min={0}
                  max={23}
                  aria-label='Hora final'
                  className='w-20'
                  value={draft.windowEndHour}
                  onChange={(event) =>
                    patch({
                      windowEndHour: Math.max(
                        0,
                        Math.min(23, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
                <span>h</span>
                <div className='ml-2 flex items-center gap-2'>
                  <Switch
                    id='cadence-weekdays'
                    checked={draft.weekdaysOnly}
                    onCheckedChange={(checked) =>
                      patch({ weekdaysOnly: checked })
                    }
                  />
                  <Label htmlFor='cadence-weekdays' className='font-normal'>
                    Só em dias úteis
                  </Label>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <SheetFooter>
          <Button type='button' onClick={submit} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar cadência'}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

type TemplateOption = NonNullable<
  ReturnType<typeof useCrmCampaignOptions>['data']
>['whatsapp']['connections'][number]['templates'][number]

function StepFields({
  step,
  index,
  templates,
  isMeta,
  onChange,
}: {
  step: StepDraft
  index: number
  templates: TemplateOption[]
  isMeta: boolean
  onChange: (changes: Partial<StepDraft>) => void
}) {
  const template = templates.find((item) => item.id === step.whatsappTemplateId)

  if (step.type === 'WHATSAPP' && isMeta) {
    const approved = templates.filter((item) => item.status === 'APPROVED')
    const count = template?.fields.bodyVariables ?? 0
    return (
      <div className='flex flex-col gap-2'>
        <Label htmlFor={`step-template-${index}`}>Template aprovado</Label>
        <Select
          items={approved.map((item) => ({ value: item.id, label: item.name }))}
          value={step.whatsappTemplateId}
          onValueChange={(value) => {
            const picked = templates.find((item) => item.id === value)
            onChange({
              whatsappTemplateId: value as string,
              templateVariables: Array.from(
                { length: picked?.fields.bodyVariables ?? 0 },
                (_, i) => step.templateVariables[i] ?? '{{primeiro_nome}}',
              ),
            })
          }}
        >
          <SelectTrigger id={`step-template-${index}`} className='w-full'>
            <SelectValue placeholder='Escolha o template' />
          </SelectTrigger>
          <SelectContent>
            {approved.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {template ? (
          <p className='rounded-md bg-muted p-2 text-muted-foreground text-xs'>
            {template.fields.bodyText}
          </p>
        ) : (
          <p className='text-muted-foreground text-xs'>
            A Meta só entrega templates aprovados para quem não falou com você
            nas últimas 24 horas.
          </p>
        )}
        {Array.from({ length: count }, (_, i) => (
          <div key={`${template?.id}-${i}`} className='flex items-center gap-2'>
            <span className='w-12 text-muted-foreground text-xs'>{`{{${i + 1}}}`}</span>
            <Input
              aria-label={`Variável ${i + 1} do passo ${index + 1}`}
              value={step.templateVariables[i] ?? ''}
              onChange={(event) => {
                const next = [...step.templateVariables]
                next[i] = event.target.value
                onChange({ templateVariables: next })
              }}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      {step.type !== 'WHATSAPP' ? (
        <Input
          aria-label={
            step.type === 'EMAIL'
              ? `Assunto do passo ${index + 1}`
              : `Título da tarefa do passo ${index + 1}`
          }
          value={step.subject}
          maxLength={200}
          placeholder={
            step.type === 'EMAIL' ? 'Assunto do e-mail' : 'Título da tarefa'
          }
          onChange={(event) => onChange({ subject: event.target.value })}
        />
      ) : null}
      <Textarea
        aria-label={`Texto do passo ${index + 1}`}
        value={step.body}
        rows={step.type === 'TASK' ? 2 : 5}
        maxLength={10000}
        placeholder={
          step.type === 'EMAIL'
            ? 'Olá, {{primeiro_nome}}…'
            : step.type === 'WHATSAPP'
              ? 'Mensagem do WhatsApp'
              : 'O que fazer (opcional)'
        }
        onChange={(event) => onChange({ body: event.target.value })}
      />
      <div className='flex flex-wrap gap-1'>
        {CADENCE_MERGE_FIELDS.map((field) => (
          <Button
            key={field.token}
            type='button'
            variant='outline'
            size='xs'
            title={field.label}
            onClick={() =>
              onChange({
                body: `${step.body}${step.body && !step.body.endsWith(' ') ? ' ' : ''}${field.token}`,
              })
            }
          >
            {field.token}
          </Button>
        ))}
      </div>
    </div>
  )
}

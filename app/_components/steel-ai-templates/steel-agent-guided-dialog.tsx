'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  FROM_TEMPLATE_PARAM,
  FROM_TEMPLATE_VALUE,
} from '@/app/_components/steel-agents/steel-agent-new'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useCreateSteelAgent } from '@/src/hooks/use-steel-agents'
import {
  buildGuidedAgentInput,
  DEFAULT_GUIDED_ANSWERS,
  GUIDED_CONTEXT_MAX_CHARS,
  GUIDED_SCHEDULES,
  type GuidedAnswers,
  guidedAnswersProblems,
  guidedSummary,
} from '@/src/lib/steel-agents/guided'
import type { SteelAgentTemplateDTO } from '@/types/ai-template'

type Step = 'GOAL' | 'DETAILS' | 'SAFETY' | 'REVIEW'
const STEPS: { id: Step; label: string }[] = [
  { id: 'GOAL', label: 'Objetivo' },
  { id: 'DETAILS', label: 'Detalhes' },
  { id: 'SAFETY', label: 'Autonomia' },
  { id: 'REVIEW', label: 'Revisão' },
]

/**
 * C3 — guided creation for people who are not technical: pick a goal, say
 * what the agent should know, choose how bold it may be and review in plain
 * language. The agent is created paused and opened on its page, where
 * "Testar agente" shows what it would do.
 */
export function SteelAgentGuidedDialog({
  open,
  onOpenChange,
  workspaceId,
  slug,
  ownerId,
  templates,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  slug: string
  ownerId: string
  templates: SteelAgentTemplateDTO[]
}) {
  const router = useRouter()
  const create = useCreateSteelAgent(workspaceId)
  const available = templates.filter((t) => t.available)
  const [step, setStep] = useState<Step>('GOAL')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<GuidedAnswers | null>(null)
  const template = available.find((t) => t.id === templateId) ?? null
  const index = STEPS.findIndex((s) => s.id === step)

  function pick(id: string) {
    const next = available.find((t) => t.id === id)
    if (!next) return
    setTemplateId(id)
    setAnswers(DEFAULT_GUIDED_ANSWERS(next))
  }

  function set<K extends keyof GuidedAnswers>(key: K, value: GuidedAnswers[K]) {
    setAnswers((current) => (current ? { ...current, [key]: value } : current))
  }

  function next() {
    if (step === 'DETAILS' && answers) {
      const problems = guidedAnswersProblems(answers)
      if (problems.length > 0) {
        notify.error(new Error(problems[0]))
        return
      }
    }
    setStep(STEPS[index + 1]?.id ?? step)
  }

  function submit() {
    if (!template || !answers) return
    create.mutate(buildGuidedAgentInput(template, answers, ownerId), {
      onSuccess: (agent) => {
        notify.success('Agente criado, pausado')
        onOpenChange(false)
        router.push(
          `/${slug}/ai/agents/${agent.id}?${FROM_TEMPLATE_PARAM}=${FROM_TEMPLATE_VALUE}`,
        )
      },
      onError: (cause) => notify.error(cause, 'Não foi possível criar o agente'),
    })
  }

  const summary = template && answers ? guidedSummary(template, answers) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Criar agente com ajuda</DialogTitle>
          <DialogDescription>
            Passo {index + 1} de {STEPS.length}: {STEPS[index]?.label}. Nada
            roda antes de você testar e ativar o agente.
          </DialogDescription>
        </DialogHeader>

        {step === 'GOAL' ? (
          <RadioGroup
            value={templateId ?? ''}
            onValueChange={(value) => pick(value as string)}
            className='grid gap-2'
            aria-label='O que o agente deve fazer'
          >
            {available.map((item) => (
              <Label
                key={item.id}
                className='flex items-start gap-2 rounded-lg border p-3 font-normal'
              >
                <RadioGroupItem value={item.id} className='mt-0.5' />
                <span className='min-w-0'>
                  <span className='block font-medium text-sm'>{item.name}</span>
                  <span className='block text-muted-foreground text-xs'>
                    {item.description}
                  </span>
                  <span className='block text-muted-foreground text-xs'>
                    Quando: {item.scheduleLabel}
                  </span>
                </span>
              </Label>
            ))}
            {available.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                Nenhum modelo disponível neste workspace.
              </p>
            ) : null}
          </RadioGroup>
        ) : null}

        {step === 'DETAILS' && template && answers ? (
          <div className='grid gap-4'>
            <div className='grid gap-1.5'>
              <Label htmlFor='guided-name'>Nome do agente</Label>
              <Input
                id='guided-name'
                value={answers.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='guided-context'>
                O que ele precisa saber sobre a sua empresa? (opcional)
              </Label>
              <Textarea
                id='guided-context'
                rows={5}
                maxLength={GUIDED_CONTEXT_MAX_CHARS}
                value={answers.context}
                placeholder='Ex.: vendemos planos de internet para empresas; leads de pequenas empresas vão para a Ana; nunca prometer desconto.'
                onChange={(e) => set('context', e.target.value)}
              />
            </div>
            {template.triggerType === 'SCHEDULE' ? (
              <fieldset className='grid gap-1.5'>
                <legend className='font-medium text-sm'>Com que frequência</legend>
                <RadioGroup
                  value={answers.scheduleId ?? 'default'}
                  onValueChange={(value) =>
                    set('scheduleId', value === 'default' ? null : (value as string))
                  }
                  className='grid gap-2'
                >
                  <Label className='gap-2 font-normal'>
                    <RadioGroupItem value='default' />
                    {template.scheduleLabel} (sugerido)
                  </Label>
                  {GUIDED_SCHEDULES.filter(
                    (s) => s.cron !== template.cron,
                  ).map((s) => (
                    <Label key={s.id} className='gap-2 font-normal'>
                      <RadioGroupItem value={s.id} />
                      {s.label}
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>
            ) : (
              <p className='text-muted-foreground text-sm'>
                Roda sozinho: {template.scheduleLabel.toLowerCase()}.
              </p>
            )}
          </div>
        ) : null}

        {step === 'SAFETY' && answers ? (
          <div className='grid gap-4'>
            <RadioGroup
              value={answers.autonomy}
              onValueChange={(value) =>
                set('autonomy', value as GuidedAnswers['autonomy'])
              }
              className='grid gap-2'
              aria-label='Autonomia'
            >
              <Label className='flex items-start gap-2 rounded-lg border p-3 font-normal'>
                <RadioGroupItem value='SUGGEST' className='mt-0.5' />
                <span>
                  <span className='block font-medium text-sm'>
                    Só sugere (recomendado)
                  </span>
                  <span className='block text-muted-foreground text-xs'>
                    Toda alteração chega na caixa de entrada para você aprovar.
                  </span>
                </span>
              </Label>
              <Label className='flex items-start gap-2 rounded-lg border p-3 font-normal'>
                <RadioGroupItem value='ACT' className='mt-0.5' />
                <span>
                  <span className='block font-medium text-sm'>
                    Faz o simples sozinho
                  </span>
                  <span className='block text-muted-foreground text-xs'>
                    Cria notas e tarefas internas sem pedir. Mover etapa,
                    atribuir e qualquer coisa que o cliente veja continuam
                    pedindo aprovação.
                  </span>
                </span>
              </Label>
            </RadioGroup>
            <div className='grid gap-1.5'>
              <Label htmlFor='guided-cap'>Limite de execuções por mês (opcional)</Label>
              <Input
                id='guided-cap'
                type='number'
                min={1}
                className='sm:w-40'
                value={answers.monthlyRunCap ?? ''}
                onChange={(e) =>
                  set(
                    'monthlyRunCap',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
              />
            </div>
          </div>
        ) : null}

        {step === 'REVIEW' && template && answers && summary ? (
          <div className='grid gap-3 text-sm'>
            <p>
              <span className='font-medium'>{answers.name}</span> vai{' '}
              {template.description.charAt(0).toLowerCase()}
              {template.description.slice(1)}
            </p>
            <p>
              <span className='font-medium'>Faz sozinho:</span>{' '}
              {summary.alone.join(', ') || 'nada'}.
            </p>
            <p>
              <span className='font-medium'>Pede a sua aprovação:</span>{' '}
              {summary.approval.join(', ') || 'nada'}.
            </p>
            <p className='text-muted-foreground'>
              Ele nasce pausado. Depois de criar, use “Testar agente” para ver o
              que faria, e só então ative.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          {index > 0 ? (
            <Button
              variant='outline'
              onClick={() => setStep(STEPS[index - 1]?.id ?? step)}
            >
              Voltar
            </Button>
          ) : null}
          {step === 'REVIEW' ? (
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending ? 'Criando...' : 'Criar agente'}
            </Button>
          ) : (
            <Button onClick={next} disabled={step === 'GOAL' && !template}>
              Continuar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

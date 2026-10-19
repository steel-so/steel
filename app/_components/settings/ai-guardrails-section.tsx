'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useAiGuardrails,
  useUpdateAiGuardrails,
} from '@/src/hooks/use-ai-guardrails'
import type {
  AiPiiMaskingPolicyDTO,
  WorkspaceAiGuardrailsDTO,
} from '@/types/ai-guardrails'

const POLICIES: {
  value: AiPiiMaskingPolicyDTO
  label: string
  hint: string
}[] = [
  {
    value: 'OFF',
    label: 'Não mascarar',
    hint: 'Os textos vão ao provedor de IA como estão.',
  },
  {
    value: 'AUTO_REPLIES',
    label: 'Só nas respostas automáticas',
    hint: 'Resposta automática do WhatsApp e pré-atendimento do ServiceDesk, onde nenhuma pessoa revisa antes. Padrão.',
  },
  {
    value: 'EVERYWHERE',
    label: 'Em toda a IA',
    hint: 'Inclui o Steel AI, os agentes, o copiloto, a triagem e a Wiki.',
  },
]

interface FormState {
  piiMaskingPolicy: AiPiiMaskingPolicyDTO
  injectionClassifierEnabled: boolean
  forbiddenTopics: string
  maxDiscountPercent: string
  maxRefundAmount: string
  maxDeadlineDays: string
}

function toForm(g: WorkspaceAiGuardrailsDTO): FormState {
  return {
    piiMaskingPolicy: g.piiMaskingPolicy,
    injectionClassifierEnabled: g.injectionClassifierEnabled,
    forbiddenTopics: g.forbiddenTopics.join('\n'),
    maxDiscountPercent:
      g.maxDiscountPercent === null ? '' : String(g.maxDiscountPercent),
    maxRefundAmount:
      g.maxRefundAmount === null
        ? ''
        : String(g.maxRefundAmount).replace('.', ','),
    maxDeadlineDays:
      g.maxDeadlineDays === null ? '' : String(g.maxDeadlineDays),
  }
}

/** Empty = no limit; otherwise a non-negative number (or NaN = invalid). */
function parseLimit(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return Number(trimmed.replace(/\./g, '').replace(',', '.'))
}

function topicsOf(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(/[\n,;]/)
    .map((topic) => topic.trim())
    .filter((topic) => {
      const key = topic.toLowerCase()
      if (!topic || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Proteções do Steel AI (ADR 0041): mascaramento de dados pessoais, defesa
 * contra prompt injection e limites das respostas automáticas.
 */
export function AiGuardrailsSection({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useAiGuardrails(workspaceId)

  if (isLoading) {
    return (
      <p className='text-muted-foreground text-sm'>Carregando proteções...</p>
    )
  }
  if (!data) {
    return (
      <p className='text-destructive text-sm'>
        {error instanceof Error
          ? error.message
          : 'Não foi possível carregar as proteções da IA.'}
      </p>
    )
  }
  return <GuardrailsForm workspaceId={workspaceId} guardrails={data} />
}

function GuardrailsForm({
  workspaceId,
  guardrails,
}: {
  workspaceId: string
  guardrails: WorkspaceAiGuardrailsDTO
}) {
  const update = useUpdateAiGuardrails(workspaceId)
  const [form, setForm] = useState<FormState>(() => toForm(guardrails))
  const readOnly = !guardrails.canManage

  useEffect(() => {
    setForm(toForm(guardrails))
  }, [guardrails])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const discount = parseLimit(form.maxDiscountPercent)
    const refund = parseLimit(form.maxRefundAmount)
    const deadline = parseLimit(form.maxDeadlineDays)
    if (
      discount !== null &&
      (!Number.isInteger(discount) || discount < 0 || discount > 100)
    ) {
      notify.error(new Error('Informe um desconto inteiro entre 0 e 100%.'))
      return
    }
    if (refund !== null && (!Number.isFinite(refund) || refund < 0)) {
      notify.error(new Error('Informe um valor de reembolso válido (R$).'))
      return
    }
    if (deadline !== null && (!Number.isInteger(deadline) || deadline < 0)) {
      notify.error(new Error('Informe um prazo em dias inteiros.'))
      return
    }
    update.mutate(
      {
        piiMaskingPolicy: form.piiMaskingPolicy,
        injectionClassifierEnabled: form.injectionClassifierEnabled,
        forbiddenTopics: topicsOf(form.forbiddenTopics),
        maxDiscountPercent: discount,
        maxRefundAmount:
          refund === null ? null : Math.round(refund * 100) / 100,
        maxDeadlineDays: deadline,
      },
      {
        onSuccess: () => notify.success('Proteções da IA salvas'),
        onError: (cause) =>
          notify.error(cause, 'Não foi possível salvar as proteções'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='grid gap-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center gap-2'>
            Dados pessoais
            <Badge variant='secondary'>LGPD</Badge>
          </CardTitle>
          <CardDescription>
            CPF, CNPJ, cartões, telefones e e-mails viram marcadores (como
            [CPF_1]) antes de o texto ir ao provedor de IA. A resposta volta com
            os valores reais para quem a lê, e a auditoria registra só quantos
            dados foram mascarados, nunca os valores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={form.piiMaskingPolicy}
            onValueChange={(value) =>
              set('piiMaskingPolicy', value as AiPiiMaskingPolicyDTO)
            }
            disabled={readOnly}
            className='grid gap-2 md:grid-cols-3'
          >
            {POLICIES.map((policy) => (
              <Label
                key={policy.value}
                className='flex items-start gap-2 rounded-lg border p-3 font-normal'
              >
                <RadioGroupItem value={policy.value} className='mt-0.5' />
                <span className='min-w-0'>
                  <span className='block font-medium text-sm'>
                    {policy.label}
                  </span>
                  <span className='block text-muted-foreground text-xs'>
                    {policy.hint}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conteúdo de terceiros</CardTitle>
          <CardDescription>
            Mensagens de clientes, e-mails, chamados e documentos são tratados
            como dados, nunca como ordens. Quando um desses textos tenta
            instruir a IA, a tentativa é registrada, toda alteração passa a
            pedir confirmação (inclusive no Autopilot e nos agentes) e a
            resposta automática transfere para um atendente.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex items-center justify-between gap-4'>
          <div className='min-w-0'>
            <Label htmlFor='injectionClassifierEnabled' className='font-medium'>
              Verificação extra com IA
            </Label>
            <p className='text-muted-foreground text-xs'>
              Textos suspeitos que a análise automática não decide passam por um
              modelo classificador barato. O custo entra na cota mensal.
            </p>
          </div>
          <Switch
            id='injectionClassifierEnabled'
            checked={form.injectionClassifierEnabled}
            disabled={readOnly}
            onCheckedChange={(checked) =>
              set('injectionClassifierEnabled', checked === true)
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limites da resposta automática</CardTitle>
          <CardDescription>
            Valem para a resposta automática do WhatsApp e o pré-atendimento do
            ServiceDesk. Se o cliente tocar num assunto proibido, ou se a IA for
            prometer além do limite, a resposta não é enviada: um atendente
            assume e vê o motivo na conversa. Deixe em branco para não limitar.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-5'>
          <div className='space-y-1.5'>
            <Label htmlFor='forbiddenTopics'>Assuntos proibidos</Label>
            <Textarea
              id='forbiddenTopics'
              rows={4}
              placeholder={
                'cancelamento de contrato\nprocesso judicial\nportabilidade'
              }
              value={form.forbiddenTopics}
              readOnly={readOnly}
              onChange={(event) => set('forbiddenTopics', event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Um assunto por linha. A comparação ignora maiúsculas e acentos.
            </p>
          </div>
          <div className='grid gap-4 sm:grid-cols-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='maxDiscountPercent'>Desconto máximo (%)</Label>
              <Input
                id='maxDiscountPercent'
                inputMode='numeric'
                placeholder='Sem limite'
                value={form.maxDiscountPercent}
                readOnly={readOnly}
                onChange={(event) =>
                  set('maxDiscountPercent', event.target.value)
                }
              />
              <p className='text-muted-foreground text-xs'>
                0 = a IA nunca oferece desconto.
              </p>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='maxRefundAmount'>Reembolso máximo (R$)</Label>
              <Input
                id='maxRefundAmount'
                inputMode='decimal'
                placeholder='Sem limite'
                value={form.maxRefundAmount}
                readOnly={readOnly}
                onChange={(event) => set('maxRefundAmount', event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                0 = a IA nunca promete reembolso.
              </p>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='maxDeadlineDays'>Prazo máximo (dias)</Label>
              <Input
                id='maxDeadlineDays'
                inputMode='numeric'
                placeholder='Sem limite'
                value={form.maxDeadlineDays}
                readOnly={readOnly}
                onChange={(event) => set('maxDeadlineDays', event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                Maior prazo que a IA pode prometer.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {readOnly ? (
        <p className='text-muted-foreground text-sm'>
          Apenas o dono e os administradores do workspace podem alterar as
          proteções da IA.
        </p>
      ) : (
        <div>
          <Button type='submit' disabled={update.isPending}>
            {update.isPending ? 'Salvando...' : 'Salvar proteções'}
          </Button>
        </div>
      )}
    </form>
  )
}

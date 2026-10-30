'use client'

import { useEffect, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useSurveyConfigs,
  useUpdateSurveyConfig,
} from '@/src/hooks/use-satisfaction-surveys'
import {
  DEFAULT_DETRACTOR_MAX,
  DEFAULT_SURVEY_QUESTIONS,
  DEFAULT_SURVEY_THANK_YOU,
  detractorMax,
} from '@/src/lib/survey/scale'
import type {
  SurveyConfigDTO,
  SurveyKindDTO,
} from '@/types/satisfaction-survey'
import { KIND_HINT, KIND_LABEL, TRIGGER_LABEL } from './survey-labels'

const TRIGGER_HELP: Record<SurveyConfigDTO['trigger'], string> = {
  CONVERSATION_CLOSED:
    'Quando um atendente (ou a inatividade) encerra uma conversa em que o cliente escreveu, ele recebe a pesquisa no mesmo WhatsApp.',
  TICKET_RESOLVED:
    'Quando um chamado do ServiceDesk é resolvido, o solicitante recebe a pesquisa pelo WhatsApp do chamado ou por e-mail. A nota CSAT também aparece no chamado.',
}

function ConfigCard({
  config,
  workspaceId,
  canEdit,
}: {
  config: SurveyConfigDTO
  workspaceId: string
  canEdit: boolean
}) {
  const update = useUpdateSurveyConfig(workspaceId)
  const [draft, setDraft] = useState(config)
  useEffect(() => setDraft(config), [config])

  const set = <K extends keyof SurveyConfigDTO>(
    key: K,
    value: SurveyConfigDTO[K],
  ) => setDraft((d) => ({ ...d, [key]: value }))

  const num = (value: string) => Math.max(0, Number.parseInt(value, 10) || 0)

  const save = () =>
    update.mutate(
      {
        trigger: config.trigger,
        data: {
          enabled: draft.enabled,
          kind: draft.kind,
          delayMinutes: draft.delayMinutes,
          expiresInHours: Math.max(1, draft.expiresInHours),
          cooldownDays: draft.cooldownDays,
          emailFallback: draft.emailFallback,
          alertDetractors: draft.alertDetractors,
          detractorMaxScore: draft.detractorMaxScore,
          questionText: draft.questionText?.trim() || null,
          thankYouText: draft.thankYouText?.trim() || null,
        },
      },
      {
        onSuccess: () => notify.success('Regra da pesquisa salva'),
        onError: (error) => notify.error(error.message),
      },
    )

  return (
    <section className='space-y-4 rounded-lg border bg-card p-5'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h3 className='font-semibold'>{TRIGGER_LABEL[config.trigger]}</h3>
          <p className='mt-1 text-sm text-muted-foreground'>
            {TRIGGER_HELP[config.trigger]}
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          disabled={!canEdit}
          onCheckedChange={(v) => set('enabled', v)}
          aria-label={`Ativar pesquisa: ${TRIGGER_LABEL[config.trigger]}`}
        />
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label>Tipo de pesquisa</Label>
          <Select
            value={draft.kind}
            disabled={!canEdit}
            onValueChange={(v) => v && set('kind', v as SurveyKindDTO)}
          >
            <SelectTrigger aria-label='Tipo de pesquisa'>
              <SelectValue>{KIND_LABEL[draft.kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {(Object.keys(KIND_LABEL) as SurveyKindDTO[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className='text-xs text-muted-foreground'>
            {KIND_HINT[draft.kind]}
          </p>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor={`delay-${config.trigger}`}>
            Enviar depois de (minutos)
          </Label>
          <Input
            id={`delay-${config.trigger}`}
            type='number'
            min={0}
            max={1440}
            disabled={!canEdit}
            value={draft.delayMinutes}
            onChange={(e) => set('delayMinutes', num(e.target.value))}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor={`expires-${config.trigger}`}>
            Aceitar resposta por (horas)
          </Label>
          <Input
            id={`expires-${config.trigger}`}
            type='number'
            min={1}
            max={720}
            disabled={!canEdit}
            value={draft.expiresInHours}
            onChange={(e) => set('expiresInHours', num(e.target.value))}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor={`cooldown-${config.trigger}`}>
            Não repetir para o mesmo cliente por (dias)
          </Label>
          <Input
            id={`cooldown-${config.trigger}`}
            type='number'
            min={0}
            max={365}
            disabled={!canEdit}
            value={draft.cooldownDays}
            onChange={(e) => set('cooldownDays', num(e.target.value))}
          />
        </div>
      </div>

      <div className='flex items-center justify-between gap-4 rounded-md border p-3'>
        <div>
          <p className='text-sm font-medium'>E-mail como alternativa</p>
          <p className='text-xs text-muted-foreground'>
            Se o WhatsApp não puder enviar (fora da janela de 24 horas, número
            desconectado), a pesquisa vai por e-mail quando houver endereço.
          </p>
        </div>
        <Switch
          checked={draft.emailFallback}
          disabled={!canEdit}
          onCheckedChange={(v) => set('emailFallback', v)}
          aria-label='E-mail como alternativa'
        />
      </div>

      <div className='space-y-3 rounded-md border p-3'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <p className='text-sm font-medium'>Avisar sobre detratores</p>
            <p className='text-xs text-muted-foreground'>
              Quando a nota fica abaixo do limite, os administradores recebem um
              aviso na caixa de entrada com o cliente, a nota e o atendente.
            </p>
          </div>
          <Switch
            checked={draft.alertDetractors}
            disabled={!canEdit}
            onCheckedChange={(v) => set('alertDetractors', v)}
            aria-label='Avisar sobre detratores'
          />
        </div>
        {draft.alertDetractors ? (
          <div className='space-y-1.5'>
            <Label htmlFor={`detractor-${config.trigger}`}>
              Nota máxima considerada detratora
            </Label>
            <Input
              id={`detractor-${config.trigger}`}
              type='number'
              min={0}
              max={9}
              disabled={!canEdit}
              placeholder={String(DEFAULT_DETRACTOR_MAX[draft.kind])}
              value={draft.detractorMaxScore ?? ''}
              onChange={(e) =>
                set(
                  'detractorMaxScore',
                  e.target.value === '' ? null : num(e.target.value),
                )
              }
            />
            <p className='text-xs text-muted-foreground'>
              Avisa com nota até{' '}
              {detractorMax(draft.kind, draft.detractorMaxScore)}. Vazio usa o
              padrão do tipo (NPS até 6, CSAT até 2, CES até 3).
            </p>
          </div>
        ) : null}
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor={`question-${config.trigger}`}>Pergunta</Label>
        <Textarea
          id={`question-${config.trigger}`}
          rows={3}
          maxLength={600}
          disabled={!canEdit}
          placeholder={DEFAULT_SURVEY_QUESTIONS[draft.kind]}
          value={draft.questionText ?? ''}
          onChange={(e) => set('questionText', e.target.value)}
        />
        <p className='text-xs text-muted-foreground'>
          Vazio usa o texto padrão do tipo escolhido.
        </p>
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor={`thanks-${config.trigger}`}>
          Mensagem de agradecimento
        </Label>
        <Textarea
          id={`thanks-${config.trigger}`}
          rows={2}
          maxLength={600}
          disabled={!canEdit}
          placeholder={DEFAULT_SURVEY_THANK_YOU}
          value={draft.thankYouText ?? ''}
          onChange={(e) => set('thankYouText', e.target.value)}
        />
      </div>

      {canEdit ? (
        <div className='flex justify-end'>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar regra'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

export function WhatsappSurveySettings({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const configs = useSurveyConfigs(workspaceId)
  if (configs.isLoading) return <Skeleton className='m-6 h-96' />
  if (configs.isError) {
    return (
      <p className='p-6 text-sm text-destructive'>{configs.error.message}</p>
    )
  }
  return (
    <div className='mx-auto max-w-3xl space-y-6 p-6'>
      {!canEdit ? (
        <p className='text-sm text-muted-foreground'>
          Só proprietários e administradores alteram as regras.
        </p>
      ) : null}
      {(configs.data ?? []).map((config) => (
        <ConfigCard
          key={config.trigger}
          config={config}
          workspaceId={workspaceId}
          canEdit={canEdit}
        />
      ))}
    </div>
  )
}

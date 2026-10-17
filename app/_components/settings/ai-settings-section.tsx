'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useAiSettings, useUpdateAiSettings } from '@/src/hooks/use-ai-settings'
import type { WorkspaceAiSettingsDTO } from '@/types/ai-settings'
import { useIsWorkspaceAdmin } from '../workspace/workspace-permissions'
import { AiModelPreferenceSelect } from './ai-model-preference-select'

const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
})
const integer = new Intl.NumberFormat('pt-BR')
/** Prices per 1M tokens go down to fractions of a cent. */
const usdPrice = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
})

type FeatureField =
  | 'crmAssistantModel'
  | 'whatsappReplyModel'
  | 'whatsappSentimentModel'

const FEATURES: { field: FeatureField; label: string; hint: string }[] = [
  {
    field: 'crmAssistantModel',
    label: 'Steel AI (assistente)',
    hint: 'Padrão para quem não escolheu um modelo próprio.',
  },
  {
    field: 'whatsappReplyModel',
    label: 'Resposta automática do WhatsApp',
    hint: 'Usado pelo atendimento automático (em segundo plano).',
  },
  {
    field: 'whatsappSentimentModel',
    label: 'Análise de sentimento do WhatsApp',
    hint: 'Classifica as mensagens recebidas (em segundo plano).',
  },
]

interface FormState {
  enabledModels: string[]
  crmAssistantModel: string
  whatsappReplyModel: string
  whatsappSentimentModel: string
  monthlyQuotaUsd: string
  agentModeEnabled: boolean
  aiEnabled: boolean
  agentsEnabled: boolean
  memoryEnabled: boolean
  autopilotEnabled: boolean
  usageWeeklyEmailEnabled: boolean
  mcpWriteEnabled: boolean
}

type SwitchField =
  | 'aiEnabled'
  | 'agentsEnabled'
  | 'memoryEnabled'
  | 'autopilotEnabled'
  | 'usageWeeklyEmailEnabled'
  | 'mcpWriteEnabled'

const SWITCHES: { field: SwitchField; label: string; hint: string }[] = [
  {
    field: 'aiEnabled',
    label: 'Ativar Steel AI',
    hint: 'Interruptor geral: desligado, o Steel AI fica indisponível para todos neste espaço de trabalho.',
  },
  {
    field: 'agentsEnabled',
    label: 'Ativar agentes',
    hint: 'Steel Agents podem executar por agenda, por evento ou pelo botão.',
  },
  {
    field: 'memoryEnabled',
    label: 'Ativar memória',
    hint: 'O Steel AI pode guardar e usar memórias do espaço de trabalho e de cada pessoa (sempre revisáveis).',
  },
  {
    field: 'autopilotEnabled',
    label: 'Permitir Autopilot',
    hint: 'Libera o modo Autopilot nas conversas. Desligado por padrão.',
  },
  {
    field: 'mcpWriteEnabled',
    label: 'Permitir escrita via MCP',
    hint: 'Apps de IA conectados por MCP (Claude, ChatGPT, Cursor) podem criar, editar e executar ações quando a pessoa autorizou leitura e escrita. Desligado, eles só consultam dados. Desligado por padrão.',
  },
  {
    field: 'usageWeeklyEmailEnabled',
    label: 'Resumo semanal de consumo por e-mail',
    hint: 'Toda segunda-feira, às 08:00 (Brasília), os donos do espaço de trabalho recebem o gasto de IA da semana anterior, o andamento da cota e a projeção do mês.',
  },
]

function toForm(settings: WorkspaceAiSettingsDTO): FormState {
  return {
    enabledModels: settings.enabledModels,
    crmAssistantModel: settings.crmAssistantModel,
    whatsappReplyModel: settings.whatsappReplyModel,
    whatsappSentimentModel: settings.whatsappSentimentModel,
    monthlyQuotaUsd: String(settings.monthlyQuotaUsd),
    agentModeEnabled: settings.agentModeEnabled,
    aiEnabled: settings.aiEnabled,
    agentsEnabled: settings.agentsEnabled,
    memoryEnabled: settings.memoryEnabled,
    autopilotEnabled: settings.autopilotEnabled,
    usageWeeklyEmailEnabled: settings.usageWeeklyEmailEnabled,
    mcpWriteEnabled: settings.mcpWriteEnabled,
  }
}

export function AiSettingsSection({ workspaceId }: { workspaceId: string }) {
  const { data: settings, isLoading, error } = useAiSettings(workspaceId)
  // Papel resolvido no layout (WorkspacePermissionsProvider); fora dele,
  // usa o que a API informou. A API recusa escrita de não-admin de todo modo.
  const isAdmin = useIsWorkspaceAdmin()

  if (isLoading) {
    return (
      <p className='text-muted-foreground text-sm'>
        Carregando ajustes de IA...
      </p>
    )
  }
  if (!settings) {
    return (
      <p className='text-destructive text-sm'>
        {error instanceof Error
          ? error.message
          : 'Não foi possível carregar os ajustes de IA.'}
      </p>
    )
  }

  return (
    <div className='grid max-w-4xl gap-6'>
      <UsageCard settings={settings} />
      <PreferenceCard workspaceId={workspaceId} settings={settings} />
      {(isAdmin ?? settings.canManage) ? (
        <AdminForm workspaceId={workspaceId} settings={settings} />
      ) : (
        <p className='text-muted-foreground text-sm'>
          Apenas o dono e os administradores do workspace podem alterar os
          provedores, modelos e a cota de IA.
        </p>
      )}
    </div>
  )
}

function UsageCard({ settings }: { settings: WorkspaceAiSettingsDTO }) {
  const { usage, monthlyQuotaUsd } = settings
  const percent =
    monthlyQuotaUsd > 0
      ? Math.min(100, (usage.usedUsd / monthlyQuotaUsd) * 100)
      : 100
  const period = new Date(usage.periodStart).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consumo do mês</CardTitle>
        <CardDescription>
          Ciclo de {period}. Cada uso custa o preço real do modelo que respondeu
          (tokens de entrada e de saída) — veja os valores por modelo em
          &quot;Provedores e modelos habilitados&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex items-baseline justify-between gap-4'>
          <p className='font-semibold text-2xl tabular-nums'>
            {usd.format(usage.usedUsd)}
            <span className='font-normal text-muted-foreground text-sm'>
              {' '}
              de {usd.format(monthlyQuotaUsd)}
            </span>
          </p>
          <p className='text-muted-foreground text-sm tabular-nums'>
            Restante: {usd.format(usage.remainingUsd)}
          </p>
        </div>
        <div
          className='h-2 w-full overflow-hidden rounded-full bg-muted'
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label='Consumo da cota mensal de IA'
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              usage.exceeded
                ? 'bg-destructive'
                : percent >= 80
                  ? 'bg-amber-500'
                  : 'bg-primary',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className='text-muted-foreground text-xs tabular-nums'>
          {integer.format(usage.inputTokens)} tokens de entrada ·{' '}
          {integer.format(usage.outputTokens)} tokens de saída
        </p>
        {usage.exceeded && (
          <p className='rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm'>
            A cota mensal foi atingida. As funcionalidades de IA (Steel AI,
            resposta automática e análise de sentimento do WhatsApp) ficam
            bloqueadas até o próximo mês ou até um administrador aumentar a
            cota.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function PreferenceCard({
  workspaceId,
  settings,
}: {
  workspaceId: string
  settings: WorkspaceAiSettingsDTO
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meu modelo</CardTitle>
        <CardDescription>
          Modelo que o Steel AI usa nas suas conversas. Só aparecem os modelos
          habilitados neste workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AiModelPreferenceSelect
          workspaceId={workspaceId}
          settings={settings}
          className='w-full max-w-sm'
        />
      </CardContent>
    </Card>
  )
}

function AdminForm({
  workspaceId,
  settings,
}: {
  workspaceId: string
  settings: WorkspaceAiSettingsDTO
}) {
  const update = useUpdateAiSettings(workspaceId)
  const [form, setForm] = useState<FormState>(() => toForm(settings))

  useEffect(() => {
    setForm(toForm(settings))
  }, [settings])

  const labelOf = (key: string) =>
    settings.models.find((m) => m.key === key)?.label ?? key
  const enabledOptions = settings.models.filter((m) =>
    form.enabledModels.includes(m.key),
  )

  function toggleModel(key: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      enabledModels: checked
        ? [...current.enabledModels, key]
        : current.enabledModels.filter((k) => k !== key),
    }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const quota = Number(form.monthlyQuotaUsd.replace(',', '.'))
    if (!Number.isFinite(quota) || quota < 0) {
      notify.error(new Error('Informe uma cota mensal válida (em US$).'))
      return
    }
    const missingDefault = FEATURES.find(
      (f) => !form.enabledModels.includes(form[f.field]),
    )
    if (missingDefault) {
      notify.error(
        new Error(
          `O modelo padrão de "${missingDefault.label}" precisa estar habilitado.`,
        ),
      )
      return
    }

    update.mutate(
      {
        enabledModels: form.enabledModels,
        crmAssistantModel: form.crmAssistantModel,
        whatsappReplyModel: form.whatsappReplyModel,
        whatsappSentimentModel: form.whatsappSentimentModel,
        monthlyQuotaUsd: Math.round(quota * 100) / 100,
        agentModeEnabled: form.agentModeEnabled,
        aiEnabled: form.aiEnabled,
        agentsEnabled: form.agentsEnabled,
        memoryEnabled: form.memoryEnabled,
        autopilotEnabled: form.autopilotEnabled,
        usageWeeklyEmailEnabled: form.usageWeeklyEmailEnabled,
        mcpWriteEnabled: form.mcpWriteEnabled,
      },
      {
        onSuccess: () => notify.success('Ajustes de IA salvos'),
        onError: (error) =>
          notify.error(error, 'Não foi possível salvar os ajustes'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='grid gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>Provedores e modelos habilitados</CardTitle>
          <CardDescription>
            Defina quais modelos os membros podem usar. As chaves de API são da
            plataforma; um provedor sem chave configurada aparece como
            indisponível. Ao lado de cada modelo, o preço de entrada / saída
            cobrado da cota.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-5 md:grid-cols-2'>
          {settings.providers.map((provider) => (
            <fieldset key={provider.id} className='space-y-2'>
              <legend className='mb-2 flex items-center gap-2 font-medium text-sm'>
                {provider.label}
                <Badge variant={provider.available ? 'secondary' : 'outline'}>
                  {provider.available ? 'Disponível' : 'Indisponível'}
                </Badge>
              </legend>
              {settings.models
                .filter((m) => m.provider === provider.id)
                .map((model) => {
                  const checked = form.enabledModels.includes(model.key)
                  const id = `ai-model-${model.key}`
                  return (
                    <div key={model.key} className='flex items-center gap-2'>
                      <Checkbox
                        id={id}
                        checked={checked}
                        // Provedor sem chave: não deixa habilitar novos
                        // modelos (o backend também recusa), só desmarcar.
                        disabled={!provider.available && !checked}
                        onCheckedChange={(value) =>
                          toggleModel(model.key, value === true)
                        }
                      />
                      <Label
                        htmlFor={id}
                        className={cn(
                          'font-normal',
                          !provider.available && 'text-muted-foreground',
                        )}
                      >
                        {model.label}
                        <span className='text-muted-foreground text-xs'>
                          {model.model}
                        </span>
                        <span className='text-muted-foreground text-xs tabular-nums'>
                          {usdPrice.format(model.inputUsdPer1M)} /{' '}
                          {usdPrice.format(model.outputUsdPer1M)} por 1M tokens
                        </span>
                      </Label>
                    </div>
                  )
                })}
            </fieldset>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modelo padrão por funcionalidade</CardTitle>
          <CardDescription>
            Jobs em segundo plano sempre usam o padrão do workspace; no Steel AI
            cada usuário pode escolher outro modelo habilitado.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          {FEATURES.map((feature) => (
            <div
              key={feature.field}
              className='grid gap-1.5 md:grid-cols-[1fr_18rem] md:items-center'
            >
              <div>
                <p className='font-medium text-sm'>{feature.label}</p>
                <p className='text-muted-foreground text-xs'>{feature.hint}</p>
              </div>
              <Select
                value={form[feature.field]}
                onValueChange={(value) => {
                  if (typeof value !== 'string') return
                  setForm((current) => ({ ...current, [feature.field]: value }))
                }}
              >
                <SelectTrigger aria-label={feature.label} className='w-full'>
                  <SelectValue>{(value: string) => labelOf(value)}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {enabledOptions.map((m) => (
                      <SelectItem
                        key={m.key}
                        value={m.key}
                        disabled={!m.available}
                      >
                        {m.label}
                        {!m.available && ' (indisponível)'}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recursos do Steel AI</CardTitle>
          <CardDescription>
            Ligue ou desligue o Steel AI e seus recursos para todo o espaço de
            trabalho. As alterações ficam registradas na auditoria.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          {SWITCHES.map((item) => (
            <div key={item.field} className='space-y-3'>
              <div className='flex items-center justify-between gap-4'>
                <div className='min-w-0'>
                  <Label htmlFor={item.field} className='font-medium'>
                    {item.label}
                  </Label>
                  <p className='text-muted-foreground text-xs'>{item.hint}</p>
                </div>
                <Switch
                  id={item.field}
                  checked={form[item.field]}
                  disabled={item.field !== 'aiEnabled' && !form.aiEnabled}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      [item.field]: checked === true,
                    }))
                  }
                />
              </div>
              {item.field === 'autopilotEnabled' ? (
                <Alert variant='destructive'>
                  <AlertTitle>
                    Autopilot executa sem pedir confirmação
                  </AlertTitle>
                  <AlertDescription>
                    No modo Autopilot o Steel AI faz alterações sozinho —
                    inclusive exclusões e mensagens para clientes (WhatsApp e
                    e-mail) — sem a confirmação de ninguém. Tudo fica registrado
                    no histórico de ações da IA, mas não há como desfazer uma
                    mensagem enviada. Só ative se a equipe entender esse risco.
                  </AlertDescription>
                </Alert>
              ) : null}
              {item.field === 'mcpWriteEnabled' && form.mcpWriteEnabled ? (
                <Alert>
                  <AlertTitle>Como a escrita via MCP é controlada</AlertTitle>
                  <AlertDescription>
                    Cada app só escreve com a autorização de quem o conectou, e
                    apenas nos módulos e permissões dessa pessoa. Exclusões
                    nunca ficam disponíveis por MCP, e mensagens para clientes
                    (WhatsApp e e-mail) pedem confirmação no Steel antes de
                    sair. Os apps podem ser revogados em Apps conectados.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modo agente do Steel AI</CardTitle>
          <CardDescription>
            No modo agente o Steel AI pode propor alterações (criar, editar,
            excluir e enviar). Nada é executado sem o usuário confirmar na tela,
            e exclusões pedem confirmação dupla. Desligado, o Steel AI só
            consulta dados.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex items-center justify-between gap-4'>
          <Label htmlFor='agentModeEnabled' className='font-normal'>
            Permitir o modo agente neste workspace
          </Label>
          <Switch
            id='agentModeEnabled'
            checked={form.agentModeEnabled}
            onCheckedChange={(checked) =>
              setForm((current) => ({
                ...current,
                agentModeEnabled: checked === true,
              }))
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cota mensal</CardTitle>
          <CardDescription>
            Ao atingir a cota, novas chamadas de IA são bloqueadas até o próximo
            mês. Padrão: {usd.format(50)} por mês.
          </CardDescription>
        </CardHeader>
        <CardContent className='max-w-xs space-y-1.5'>
          <Label htmlFor='monthlyQuotaUsd'>Cota (US$)</Label>
          <Input
            id='monthlyQuotaUsd'
            inputMode='decimal'
            value={form.monthlyQuotaUsd}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                monthlyQuotaUsd: event.target.value,
              }))
            }
          />
        </CardContent>
      </Card>

      <div>
        <Button type='submit' disabled={update.isPending}>
          {update.isPending ? 'Salvando...' : 'Salvar ajustes de IA'}
        </Button>
      </div>
    </form>
  )
}

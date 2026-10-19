'use client'

import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import { useUpdatePlatformAiSettings } from '@/src/hooks/use-platform-ai-settings'
import {
  AI_TASK_CLASS_LABELS,
  AI_TASK_CLASSES,
  type AiTaskClass,
  DEFAULT_AI_MODEL_KEY,
  MAX_AI_COST_MARGIN,
  MIN_AI_COST_MARGIN,
} from '@/src/lib/ai/models'
import type { PlatformAiSettingsDTO } from '@/types/platform-ai-settings'
import { AdminPanel, DENSE_TABLE, formatDateTime } from '../shell/admin-ui'

const usdPrice = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
})

/** Select value for "no platform default" (null). */
const PLATFORM_DEFAULT = 'platform-default'

/** "1,3" or "1.3" → 1.3; NaN when it is not a number. */
function parseMargin(value: string): number {
  return Number(value.replace(',', '.'))
}

/**
 * Global admin: platform margin over the real provider price of every AI
 * call, plus the price table it produces.
 */
export function AdminAiSettingsPanel({
  initial,
}: {
  initial: PlatformAiSettingsDTO
}) {
  const update = useUpdatePlatformAiSettings()
  const [settings, setSettings] = useState(initial)
  const [margin, setMargin] = useState(String(initial.costMargin))
  const [reason, setReason] = useState('')

  const parsed = parseMargin(margin)
  const valid =
    Number.isFinite(parsed) &&
    parsed >= MIN_AI_COST_MARGIN &&
    parsed <= MAX_AI_COST_MARGIN
  const dirty = valid && parsed !== settings.costMargin
  const search = settings.knowledgeSearch

  function handleEmbeddings(enabled: boolean) {
    update.mutate(
      { costMargin: settings.costMargin, embeddingsEnabled: enabled },
      {
        onSuccess: (saved) => {
          setSettings(saved)
          notify.success(
            enabled
              ? 'Busca semântica ligada'
              : 'Busca semântica desligada: a busca segue só por texto',
          )
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível salvar a busca semântica'),
      },
    )
  }

  function saveRouting(
    patch: {
      taskModels?: Partial<Record<AiTaskClass, string | null>>
      failoverEnabled?: boolean
    },
    message: string,
  ) {
    update.mutate(
      { costMargin: settings.costMargin, ...patch },
      {
        onSuccess: (saved) => {
          setSettings(saved)
          notify.success(message)
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível salvar o modelo por tarefa'),
      },
    )
  }

  const defaultLabel = (taskClass: AiTaskClass) => {
    if (taskClass === 'AGENT') return 'Mesmo do assistente'
    const model = settings.models.find((m) => m.key === DEFAULT_AI_MODEL_KEY)
    return `Padrão da plataforma (${model?.label ?? DEFAULT_AI_MODEL_KEY})`
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid) {
      notify.error(
        new Error(
          `Informe uma margem entre ${MIN_AI_COST_MARGIN} e ${MAX_AI_COST_MARGIN}.`,
        ),
      )
      return
    }
    update.mutate(
      { costMargin: parsed, ...(reason.trim() && { reason: reason.trim() }) },
      {
        onSuccess: (saved) => {
          setSettings(saved)
          setMargin(String(saved.costMargin))
          setReason('')
          notify.success('Margem de IA salva')
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível salvar a margem'),
      },
    )
  }

  return (
    <div className='grid gap-4'>
      <AdminPanel
        title='Margem da plataforma'
        description='O custo de cada chamada de IA é o preço real do modelo (entrada e saída) multiplicado por esta margem. Vale para as próximas chamadas; o consumo já lançado não muda.'
      >
        <form
          onSubmit={handleSubmit}
          className='grid max-w-xl gap-4 sm:grid-cols-[10rem_1fr]'
        >
          <div className='grid gap-1.5'>
            <Label htmlFor='ai-cost-margin'>Margem (×)</Label>
            <Input
              id='ai-cost-margin'
              inputMode='decimal'
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              aria-invalid={!valid}
              aria-describedby='ai-cost-margin-hint'
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='ai-cost-margin-reason'>Motivo (opcional)</Label>
            <Input
              id='ai-cost-margin-reason'
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder='Fica na trilha de auditoria'
            />
          </div>
          <p
            id='ai-cost-margin-hint'
            className='text-muted-foreground text-xs sm:col-span-2'
          >
            1 = preço de custo; 1,3 = +30%. Aceita de {MIN_AI_COST_MARGIN} a{' '}
            {MAX_AI_COST_MARGIN}.{' '}
            {settings.updatedAt
              ? `Última alteração: ${formatDateTime(settings.updatedAt)}.`
              : 'Usando o padrão da plataforma.'}
          </p>
          <div className='sm:col-span-2'>
            <Button type='submit' disabled={!dirty || update.isPending}>
              {update.isPending ? 'Salvando...' : 'Salvar margem'}
            </Button>
          </div>
        </form>
      </AdminPanel>

      <AdminPanel
        title='Busca de conhecimento'
        description='O Steel AI busca em artigos, Wiki, chamados resolvidos, documentos da IA do WhatsApp e notas e propostas do CRM, por texto e por significado. A parte por significado usa embeddings da OpenAI (text-embedding-3-small, US$ 0,02 por 1 milhão de tokens × margem), lançados no consumo de IA de cada workspace.'
      >
        <div className='grid max-w-xl gap-3'>
          <div className='flex items-center justify-between gap-3'>
            <Label htmlFor='ai-embeddings-enabled' className='font-medium'>
              Busca semântica (embeddings)
            </Label>
            <Switch
              id='ai-embeddings-enabled'
              checked={settings.embeddingsEnabled}
              disabled={update.isPending}
              onCheckedChange={handleEmbeddings}
            />
          </div>
          <ul
            aria-label='Estado da busca de conhecimento'
            className='flex flex-wrap gap-1.5'
          >
            <li>
              <Badge
                variant={search.providerConfigured ? 'secondary' : 'outline'}
              >
                {search.providerConfigured
                  ? 'Chave da OpenAI configurada'
                  : 'Sem chave da OpenAI'}
              </Badge>
            </li>
            <li>
              <Badge
                variant={search.vectorIndexReady ? 'secondary' : 'outline'}
              >
                {search.vectorIndexReady
                  ? 'pgvector instalado'
                  : 'pgvector não instalado'}
              </Badge>
            </li>
            <li>
              <Badge variant={search.mode === 'hybrid' ? 'default' : 'outline'}>
                {search.mode === 'hybrid'
                  ? 'Modo: texto + significado'
                  : 'Modo: só texto'}
              </Badge>
            </li>
          </ul>
          <p className='text-muted-foreground text-xs'>
            Sem a chave, sem o pgvector ou com a chave desligada, a busca segue
            funcionando só por texto. Ligar de novo gera os embeddings que
            faltam na próxima reindexação (todo dia às 02:45).
          </p>
        </div>
      </AdminPanel>

      <AdminPanel
        title='Modelo por tipo de tarefa'
        description='Modelo inicial de cada tipo de tarefa para os workspaces que ainda não escolheram o seu em Ajustes › Steel IA. Classificar pede um modelo barato; o assistente e os agentes, um modelo forte.'
      >
        <div className='grid max-w-2xl gap-3'>
          {AI_TASK_CLASSES.map((taskClass) => (
            <div
              key={taskClass}
              className='grid gap-1.5 sm:grid-cols-[1fr_16rem] sm:items-center'
            >
              <Label className='font-normal'>
                {AI_TASK_CLASS_LABELS[taskClass]}
              </Label>
              <Select
                value={settings.taskModels[taskClass] ?? PLATFORM_DEFAULT}
                disabled={update.isPending}
                onValueChange={(value) => {
                  if (typeof value !== 'string') return
                  saveRouting(
                    {
                      taskModels: {
                        [taskClass]: value === PLATFORM_DEFAULT ? null : value,
                      },
                    },
                    'Modelo por tarefa salvo',
                  )
                }}
              >
                <SelectTrigger
                  aria-label={AI_TASK_CLASS_LABELS[taskClass]}
                  className='w-full'
                >
                  <SelectValue>
                    {(value: string) =>
                      value === PLATFORM_DEFAULT
                        ? defaultLabel(taskClass)
                        : (settings.models.find((m) => m.key === value)
                            ?.label ?? value)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectItem value={PLATFORM_DEFAULT}>
                      {defaultLabel(taskClass)}
                    </SelectItem>
                    {settings.models.map((model) => (
                      <SelectItem key={model.key} value={model.key}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className='flex items-center justify-between gap-3 border-t pt-3'>
            <div className='min-w-0'>
              <Label htmlFor='ai-failover-enabled' className='font-medium'>
                Contingência automática entre provedores
              </Label>
              <p className='text-muted-foreground text-xs'>
                Se um provedor falhar ou demorar, a chamada vai para outro
                modelo habilitado no workspace. Após 5 falhas em 1 minuto, o
                provedor fica 1 minuto fora (circuit breaker compartilhado entre
                as réplicas). Cada workspace também pode desligar.
              </p>
            </div>
            <Switch
              id='ai-failover-enabled'
              checked={settings.failoverEnabled}
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                saveRouting(
                  { failoverEnabled: checked === true },
                  checked
                    ? 'Contingência automática ligada'
                    : 'Contingência automática desligada',
                )
              }
            />
          </div>
        </div>
      </AdminPanel>

      <AdminPanel
        flush
        title='Preço por modelo'
        description='US$ por 1 milhão de tokens. "Cobrado" já inclui a margem salva.'
      >
        <div className='overflow-x-auto'>
          <Table className={DENSE_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead className='text-right'>Entrada</TableHead>
                <TableHead className='text-right'>Entrada em cache</TableHead>
                <TableHead className='text-right'>Saída</TableHead>
                <TableHead className='text-right'>Entrada cobrada</TableHead>
                <TableHead className='text-right'>Saída cobrada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {settings.models.map((model) => (
                <TableRow key={model.key}>
                  <TableCell className='font-medium'>{model.label}</TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {usdPrice.format(model.inputUsdPer1M)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {model.cachedInputUsdPer1M === null
                      ? '—'
                      : usdPrice.format(model.cachedInputUsdPer1M)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {usdPrice.format(model.outputUsdPer1M)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {usdPrice.format(model.chargedInputUsdPer1M)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {usdPrice.format(model.chargedOutputUsdPer1M)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </AdminPanel>
    </div>
  )
}

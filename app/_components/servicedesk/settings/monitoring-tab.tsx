'use client'

import {
  Copy01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  RefreshIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import {
  formatMonitorDateTime,
  SD_MONITOR_ALERT_STATUS_LABEL,
} from '@/app/_components/servicedesk/monitoring/sd-monitor-format'
import { SdMonitorUnmatchedPanel } from '@/app/_components/servicedesk/monitoring/sd-monitor-unmatched'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
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
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSdMonitorAlerts,
  useSdMonitorSourceMutations,
  useSdMonitorSources,
} from '@/src/hooks/use-sd-monitoring'
import {
  SD_GENERIC_PAYLOAD_EXAMPLE,
  SD_GRAFANA_SEVERITIES,
  SD_PRTG_PAYLOAD_EXAMPLE,
  SD_PRTG_SEVERITIES,
  SD_ZABBIX_SEVERITIES,
  sdZabbixPayloadExample,
} from '@/src/lib/servicedesk/monitor-fields'
import type {
  CreateSdMonitorSourceDTO,
  SdMonitorSeverityMapEntryDTO,
} from '@/src/schemas/sd-monitor-source.schema'
import type {
  SdMonitorCorrelationModeDTO,
  SdMonitorKindDTO,
  SdMonitorSourceDTO,
} from '@/types/sd-monitor'
import {
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  NumberInput,
  SD_TICKET_TYPE_OPTIONS,
  SettingsSection,
  SimpleSelect,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

export const SD_MONITOR_KIND_LABEL: Record<SdMonitorKindDTO, string> = {
  ZABBIX: 'Zabbix',
  GRAFANA: 'Grafana',
  PRTG: 'PRTG',
  WEBHOOK: 'Webhook genérico',
}

/** Severidades que cada ferramenta costuma mandar (atalhos do mapa). */
const SEVERITY_SUGGESTIONS: Record<SdMonitorKindDTO, string[]> = {
  ZABBIX: SD_ZABBIX_SEVERITIES,
  GRAFANA: SD_GRAFANA_SEVERITIES,
  PRTG: SD_PRTG_SEVERITIES,
  WEBHOOK: [],
}

const CORRELATION_OPTIONS: {
  value: SdMonitorCorrelationModeDTO
  label: string
}[] = [
  { value: 'HOST', label: 'Juntar alertas da mesma máquina' },
  { value: 'OFF', label: 'Um chamado por alerta' },
]

const formatDateTime = formatMonitorDateTime

/** URL pública a colar na ferramenta de monitoramento. */
export function sdMonitorWebhookUrl(path: string): string {
  const origin =
    NEXT_PUBLIC_URL ||
    (typeof window === 'undefined' ? '' : window.location.origin)
  return `${origin}${path}`
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify.success('Copiado')
  } catch {
    notify.error('Não foi possível copiar')
  }
}

function CopyRow({
  label,
  value,
  hint,
  copyLabel,
}: {
  label: string
  value: string
  hint?: string
  copyLabel: string
}) {
  return (
    <div className='flex flex-col gap-1 rounded-lg bg-muted px-3 py-2'>
      <span className='font-medium text-muted-foreground text-xs'>{label}</span>
      <div className='flex items-center gap-2'>
        <code className='min-w-0 flex-1 truncate text-xs'>{value}</code>
        <Button
          size='icon-xs'
          variant='ghost'
          aria-label={copyLabel}
          onClick={() => void copyText(value)}
        >
          <SteelIcon icon={Copy01Icon} strokeWidth={2} />
        </Button>
      </div>
      {hint ? (
        <p className='text-[11px] text-muted-foreground'>{hint}</p>
      ) : null}
    </div>
  )
}

/** O token em claro só existe neste momento — some ao fechar o diálogo. */
function TokenDialog({
  source,
  kind,
  token,
  onClose,
}: {
  source: string
  kind: SdMonitorKindDTO
  token: string
  onClose: () => void
}) {
  const url = sdMonitorWebhookUrl(`/api/servicedesk/monitoring/${token}`)
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>URL de {source}</DialogTitle>
          <DialogDescription>
            Copie agora: o token aparece uma única vez. Se perder, gere outro —
            o anterior deixa de valer na hora.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <CopyRow
            label='URL do webhook'
            value={url}
            copyLabel='Copiar a URL do webhook'
            hint='Qualquer um com esta URL abre chamado nesta workspace. Trate como senha.'
          />
          <SetupGuide kind={kind} />
        </div>
        <DialogFooter>
          <Button size='sm' onClick={onClose}>
            Já copiei
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Corpo para copiar e onde colar, conforme a ferramenta da origem. */
function SetupGuide({ kind }: { kind: SdMonitorKindDTO }) {
  const snippet =
    kind === 'ZABBIX'
      ? sdZabbixPayloadExample()
      : kind === 'PRTG'
        ? SD_PRTG_PAYLOAD_EXAMPLE
        : SD_GENERIC_PAYLOAD_EXAMPLE
  const title =
    kind === 'ZABBIX'
      ? 'Corpo do tipo de mídia do Zabbix'
      : kind === 'PRTG'
        ? 'Payload da ação HTTP do PRTG'
        : kind === 'GRAFANA'
          ? 'Corpo (opcional) do webhook'
          : 'Corpo do webhook genérico'

  return (
    <div className='flex flex-col gap-1 rounded-lg bg-muted px-3 py-2'>
      {kind === 'GRAFANA' ? (
        <p className='text-[11px] text-muted-foreground'>
          No Grafana: Alerting &gt; Contact points &gt; novo ponto de contato do
          tipo <strong>Webhook</strong>, método POST e a URL acima. Não é
          preciso mudar o corpo: o JSON padrão traz todos os alertas do envio e
          cada um abre (ou entra em) um chamado. Use o rótulo <code>host</code>{' '}
          (ou <code>instance</code>) nas regras para casar com a CMDB e{' '}
          <code>severity</code> para a prioridade.
        </p>
      ) : null}
      {kind === 'GRAFANA' ? null : (
        <>
          <span className='font-medium text-muted-foreground text-xs'>
            {title}
          </span>
          <pre className='overflow-x-auto text-[11px] leading-relaxed'>
            <code>{snippet}</code>
          </pre>
          <div className='flex justify-end'>
            <Button
              size='xs'
              variant='ghost'
              onClick={() => void copyText(snippet)}
            >
              <SteelIcon icon={Copy01Icon} strokeWidth={2} />
              Copiar o corpo
            </Button>
          </div>
        </>
      )}
      {kind === 'ZABBIX' ? (
        <p className='text-[11px] text-muted-foreground'>
          No Zabbix: Alertas &gt; Tipos de mídia &gt; novo tipo{' '}
          <strong>Webhook</strong>, URL acima, método POST e este JSON no
          parâmetro do corpo.
        </p>
      ) : null}
      {kind === 'PRTG' ? (
        <p className='text-[11px] text-muted-foreground'>
          No PRTG: Configurações &gt; Notificações &gt; nova notificação{' '}
          <strong>Executar ação HTTP</strong>, URL acima, método POST, tipo de
          conteúdo <code>application/json</code> e este texto no campo de
          payload. Use a mesma notificação para os gatilhos de estado{' '}
          <em>Down</em>, <em>Warning</em> e <em>Up</em>: o status{' '}
          <code>Up</code> normaliza o chamado.
        </p>
      ) : null}
      {kind === 'WEBHOOK' || kind === 'ZABBIX' ? (
        <>
          <p className='text-[11px] text-muted-foreground'>
            Um webhook genérico pode mandar assim (um Alertmanager, com{' '}
            <code>alerts[]</code>, também funciona):
          </p>
          {kind === 'ZABBIX' ? (
            <pre className='overflow-x-auto text-[11px] leading-relaxed'>
              <code>{SD_GENERIC_PAYLOAD_EXAMPLE}</code>
            </pre>
          ) : null}
          <p className='text-[11px] text-muted-foreground'>
            <code>status</code> aceita <code>PROBLEM</code>/<code>FIRING</code>{' '}
            e <code>OK</code>/<code>RESOLVED</code>.
          </p>
        </>
      ) : null}
    </div>
  )
}

interface SourceValues {
  name: string
  active: boolean
  kind: SdMonitorKindDTO
  ticketType: CreateSdMonitorSourceDTO['ticketType']
  departmentId: string | null
  categoryId: string | null
  severityMap: SdMonitorSeverityMapEntryDTO[]
  autoResolve: boolean
  flappingWindowMinutes: number
  correlationMode: SdMonitorCorrelationModeDTO
  correlationWindowMinutes: number
  raisePriorityOnCorrelation: boolean
}

function SourceDialog({
  source,
  saving,
  onClose,
  onSave,
}: {
  source: SdMonitorSourceDTO | null
  saving: boolean
  onClose: () => void
  onSave: (values: SourceValues) => void
}) {
  const { config } = useSdSettingsContext()
  const [values, setValues] = useState<SourceValues>({
    name: source?.name ?? '',
    active: source?.active ?? true,
    kind: source?.kind ?? 'ZABBIX',
    ticketType: source?.ticketType ?? 'INCIDENT',
    departmentId: source?.departmentId ?? null,
    categoryId: source?.categoryId ?? null,
    severityMap: source?.severityMap ?? [],
    autoResolve: source?.autoResolve ?? true,
    flappingWindowMinutes: source?.flappingWindowMinutes ?? 30,
    correlationMode: source?.correlationMode ?? 'HOST',
    correlationWindowMinutes: source?.correlationWindowMinutes ?? 60,
    raisePriorityOnCorrelation: source?.raisePriorityOnCorrelation ?? true,
  })

  function set<K extends keyof SourceValues>(key: K, value: SourceValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const departments = (config?.departments ?? []).flatMap((d) => [
    { value: d.id, label: d.name },
    ...d.children.map((c) => ({ value: c.id, label: `${d.name} › ${c.name}` })),
  ])
  const categories = (config?.categories ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const priorities = (config?.priorities ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))
  const suggestions = SEVERITY_SUGGESTIONS[values.kind].filter(
    (s) => !values.severityMap.some((e) => e.from === s),
  )

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {source ? 'Editar origem' : 'Nova origem de monitoramento'}
          </DialogTitle>
          <DialogDescription>
            Os alertas desta origem abrem chamado com estes padrões.
          </DialogDescription>
        </DialogHeader>
        <div className='flex max-h-[60vh] flex-col gap-4 overflow-y-auto'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <FieldBlock label='Nome'>
              <Input
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={120}
                placeholder='Zabbix matriz'
                autoFocus
              />
            </FieldBlock>
            <FieldBlock label='Ferramenta'>
              <SimpleSelect
                value={values.kind}
                onChange={(kind) => kind && set('kind', kind)}
                options={(
                  Object.keys(SD_MONITOR_KIND_LABEL) as SdMonitorKindDTO[]
                ).map((kind) => ({
                  value: kind,
                  label: SD_MONITOR_KIND_LABEL[kind],
                }))}
              />
            </FieldBlock>
          </div>

          <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
            <FieldBlock label='Tipo do chamado'>
              <SimpleSelect
                value={values.ticketType}
                onChange={(type) => type && set('ticketType', type)}
                options={SD_TICKET_TYPE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
              />
            </FieldBlock>
            <FieldBlock label='Departamento' hint='Vazio = roteamento padrão.'>
              <SimpleSelect
                value={values.departmentId}
                onChange={(id) => set('departmentId', id)}
                options={departments}
                allowEmpty
              />
            </FieldBlock>
            <FieldBlock label='Categoria' hint='Vazio = sem catálogo.'>
              <SimpleSelect
                value={values.categoryId}
                onChange={(id) => set('categoryId', id)}
                options={categories}
                allowEmpty
              />
            </FieldBlock>
          </div>

          <div className='flex flex-col gap-2 rounded-lg border border-border p-3'>
            <div className='flex flex-col gap-0.5'>
              <span className='text-sm font-medium'>
                Severidade → prioridade
              </span>
              <span className='text-xs text-muted-foreground'>
                A severidade do alerta define a prioridade do chamado. Sem
                correspondência, vale a matriz impacto × urgência.
              </span>
            </div>
            {values.severityMap.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                Nenhuma severidade mapeada.
              </p>
            ) : (
              <ul className='flex flex-col gap-2'>
                {values.severityMap.map((entry, index) => (
                  <li
                    key={`${entry.from}-${index}`}
                    className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2'
                  >
                    <Input
                      value={entry.from}
                      aria-label={`Severidade ${index + 1}`}
                      maxLength={60}
                      onChange={(e) =>
                        set(
                          'severityMap',
                          values.severityMap.map((item, i) =>
                            i === index
                              ? { ...item, from: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <SimpleSelect
                      value={entry.priorityId}
                      onChange={(priorityId) =>
                        priorityId &&
                        set(
                          'severityMap',
                          values.severityMap.map((item, i) =>
                            i === index ? { ...item, priorityId } : item,
                          ),
                        )
                      }
                      options={priorities}
                      placeholder='Prioridade'
                    />
                    <ConfirmDeleteButton
                      title='Remover severidade'
                      description={`"${entry.from || 'sem nome'}" deixa de definir a prioridade.`}
                      label='Remover'
                      onConfirm={() =>
                        set(
                          'severityMap',
                          values.severityMap.filter((_, i) => i !== index),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className='flex flex-wrap items-center gap-1.5'>
              <Button
                type='button'
                size='xs'
                variant='outline'
                disabled={priorities.length === 0}
                onClick={() =>
                  set('severityMap', [
                    ...values.severityMap,
                    { from: '', priorityId: priorities[0].value },
                  ])
                }
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Adicionar severidade
              </Button>
              {suggestions.map((severity) => (
                <Button
                  key={severity}
                  type='button'
                  size='xs'
                  variant='ghost'
                  disabled={priorities.length === 0}
                  onClick={() =>
                    set('severityMap', [
                      ...values.severityMap,
                      { from: severity, priorityId: priorities[0].value },
                    ])
                  }
                >
                  + {severity}
                </Button>
              ))}
            </div>
          </div>

          <ToggleRow
            label='Origem ativa'
            description='Desativada, a URL responde como token inválido e nenhum alerta entra.'
            checked={values.active}
            onCheckedChange={(checked) => set('active', checked)}
          />
          <ToggleRow
            label='Encerrar o chamado quando o alerta normalizar'
            description='Move para a fase resolvida do tipo com a solução automática. Se a fase exigir campos que o monitoramento não preenche, o chamado recebe uma mensagem pública em vez de ser encerrado.'
            checked={values.autoResolve}
            onCheckedChange={(checked) => set('autoResolve', checked)}
          />
          <FieldBlock
            label='Janela de instabilidade (minutos)'
            hint='O mesmo alerta voltando dentro da janela reabre o chamado anterior. 0 desliga.'
          >
            <NumberInput
              value={values.flappingWindowMinutes}
              onCommit={(value) => set('flappingWindowMinutes', value ?? 0)}
              min={0}
              max={1440}
              suffix='min'
            />
          </FieldBlock>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <FieldBlock
              label='Correlação'
              hint='Alerta novo da mesma máquina (item da CMDB ou host) entra no chamado que já está aberto, em vez de abrir outro.'
            >
              <SimpleSelect
                value={values.correlationMode}
                onChange={(mode) => mode && set('correlationMode', mode)}
                options={CORRELATION_OPTIONS}
              />
            </FieldBlock>
            <FieldBlock
              label='Janela de correlação (minutos)'
              hint='Conta desde a última atividade do alerta aberto da máquina.'
            >
              <NumberInput
                value={values.correlationWindowMinutes}
                onCommit={(value) =>
                  set('correlationWindowMinutes', Math.max(1, value ?? 60))
                }
                min={1}
                max={1440}
                suffix='min'
                disabled={values.correlationMode === 'OFF'}
              />
            </FieldBlock>
          </div>
          <ToggleRow
            label='Subir a prioridade quando o alerta correlacionado for mais grave'
            description='Se um alerta que entra num chamado aberto tem severidade mais alta que a prioridade atual (pelo mapa acima), a prioridade do chamado sobe e fica registrado no histórico. Nunca baixa.'
            checked={values.raisePriorityOnCorrelation}
            onCheckedChange={(checked) =>
              set('raisePriorityOnCorrelation', checked)
            }
          />
        </div>
        <DialogFooter>
          <Button variant='outline' size='sm' onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size='sm'
            disabled={
              saving ||
              !values.name.trim() ||
              values.severityMap.some((e) => !e.from.trim())
            }
            onClick={() => onSave({ ...values, name: values.name.trim() })}
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Alertas recentes da origem, com o chamado que cada um abriu. */
function SourceAlerts({
  workspaceId,
  sourceId,
}: {
  workspaceId: string
  sourceId: string
}) {
  const { data, isLoading, error } = useSdMonitorAlerts(workspaceId, {
    sourceId,
    limit: 10,
  })
  const alerts = data ?? []

  if (error) return <EmptyState>{error.message}</EmptyState>
  if (!isLoading && alerts.length === 0) {
    return <EmptyState>Nenhum alerta recebido desta origem ainda.</EmptyState>
  }
  return (
    <div className='overflow-x-auto rounded-lg border border-border'>
      <table className='w-full text-sm'>
        <thead className='bg-muted/50 text-left text-xs text-muted-foreground'>
          <tr>
            <th className='px-3 py-2 font-medium'>Alerta</th>
            <th className='px-3 py-2 font-medium'>Host</th>
            <th className='px-3 py-2 font-medium'>Severidade</th>
            <th className='px-3 py-2 font-medium'>Situação</th>
            <th className='px-3 py-2 font-medium'>Chamado</th>
            <th className='px-3 py-2 font-medium'>Início</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id} className='border-t border-border'>
              <td className='max-w-64 px-3 py-2'>
                <div className='truncate font-medium'>{alert.subject}</div>
                <div className='truncate font-mono text-[11px] text-muted-foreground'>
                  {alert.externalId}
                </div>
              </td>
              <td className='px-3 py-2'>
                {alert.configItem?.name ?? alert.host ?? '—'}
              </td>
              <td className='px-3 py-2'>{alert.severity ?? '—'}</td>
              <td className='px-3 py-2'>
                <Badge
                  variant={alert.status === 'OPEN' ? 'destructive' : 'outline'}
                >
                  {SD_MONITOR_ALERT_STATUS_LABEL[alert.status]}
                </Badge>
              </td>
              <td className='px-3 py-2'>
                {alert.ticket ? (
                  <span className='whitespace-nowrap'>
                    #{alert.ticket.number}{' '}
                    <span className='text-muted-foreground text-xs'>
                      {alert.ticket.phase}
                    </span>
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className='px-3 py-2 whitespace-nowrap'>
                {formatDateTime(alert.startedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; source: SdMonitorSourceDTO }
  | null

/**
 * Aba "Monitoramento" das configurações do ServiceDesk: origens que abrem
 * chamado sozinhas (Zabbix ou webhook genérico), com o token mostrado uma
 * única vez, o mapa severidade → prioridade e os alertas recentes.
 */
export function SdMonitoringTab() {
  const { workspaceId, canEdit, config } = useSdSettingsContext()
  const { data, isLoading, error } = useSdMonitorSources(workspaceId)
  const mutations = useSdMonitorSourceMutations(workspaceId)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [token, setToken] = useState<{
    source: string
    kind: SdMonitorKindDTO
    token: string
  } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const sources = data ?? []
  const priorityName = (id: string) =>
    config?.priorities.find((p) => p.id === id)?.name ?? id

  async function save(values: SourceValues) {
    try {
      if (dialog?.mode === 'edit') {
        await mutations.update.mutateAsync({
          id: dialog.source.id,
          data: values,
        })
        notify.success('Origem salva')
      } else {
        const created = await mutations.create.mutateAsync({
          ...values,
          customerId: null,
        })
        setToken({
          source: created.name,
          kind: created.kind,
          token: created.token,
        })
      }
      setDialog(null)
    } catch (err) {
      notify.error(err)
    }
  }

  async function rotate(source: SdMonitorSourceDTO) {
    try {
      const rotated = await mutations.regenerateToken.mutateAsync(source.id)
      setToken({
        source: rotated.name,
        kind: rotated.kind,
        token: rotated.token,
      })
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection
      title='Origens de monitoramento'
      description='Zabbix, Grafana, PRTG ou qualquer webhook: o alerta abre o chamado, o reenvio do mesmo alerta não abre outro, alertas da mesma máquina se juntam no mesmo chamado e a normalização encerra (ou avisa) o chamado.'
      actions={
        canEdit ? (
          <Button size='sm' onClick={() => setDialog({ mode: 'create' })}>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Nova origem
          </Button>
        ) : null
      }
    >
      {error ? (
        <EmptyState>{error.message}</EmptyState>
      ) : !isLoading && sources.length === 0 ? (
        <EmptyState>
          Nenhuma origem cadastrada. Crie uma para receber alertas do Zabbix,
          Grafana, PRTG ou de um webhook próprio.
        </EmptyState>
      ) : (
        <ul className='flex flex-col gap-2'>
          {sources.map((source) => (
            <li
              key={source.id}
              className={cn(
                'flex flex-col gap-3 rounded-lg border border-border p-3',
                !source.active && 'opacity-60',
              )}
            >
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='flex min-w-0 flex-col gap-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium text-sm'>{source.name}</span>
                    <Badge variant='outline'>
                      {SD_MONITOR_KIND_LABEL[source.kind]}
                    </Badge>
                    {source.active ? null : (
                      <Badge variant='secondary'>Inativa</Badge>
                    )}
                  </div>
                  <span className='text-xs text-muted-foreground'>
                    Último alerta: {formatDateTime(source.lastEventAt)} ·{' '}
                    {source.autoResolve
                      ? 'encerra na normalização'
                      : 'não encerra sozinha'}{' '}
                    · instabilidade {source.flappingWindowMinutes} min ·{' '}
                    {source.correlationMode === 'HOST'
                      ? `correlaciona por ${source.correlationWindowMinutes} min`
                      : 'sem correlação'}
                  </span>
                  {source.severityMap.length > 0 ? (
                    <span className='text-xs text-muted-foreground'>
                      {source.severityMap
                        .map(
                          (entry) =>
                            `${entry.from} → ${priorityName(entry.priorityId)}`,
                        )
                        .join(' · ')}
                    </span>
                  ) : null}
                </div>
                <div className='flex shrink-0 items-center gap-1'>
                  <Button
                    size='xs'
                    variant='ghost'
                    onClick={() =>
                      setOpen(open === source.id ? null : source.id)
                    }
                  >
                    {open === source.id ? 'Ocultar alertas' : 'Ver alertas'}
                  </Button>
                  {canEdit ? (
                    <>
                      <Button
                        size='xs'
                        variant='outline'
                        disabled={mutations.regenerateToken.isPending}
                        onClick={() => void rotate(source)}
                      >
                        <SteelIcon icon={RefreshIcon} strokeWidth={2} />
                        Gerar token
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-xs'
                        aria-label={`Editar ${source.name}`}
                        onClick={() => setDialog({ mode: 'edit', source })}
                      >
                        <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                      </Button>
                      <ConfirmDeleteButton
                        title='Excluir origem'
                        description={`"${source.name}" para de receber alertas e a URL deixa de valer. Os alertas já recebidos continuam no histórico.`}
                        pending={mutations.remove.isPending}
                        onConfirm={() =>
                          mutations.remove.mutate(source.id, {
                            onError: (err) => notify.error(err),
                          })
                        }
                      />
                    </>
                  ) : null}
                </div>
              </div>
              {open === source.id ? (
                <SourceAlerts workspaceId={workspaceId} sourceId={source.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <SdMonitorUnmatchedPanel workspaceId={workspaceId} canEdit={canEdit} />

      <p className='text-xs text-muted-foreground'>
        A URL com o token aparece uma única vez, na criação ou ao gerar um token
        novo. Guarde-a com o cuidado de uma senha.
      </p>

      {dialog ? (
        <SourceDialog
          source={dialog.mode === 'edit' ? dialog.source : null}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setDialog(null)}
          onSave={save}
        />
      ) : null}
      {token ? (
        <TokenDialog
          source={token.source}
          kind={token.kind}
          token={token.token}
          onClose={() => setToken(null)}
        />
      ) : null}
    </SettingsSection>
  )
}

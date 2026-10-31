'use client'

import {
  Copy01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  RefreshIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import {
  formatInventoryDateTime,
  SD_INVENTORY_SCAN_STATUS_LABEL,
} from '@/app/_components/servicedesk/inventory/sd-inventory-format'
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
import { Textarea } from '@/components/ui/textarea'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSdInventoryAgentReleases,
  useSdInventoryDiscoveryMutations,
  useSdInventoryDiscoveryRanges,
  useSdInventorySettings,
  useSdInventorySettingsMutation,
  useSdInventoryTargetMutations,
  useSdInventoryTargets,
  useSdInventoryTokenMutations,
  useSdInventoryTokens,
} from '@/src/hooks/use-sd-inventory'
import type {
  SdInventoryDiscoveryRangeDTO,
  SdInventorySnmpTargetDTO,
  SdSnmpAuthProtocolDTO,
  SdSnmpPrivProtocolDTO,
  SdSnmpVersionDTO,
} from '@/types/sd-inventory'
import {
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  NumberInput,
  ReadOnlyNotice,
  SettingsSection,
  SimpleSelect,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

function publicOrigin(): string {
  return (
    NEXT_PUBLIC_URL ||
    (typeof window === 'undefined' ? '' : window.location.origin)
  )
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify.success('Copiado')
  } catch {
    notify.error('Não foi possível copiar')
  }
}

/** Comandos de instalação do agente, já com a URL e o token. */
export function sdInventoryInstallSnippets(origin: string, token: string) {
  return {
    linux: `sudo ./steel-inventory-agent install --url ${origin} --token ${token}`,
  }
}

function CodeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col gap-1 rounded-lg bg-muted px-3 py-2'>
      <span className='font-medium text-muted-foreground text-xs'>{label}</span>
      <div className='flex items-center gap-2'>
        <code className='min-w-0 flex-1 break-all text-xs'>{value}</code>
        <Button
          size='icon-xs'
          variant='ghost'
          aria-label={`Copiar: ${label}`}
          onClick={() => void copyText(value)}
        >
          <SteelIcon icon={Copy01Icon} strokeWidth={2} />
        </Button>
      </div>
    </div>
  )
}

/** O valor do token só existe neste diálogo. */
function TokenDialog({
  name,
  token,
  onClose,
}: {
  name: string
  token: string
  onClose: () => void
}) {
  const snippets = sdInventoryInstallSnippets(publicOrigin(), token)
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Token de {name}</DialogTitle>
          <DialogDescription>
            Copie agora: o token aparece uma única vez. Se perder, revogue e
            crie outro.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <CodeRow label='Token' value={token} />
          <CodeRow
            label='Instalar no Linux (como root)'
            value={snippets.linux}
          />
          <p className='text-[11px] text-muted-foreground'>
            O token vale para todas as máquinas desta workspace que o usarem.
            Quem tem o token consegue enviar inventário: trate como senha.
          </p>
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

function AgentReleasesNote({
  workspaceId,
  enabled,
}: {
  workspaceId: string
  enabled: boolean
}) {
  const { data } = useSdInventoryAgentReleases(workspaceId, enabled)
  if (!enabled) return null
  const releases = data ?? []
  return (
    <p className='text-muted-foreground text-xs'>
      {releases.length === 0
        ? 'Nenhuma versão do agente foi publicada ainda: os agentes seguem na versão instalada.'
        : `Versão publicada: ${releases
            .map(
              (release) => `${release.version} (${release.os}/${release.arch})`,
            )
            .join(', ')}.`}
    </p>
  )
}

function SettingsBlock({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const { data, error } = useSdInventorySettings(workspaceId)
  const mutation = useSdInventorySettingsMutation(workspaceId)
  function save(patch: Parameters<typeof mutation.mutate>[0]) {
    mutation.mutate(patch, {
      onSuccess: () => notify.success('Ajustes salvos'),
      onError: (err) => notify.error(err),
    })
  }
  return (
    <SettingsSection
      title='Limiares e CMDB'
      description='Quando disco ou memória passam do limiar, o inventário abre um alerta e fecha sozinho quando o equipamento normaliza.'
    >
      {error ? (
        <EmptyState>{error.message}</EmptyState>
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
            <FieldBlock label='Alerta de disco' hint='Ocupação do volume.'>
              <NumberInput
                value={data?.diskThresholdPercent}
                min={50}
                max={100}
                suffix='%'
                disabled={!canEdit}
                onCommit={(value) =>
                  value !== null && save({ diskThresholdPercent: value })
                }
              />
            </FieldBlock>
            <FieldBlock label='Alerta de memória' hint='Memória em uso.'>
              <NumberInput
                value={data?.ramThresholdPercent}
                min={50}
                max={100}
                suffix='%'
                disabled={!canEdit}
                onCommit={(value) =>
                  value !== null && save({ ramThresholdPercent: value })
                }
              />
            </FieldBlock>
            <FieldBlock
              label='Sem sinal depois de'
              hint='Dias sem contato do equipamento.'
            >
              <NumberInput
                value={data?.staleAfterDays}
                min={1}
                max={365}
                suffix='dias'
                disabled={!canEdit}
                onCommit={(value) =>
                  value !== null && save({ staleAfterDays: value })
                }
              />
            </FieldBlock>
          </div>
          <ToggleRow
            label='Manter a CMDB atualizada'
            description='Cria o item de configuração de cada equipamento descoberto e atualiza série, fabricante, modelo e IP. Itens cadastrados à mão com a mesma série são aproveitados, não duplicados.'
            checked={data?.syncConfigItems ?? true}
            disabled={!canEdit || !data}
            onCheckedChange={(checked) => save({ syncConfigItems: checked })}
          />
          <ToggleRow
            label='Atualizar o agente automaticamente'
            description='Os agentes consultam a versão publicada, baixam o novo binário, conferem o SHA-256 e voltam à versão anterior se o novo não iniciar. Desligado por padrão.'
            checked={data?.agentAutoUpdate ?? false}
            disabled={!canEdit || !data}
            onCheckedChange={(checked) => save({ agentAutoUpdate: checked })}
          />
          <AgentReleasesNote workspaceId={workspaceId} enabled={canEdit} />
        </div>
      )}
    </SettingsSection>
  )
}

function TokensBlock({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useSdInventoryTokens(workspaceId)
  const mutations = useSdInventoryTokenMutations(workspaceId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [shown, setShown] = useState<{ name: string; token: string } | null>(
    null,
  )
  const tokens = data ?? []

  async function create() {
    try {
      const created = await mutations.create.mutateAsync({ name: name.trim() })
      setShown({ name: created.name, token: created.token })
      setCreating(false)
      setName('')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection
      title='Agente de inventário'
      description='O agente roda nos computadores Linux e envia hardware, software e uso de disco e memória. Cada token identifica a workspace; use um por site ou por lote de máquinas para poder revogar separado.'
      actions={
        <Button size='sm' onClick={() => setCreating(true)}>
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Novo token
        </Button>
      }
    >
      {error ? (
        <EmptyState>{error.message}</EmptyState>
      ) : !isLoading && tokens.length === 0 ? (
        <EmptyState>
          Nenhum token criado. Crie um para instalar o agente nas máquinas.
        </EmptyState>
      ) : (
        <ul className='flex flex-col gap-2'>
          {tokens.map((token) => (
            <li
              key={token.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3',
                token.revokedAt && 'opacity-60',
              )}
            >
              <div className='flex min-w-0 flex-col gap-1'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium text-sm'>{token.name}</span>
                  {token.revokedAt ? (
                    <Badge variant='secondary'>Revogado</Badge>
                  ) : null}
                </div>
                <span className='text-muted-foreground text-xs'>
                  Criado em {formatInventoryDateTime(token.createdAt)} · último
                  envio {formatInventoryDateTime(token.lastUsedAt)}
                </span>
              </div>
              {token.revokedAt ? null : (
                <ConfirmDeleteButton
                  title='Revogar token'
                  description={`Os agentes que usam "${token.name}" param de enviar na hora. Os equipamentos já inventariados continuam na lista.`}
                  pending={mutations.revoke.isPending}
                  onConfirm={() =>
                    mutations.revoke.mutate(token.id, {
                      onError: (err) => notify.error(err),
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Novo token do agente</DialogTitle>
            <DialogDescription>
              Dê um nome que diga onde ele será usado.
            </DialogDescription>
          </DialogHeader>
          <FieldBlock label='Nome'>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder='Matriz — estações'
              autoFocus
            />
          </FieldBlock>
          <DialogFooter>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setCreating(false)}
            >
              Cancelar
            </Button>
            <Button
              size='sm'
              disabled={name.trim() === '' || mutations.create.isPending}
              onClick={() => void create()}
            >
              Criar token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {shown ? (
        <TokenDialog
          name={shown.name}
          token={shown.token}
          onClose={() => setShown(null)}
        />
      ) : null}
    </SettingsSection>
  )
}

const INTERVAL_OPTIONS = [
  { value: '60', label: 'A cada hora' },
  { value: '360', label: 'A cada 6 horas' },
  { value: '720', label: 'A cada 12 horas' },
  { value: '1440', label: 'Uma vez por dia' },
  { value: '10080', label: 'Uma vez por semana' },
]

const SNMP_VERSION_OPTIONS = [
  { value: 'V2C', label: 'SNMP v2c (community)' },
  { value: 'V3', label: 'SNMP v3 (usuário e chaves)' },
]
const AUTH_PROTOCOL_OPTIONS = [
  { value: 'SHA', label: 'SHA' },
  { value: 'SHA256', label: 'SHA-256' },
  { value: 'SHA384', label: 'SHA-384' },
  { value: 'SHA512', label: 'SHA-512' },
  { value: 'SHA224', label: 'SHA-224' },
  { value: 'MD5', label: 'MD5 (legado)' },
]
const PRIV_PROTOCOL_OPTIONS = [
  { value: 'AES', label: 'AES-128' },
  { value: 'AES256B', label: 'AES-256 (Blumenthal)' },
  { value: 'AES256R', label: 'AES-256 (Reeder)' },
  { value: 'DES', label: 'DES (legado)' },
]

interface TargetValues {
  name: string
  ranges: string
  snmpVersion: SdSnmpVersionDTO
  community: string
  v3Username: string
  v3AuthProtocol: SdSnmpAuthProtocolDTO
  v3AuthKey: string
  v3PrivProtocol: SdSnmpPrivProtocolDTO
  v3PrivKey: string
  port: number
  intervalMinutes: string
  active: boolean
}

function TargetDialog({
  target,
  saving,
  onClose,
  onSave,
}: {
  target: SdInventorySnmpTargetDTO | null
  saving: boolean
  onClose: () => void
  onSave: (values: TargetValues) => void
}) {
  const [values, setValues] = useState<TargetValues>({
    name: target?.name ?? '',
    ranges: target?.ranges.join('\n') ?? '',
    snmpVersion: target?.snmpVersion ?? 'V2C',
    community: '',
    v3Username: target?.v3Username ?? '',
    v3AuthProtocol: target?.v3AuthProtocol ?? 'SHA',
    v3AuthKey: '',
    v3PrivProtocol: target?.v3PrivProtocol ?? 'AES',
    v3PrivKey: '',
    port: target?.port ?? 161,
    intervalMinutes: String(target?.intervalMinutes ?? 1440),
    active: target?.active ?? true,
  })
  function set<K extends keyof TargetValues>(key: K, value: TargetValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }
  const isV3 = values.snmpVersion === 'V3'
  const keptV3 = target?.snmpVersion === 'V3'
  const keptV2c = target?.snmpVersion === 'V2C'
  const authReady =
    values.v3AuthKey.length >= 8 ||
    (keptV3 && !!target?.hasV3AuthKey && values.v3AuthKey === '')
  const credentialsReady = isV3
    ? values.v3Username.trim() !== '' &&
      (values.v3AuthKey === '' || values.v3AuthKey.length >= 8) &&
      (values.v3PrivKey === '' || values.v3PrivKey.length >= 8) &&
      // Privacidade exige autenticação (chave nova ou já guardada).
      (values.v3PrivKey === '' || authReady)
    : values.community !== '' || keptV2c
  const valid =
    values.name.trim() !== '' && values.ranges.trim() !== '' && credentialsReady

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {target ? 'Editar alvo SNMP' : 'Novo alvo de varredura SNMP'}
          </DialogTitle>
          <DialogDescription>
            O worker varre as faixas na frequência escolhida, em SNMP v2c ou v3,
            e leva o que encontrar para o inventário e a CMDB.
          </DialogDescription>
        </DialogHeader>
        <div className='flex max-h-[60vh] flex-col gap-4 overflow-y-auto'>
          <FieldBlock label='Nome'>
            <Input
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={120}
              placeholder='Rede da matriz'
              autoFocus
            />
          </FieldBlock>
          <FieldBlock
            label='Faixas de endereço'
            hint='Uma por linha: CIDR (10.0.0.0/24) ou IP avulso. Até 1.024 endereços no total.'
          >
            <Textarea
              value={values.ranges}
              onChange={(e) => set('ranges', e.target.value)}
              rows={4}
              placeholder={'10.0.0.0/24\n192.168.1.10'}
            />
          </FieldBlock>
          <FieldBlock label='Versão do SNMP'>
            <SimpleSelect
              value={values.snmpVersion}
              onChange={(value) =>
                value && set('snmpVersion', value as SdSnmpVersionDTO)
              }
              options={SNMP_VERSION_OPTIONS}
            />
          </FieldBlock>
          {isV3 ? (
            <div className='flex flex-col gap-4 rounded-lg border border-border p-3'>
              <FieldBlock label='Usuário'>
                <Input
                  aria-label='Usuário SNMPv3'
                  autoComplete='off'
                  value={values.v3Username}
                  onChange={(e) => set('v3Username', e.target.value)}
                  maxLength={64}
                />
              </FieldBlock>
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <FieldBlock label='Autenticação'>
                  <SimpleSelect
                    value={values.v3AuthProtocol}
                    onChange={(value) =>
                      value &&
                      set('v3AuthProtocol', value as SdSnmpAuthProtocolDTO)
                    }
                    options={AUTH_PROTOCOL_OPTIONS}
                  />
                </FieldBlock>
                <FieldBlock
                  label='Chave de autenticação'
                  hint={
                    target?.hasV3AuthKey
                      ? 'Em branco mantém a atual. Mínimo de 8 caracteres.'
                      : 'Opcional; mínimo de 8 caracteres. Guardada cifrada.'
                  }
                >
                  <Input
                    type='password'
                    autoComplete='off'
                    value={values.v3AuthKey}
                    onChange={(e) => set('v3AuthKey', e.target.value)}
                    maxLength={128}
                  />
                </FieldBlock>
                <FieldBlock label='Privacidade'>
                  <SimpleSelect
                    value={values.v3PrivProtocol}
                    onChange={(value) =>
                      value &&
                      set('v3PrivProtocol', value as SdSnmpPrivProtocolDTO)
                    }
                    options={PRIV_PROTOCOL_OPTIONS}
                  />
                </FieldBlock>
                <FieldBlock
                  label='Chave de privacidade'
                  hint={
                    target?.hasV3PrivKey
                      ? 'Em branco mantém a atual. Mínimo de 8 caracteres.'
                      : 'Opcional; exige a chave de autenticação. Guardada cifrada.'
                  }
                >
                  <Input
                    type='password'
                    autoComplete='off'
                    value={values.v3PrivKey}
                    onChange={(e) => set('v3PrivKey', e.target.value)}
                    maxLength={128}
                  />
                </FieldBlock>
              </div>
            </div>
          ) : null}
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            {isV3 ? null : (
              <FieldBlock
                label='Community'
                hint={
                  keptV2c
                    ? 'Deixe em branco para manter a atual.'
                    : 'Guardada cifrada; não volta a ser exibida.'
                }
              >
                <Input
                  type='password'
                  autoComplete='off'
                  value={values.community}
                  onChange={(e) => set('community', e.target.value)}
                  maxLength={128}
                />
              </FieldBlock>
            )}
            <FieldBlock label='Porta'>
              <NumberInput
                value={values.port}
                min={1}
                max={65535}
                onCommit={(value) => value !== null && set('port', value)}
              />
            </FieldBlock>
          </div>
          <FieldBlock label='Frequência'>
            <SimpleSelect
              value={values.intervalMinutes}
              onChange={(value) => value && set('intervalMinutes', value)}
              options={INTERVAL_OPTIONS}
            />
          </FieldBlock>
          <ToggleRow
            label='Alvo ativo'
            checked={values.active}
            onCheckedChange={(checked) => set('active', checked)}
          />
        </div>
        <DialogFooter>
          <Button size='sm' variant='outline' onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size='sm'
            disabled={!valid || saving}
            onClick={() => onSave(values)}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TargetDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; target: SdInventorySnmpTargetDTO }
  | null

function TargetsBlock({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useSdInventoryTargets(workspaceId)
  const mutations = useSdInventoryTargetMutations(workspaceId)
  const [dialog, setDialog] = useState<TargetDialogState>(null)
  const targets = data ?? []

  async function save(values: TargetValues) {
    const payload = {
      name: values.name.trim(),
      ranges: values.ranges
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      port: values.port,
      snmpVersion: values.snmpVersion,
      intervalMinutes: Number(values.intervalMinutes),
      active: values.active,
      ...(values.snmpVersion === 'V2C'
        ? values.community
          ? { community: values.community }
          : {}
        : {
            v3Username: values.v3Username.trim(),
            v3AuthProtocol: values.v3AuthProtocol,
            v3PrivProtocol: values.v3PrivProtocol,
            ...(values.v3AuthKey ? { v3AuthKey: values.v3AuthKey } : {}),
            ...(values.v3PrivKey ? { v3PrivKey: values.v3PrivKey } : {}),
          }),
    }
    try {
      if (dialog?.mode === 'edit') {
        await mutations.update.mutateAsync({
          id: dialog.target.id,
          data: payload,
        })
        notify.success('Alvo salvo')
      } else {
        await mutations.create.mutateAsync(payload)
        notify.success('Alvo criado — a primeira varredura roda em instantes')
      }
      setDialog(null)
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection
      title='Varredura SNMP'
      description='Descobre switches, impressoras, firewalls e servidores que respondem a SNMP, sem instalar nada neles.'
      actions={
        <Button size='sm' onClick={() => setDialog({ mode: 'create' })}>
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Novo alvo
        </Button>
      }
    >
      {error ? (
        <EmptyState>{error.message}</EmptyState>
      ) : !isLoading && targets.length === 0 ? (
        <EmptyState>
          Nenhum alvo cadastrado. Informe uma faixa de rede e a community
          somente leitura.
        </EmptyState>
      ) : (
        <ul className='flex flex-col gap-2'>
          {targets.map((target) => (
            <li
              key={target.id}
              className={cn(
                'flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3',
                !target.active && 'opacity-60',
              )}
            >
              <div className='flex min-w-0 flex-col gap-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium text-sm'>{target.name}</span>
                  {target.active ? null : (
                    <Badge variant='secondary'>Inativo</Badge>
                  )}
                  {target.lastStatus ? (
                    <Badge
                      variant={
                        target.lastStatus === 'FAILED'
                          ? 'destructive'
                          : 'outline'
                      }
                    >
                      {SD_INVENTORY_SCAN_STATUS_LABEL[target.lastStatus]}
                    </Badge>
                  ) : null}
                </div>
                <span className='font-mono text-muted-foreground text-xs'>
                  {target.ranges.join(' · ')} ·{' '}
                  {target.snmpVersion === 'V3' ? 'SNMPv3' : 'SNMPv2c'}
                </span>
                <span className='text-muted-foreground text-xs'>
                  Última varredura {formatInventoryDateTime(target.lastRunAt)} ·{' '}
                  {target.lastFound} equipamento(s) · próxima{' '}
                  {formatInventoryDateTime(target.nextRunAt)}
                </span>
                {target.lastError ? (
                  <span className='text-destructive text-xs'>
                    {target.lastError}
                  </span>
                ) : null}
              </div>
              <div className='flex shrink-0 items-center gap-1'>
                <Button
                  size='xs'
                  variant='outline'
                  disabled={mutations.scanNow.isPending || !target.active}
                  onClick={() =>
                    mutations.scanNow.mutate(target.id, {
                      onSuccess: () => notify.success('Varredura na fila'),
                      onError: (err) => notify.error(err),
                    })
                  }
                >
                  <SteelIcon icon={RefreshIcon} strokeWidth={2} />
                  Varrer agora
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Editar ${target.name}`}
                  onClick={() => setDialog({ mode: 'edit', target })}
                >
                  <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                </Button>
                <ConfirmDeleteButton
                  title='Excluir alvo'
                  description={`"${target.name}" deixa de ser varrido. Os equipamentos já descobertos continuam no inventário.`}
                  pending={mutations.remove.isPending}
                  onConfirm={() =>
                    mutations.remove.mutate(target.id, {
                      onError: (err) => notify.error(err),
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog ? (
        <TargetDialog
          target={dialog.mode === 'edit' ? dialog.target : null}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setDialog(null)}
          onSave={save}
        />
      ) : null}
    </SettingsSection>
  )
}

const DISCOVERY_INTERVAL_OPTIONS = INTERVAL_OPTIONS

interface DiscoveryValues {
  name: string
  cidr: string
  intervalMinutes: string
  enabled: boolean
}

function DiscoveryDialog({
  range,
  saving,
  onClose,
  onSave,
}: {
  range: SdInventoryDiscoveryRangeDTO | null
  saving: boolean
  onClose: () => void
  onSave: (values: DiscoveryValues) => void
}) {
  const [values, setValues] = useState<DiscoveryValues>({
    name: range?.name ?? '',
    cidr: range?.cidr ?? '',
    intervalMinutes: String(range?.intervalMinutes ?? 1440),
    enabled: range?.enabled ?? false,
  })
  function set<K extends keyof DiscoveryValues>(
    key: K,
    value: DiscoveryValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }))
  }
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {range ? 'Editar faixa de descoberta' : 'Nova faixa de descoberta'}
          </DialogTitle>
          <DialogDescription>
            O worker faz ping e consulta a tabela ARP da faixa. O que responder
            entra no inventário como "descoberto" e só vai para a CMDB quando
            você adota.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <FieldBlock label='Nome'>
            <Input
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={120}
              placeholder='VLAN de estações'
              autoFocus
            />
          </FieldBlock>
          <FieldBlock
            label='Faixa de endereços'
            hint='CIDR de rede privada (ex.: 10.0.1.0/24), até 1.024 endereços. Redes públicas são recusadas.'
          >
            <Input
              value={values.cidr}
              onChange={(e) => set('cidr', e.target.value)}
              maxLength={64}
              placeholder='10.0.1.0/24'
            />
          </FieldBlock>
          <FieldBlock
            label='Frequência'
            hint='No máximo 40 sondas por segundo.'
          >
            <SimpleSelect
              value={values.intervalMinutes}
              onChange={(value) => value && set('intervalMinutes', value)}
              options={DISCOVERY_INTERVAL_OPTIONS}
            />
          </FieldBlock>
          <ToggleRow
            label='Varrer esta faixa'
            description='Nada é sondado enquanto estiver desligado.'
            checked={values.enabled}
            onCheckedChange={(checked) => set('enabled', checked)}
          />
        </div>
        <DialogFooter>
          <Button size='sm' variant='outline' onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size='sm'
            disabled={
              values.name.trim() === '' || values.cidr.trim() === '' || saving
            }
            onClick={() => onSave(values)}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type DiscoveryDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; range: SdInventoryDiscoveryRangeDTO }
  | null

function DiscoveryBlock({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useSdInventoryDiscoveryRanges(workspaceId)
  const mutations = useSdInventoryDiscoveryMutations(workspaceId)
  const [dialog, setDialog] = useState<DiscoveryDialogState>(null)
  const ranges = data ?? []

  async function save(values: DiscoveryValues) {
    const payload = {
      name: values.name.trim(),
      cidr: values.cidr.trim(),
      intervalMinutes: Number(values.intervalMinutes),
      enabled: values.enabled,
    }
    try {
      if (dialog?.mode === 'edit') {
        await mutations.update.mutateAsync({
          id: dialog.range.id,
          data: payload,
        })
        notify.success('Faixa salva')
      } else {
        await mutations.create.mutateAsync(payload)
        notify.success('Faixa criada')
      }
      setDialog(null)
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection
      title='Descoberta por ping e ARP'
      description='Acha computadores e equipamentos que não têm agente nem SNMP. Cada faixa só é varrida com a opção ligada, e os achados esperam a sua adoção.'
      actions={
        <Button size='sm' onClick={() => setDialog({ mode: 'create' })}>
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Nova faixa
        </Button>
      }
    >
      {error ? (
        <EmptyState>{error.message}</EmptyState>
      ) : !isLoading && ranges.length === 0 ? (
        <EmptyState>
          Nenhuma faixa cadastrada. A descoberta só roda nas redes que você
          liberar aqui.
        </EmptyState>
      ) : (
        <ul className='flex flex-col gap-2'>
          {ranges.map((range) => (
            <li
              key={range.id}
              className={cn(
                'flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3',
                !range.enabled && 'opacity-60',
              )}
            >
              <div className='flex min-w-0 flex-col gap-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium text-sm'>{range.name}</span>
                  {range.enabled ? null : (
                    <Badge variant='secondary'>Desligada</Badge>
                  )}
                  {range.lastStatus ? (
                    <Badge
                      variant={
                        range.lastStatus === 'FAILED'
                          ? 'destructive'
                          : 'outline'
                      }
                    >
                      {SD_INVENTORY_SCAN_STATUS_LABEL[range.lastStatus]}
                    </Badge>
                  ) : null}
                </div>
                <span className='font-mono text-muted-foreground text-xs'>
                  {range.cidr}
                </span>
                <span className='text-muted-foreground text-xs'>
                  Última varredura {formatInventoryDateTime(range.lastRunAt)} ·{' '}
                  {range.lastFound} achado(s) de {range.lastProbed} endereços ·
                  próxima {formatInventoryDateTime(range.nextRunAt)}
                </span>
                {range.lastError ? (
                  <span className='text-destructive text-xs'>
                    {range.lastError}
                  </span>
                ) : null}
              </div>
              <div className='flex shrink-0 items-center gap-1'>
                <Button
                  size='xs'
                  variant='outline'
                  disabled={mutations.scanNow.isPending || !range.enabled}
                  onClick={() =>
                    mutations.scanNow.mutate(range.id, {
                      onSuccess: () => notify.success('Descoberta na fila'),
                      onError: (err) => notify.error(err),
                    })
                  }
                >
                  <SteelIcon icon={RefreshIcon} strokeWidth={2} />
                  Varrer agora
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Editar ${range.name}`}
                  onClick={() => setDialog({ mode: 'edit', range })}
                >
                  <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                </Button>
                <ConfirmDeleteButton
                  title='Excluir faixa'
                  description={`"${range.name}" deixa de ser varrida. Os equipamentos já descobertos continuam no inventário.`}
                  pending={mutations.remove.isPending}
                  onConfirm={() =>
                    mutations.remove.mutate(range.id, {
                      onError: (err) => notify.error(err),
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog ? (
        <DiscoveryDialog
          range={dialog.mode === 'edit' ? dialog.range : null}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setDialog(null)}
          onSave={save}
        />
      ) : null}
    </SettingsSection>
  )
}

/**
 * Aba "Inventário" das configurações do ServiceDesk: limiares de alerta, os
 * tokens do agente (mostrados uma única vez), os alvos da varredura SNMP e as
 * faixas da descoberta por ping/ARP.
 * Tokens e alvos são só de admin; os demais veem os limiares em leitura.
 */
export function SdInventoryTab() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  return (
    <div className='flex flex-col gap-5'>
      {canEdit ? null : <ReadOnlyNotice />}
      <SettingsBlock workspaceId={workspaceId} canEdit={canEdit} />
      {canEdit ? (
        <>
          <TokensBlock workspaceId={workspaceId} />
          <TargetsBlock workspaceId={workspaceId} />
          <DiscoveryBlock workspaceId={workspaceId} />
        </>
      ) : null}
    </div>
  )
}

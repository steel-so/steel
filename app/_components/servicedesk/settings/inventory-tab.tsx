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
  useSdInventorySettings,
  useSdInventorySettingsMutation,
  useSdInventoryTargetMutations,
  useSdInventoryTargets,
  useSdInventoryTokenMutations,
  useSdInventoryTokens,
} from '@/src/hooks/use-sd-inventory'
import type { SdInventorySnmpTargetDTO } from '@/types/sd-inventory'
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
    windows: `.\\steel-inventory-agent.exe install --url ${origin} --token ${token}`,
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
          <CodeRow
            label='Instalar no Windows (PowerShell como administrador)'
            value={snippets.windows}
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
      description='O agente roda nos computadores Windows e Linux e envia hardware, software e uso de disco e memória. Cada token identifica a workspace; use um por site ou por lote de máquinas para poder revogar separado.'
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

interface TargetValues {
  name: string
  ranges: string
  community: string
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
    community: '',
    port: target?.port ?? 161,
    intervalMinutes: String(target?.intervalMinutes ?? 1440),
    active: target?.active ?? true,
  })
  function set<K extends keyof TargetValues>(key: K, value: TargetValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }
  const valid =
    values.name.trim() !== '' &&
    values.ranges.trim() !== '' &&
    (target !== null || values.community !== '')

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {target ? 'Editar alvo SNMP' : 'Novo alvo de varredura SNMP'}
          </DialogTitle>
          <DialogDescription>
            O worker varre as faixas na frequência escolhida, em SNMP v2c, e
            leva o que encontrar para o inventário e a CMDB.
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
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <FieldBlock
              label='Community'
              hint={
                target
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
      intervalMinutes: Number(values.intervalMinutes),
      active: values.active,
      ...(values.community ? { community: values.community } : {}),
    }
    try {
      if (dialog?.mode === 'edit') {
        await mutations.update.mutateAsync({
          id: dialog.target.id,
          data: payload,
        })
        notify.success('Alvo salvo')
      } else {
        await mutations.create.mutateAsync({
          ...payload,
          community: values.community,
        })
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
                  {target.ranges.join(' · ')}
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

/**
 * Aba "Inventário" das configurações do ServiceDesk: limiares de alerta, os
 * tokens do agente (mostrados uma única vez) e os alvos da varredura SNMP.
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
        </>
      ) : null}
    </div>
  )
}

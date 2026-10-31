'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import {
  useSdRemoteSettings,
  useSdRemoteSettingsMutation,
} from '@/src/hooks/use-sd-remote'
import {
  SD_REMOTE_PROVIDERS,
  type SdRemoteProviderKey,
} from '@/src/lib/servicedesk/remote-access'
import {
  EmptyState,
  FieldBlock,
  SettingsSection,
  SimpleSelect,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

const PROVIDER_OPTIONS = (
  Object.keys(SD_REMOTE_PROVIDERS) as SdRemoteProviderKey[]
).map((value) => ({ value, label: SD_REMOTE_PROVIDERS[value].label }))

/** Ajustes do acesso remoto integrado (S4): liga o recurso e escolhe o provedor. */
export function SdRemoteTab() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const { data, error } = useSdRemoteSettings(workspaceId)
  const mutation = useSdRemoteSettingsMutation(workspaceId)
  const [template, setTemplate] = useState('')

  useEffect(() => {
    setTemplate(data?.linkTemplate ?? '')
  }, [data?.linkTemplate])

  function save(patch: Parameters<typeof mutation.mutate>[0]) {
    mutation.mutate(patch, {
      onSuccess: () => notify.success('Ajustes salvos'),
      onError: (err) => notify.error(err),
    })
  }

  const provider = data?.provider ?? 'RUSTDESK'

  return (
    <SettingsSection
      title='Acesso remoto'
      description='O botão "Conectar" aparece no chamado e no ativo da CMDB e abre o cliente instalado no computador do técnico. Cada ativo guarda só o ID público da máquina; nenhuma senha é armazenada, e cada conexão fica no histórico do chamado e na auditoria.'
    >
      {error ? (
        <EmptyState>{error.message}</EmptyState>
      ) : (
        <div className='flex flex-col gap-4'>
          <ToggleRow
            label='Ativar o acesso remoto'
            description='Desligado por padrão. Quando desligado, o botão "Conectar" não aparece.'
            checked={data?.enabled ?? false}
            disabled={!canEdit || !data}
            onCheckedChange={(enabled) => save({ enabled })}
          />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <FieldBlock
              label='Ferramenta do workspace'
              hint={SD_REMOTE_PROVIDERS[provider].idHint}
            >
              <SimpleSelect
                value={provider}
                options={PROVIDER_OPTIONS}
                disabled={!canEdit || !data}
                onChange={(value) => value && save({ provider: value })}
              />
            </FieldBlock>
            <FieldBlock
              label='Modelo do link (opcional)'
              hint={`Use {id} no lugar do ID. Padrão: ${SD_REMOTE_PROVIDERS[provider].defaultTemplate}`}
            >
              <Input
                value={template}
                disabled={!canEdit || !data}
                placeholder={SD_REMOTE_PROVIDERS[provider].defaultTemplate}
                onChange={(event) => setTemplate(event.target.value)}
                onBlur={() => {
                  const next = template.trim()
                  if (next !== (data?.linkTemplate ?? '')) {
                    save({ linkTemplate: next || null })
                  }
                }}
              />
            </FieldBlock>
          </div>
          <p className='text-xs text-muted-foreground'>
            O técnico precisa ter o RustDesk ou o AnyDesk instalado. O ID de
            cada máquina é cadastrado na tela do ativo (aba Dados) ou chega
            sozinho quando o agente de inventário o informa.
          </p>
        </div>
      )}
    </SettingsSection>
  )
}

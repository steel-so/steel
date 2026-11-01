'use client'

import { useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  NEXT_PUBLIC_META_APP_ID,
  NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID,
} from '@/lib/env/env'
import { notify } from '@/lib/notify'
import {
  type UpdateMetaChannelSettingsInput,
  useConnectWhatsAppCoexistence,
  useMetaChannelConnections,
  useMetaChannelSettings,
  useUpdateMetaChannelSettings,
  useWhatsAppCoexistenceSync,
} from '@/src/hooks/use-whatsapp-meta-channels'
import { launchEmbeddedSignup } from '@/src/lib/whatsapp/embedded-signup-client'
import type {
  MetaChannelConnectionDTO,
  WhatsAppCoexistenceStatusDTO,
} from '@/types/whatsapp-meta-channel'

const SYNC_STATUS_LABEL: Record<WhatsAppCoexistenceStatusDTO, string> = {
  PENDING: 'Aguardando o cliente compartilhar o histórico no aplicativo',
  SYNCING: 'Importando contatos e conversas',
  COMPLETED: 'Importação concluída',
  DECLINED: 'O cliente não compartilhou o histórico',
  FAILED: 'A importação falhou',
}

interface SwitchRowProps {
  id: keyof UpdateMetaChannelSettingsInput
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

function SwitchRow({
  id,
  title,
  description,
  checked,
  disabled,
  onChange,
}: SwitchRowProps) {
  return (
    <div className='flex items-start justify-between gap-3'>
      <div>
        <Label htmlFor={id}>{title}</Label>
        <p className='text-muted-foreground text-xs'>{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}

function CoexistenceRow({
  workspaceId,
  connection,
}: {
  workspaceId: string
  connection: MetaChannelConnectionDTO
}) {
  const sync = useWhatsAppCoexistenceSync(workspaceId, connection.id)
  const data = sync.data
  return (
    <div className='space-y-2 rounded-md border p-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='font-medium text-sm'>{connection.label}</p>
        <Badge variant='outline'>Coexistência</Badge>
      </div>
      {data ? (
        <>
          <p className='text-muted-foreground text-xs'>
            {SYNC_STATUS_LABEL[data.status]}
            {data.error ? ` — ${data.error}` : ''}
          </p>
          <div
            className='h-2 w-full overflow-hidden rounded-full bg-muted'
            role='progressbar'
            aria-valuenow={data.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className='h-full bg-primary transition-all'
              style={{ width: `${data.progress}%` }}
            />
          </div>
          <p className='text-muted-foreground text-xs'>
            {data.contactsImported.toLocaleString('pt-BR')} contato(s),{' '}
            {data.messagesImported.toLocaleString('pt-BR')} mensagem(ns) em{' '}
            {data.conversationsTouched.toLocaleString('pt-BR')} conversa(s)
          </p>
        </>
      ) : (
        <p className='text-muted-foreground text-xs'>Carregando...</p>
      )}
    </div>
  )
}

/**
 * Coexistência do WhatsApp (OWNER/ADMIN). Desligada por padrão: o botão só
 * aparece com a chave ligada e o app da Meta configurado no ambiente.
 */
export function WhatsappSettingsMetaChannels({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useMetaChannelSettings(workspaceId, isAdmin)
  const update = useUpdateMetaChannelSettings(workspaceId)
  const connections = useMetaChannelConnections(workspaceId, isAdmin)
  const coexistence = useConnectWhatsAppCoexistence(workspaceId)
  const [pending, setPending] = useState(false)

  if (!isAdmin || !settings.data) return null
  const current = settings.data
  const appId = NEXT_PUBLIC_META_APP_ID
  const configId = NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID
  const metaReady = Boolean(appId && configId)

  function save(patch: UpdateMetaChannelSettingsInput) {
    update.mutate(patch, {
      onSuccess: () => notify.success('Configuração salva'),
      onError: (error) => notify.error(error, 'Não foi possível salvar'),
    })
  }

  async function handleConnectCoexistence() {
    if (!appId || !configId) return
    setPending(true)
    const result = await launchEmbeddedSignup({
      appId,
      configId,
      coexistence: true,
    })
    if (!result.ok) {
      setPending(false)
      if (result.reason === 'error') notify.error(result.message)
      else notify.info(result.message)
      return
    }
    coexistence.mutate(
      {
        code: result.code,
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
      },
      {
        onSuccess: () => {
          setPending(false)
          notify.success(
            'Número conectado. A importação do histórico começou e pode levar alguns minutos.',
          )
        },
        onError: (error) => {
          setPending(false)
          notify.error(error, 'Não foi possível conectar em Coexistência')
        },
      },
    )
  }

  const rows = connections.data ?? []
  const coexisting = rows.filter((row) => row.coexistence)

  return (
    <div className='space-y-4 rounded-lg border p-4'>
      <div>
        <h3 className='font-medium text-sm'>Coexistência</h3>
        <p className='text-muted-foreground text-xs'>
          Atenda o número que já usa no aplicativo WhatsApp Business na mesma
          caixa, com equipes, SLA e IA. Fica desligado até você ligá-lo.
        </p>
      </div>

      <SwitchRow
        id='coexistenceEnabled'
        title='Coexistência do WhatsApp'
        description='Conecta o número que o cliente já usa no aplicativo WhatsApp Business sem migrá-lo, e importa o histórico de conversas.'
        checked={current.coexistenceEnabled}
        disabled={update.isPending}
        onChange={(checked) => save({ coexistenceEnabled: checked })}
      />

      {metaReady && current.coexistenceEnabled ? (
        <div className='flex flex-wrap gap-2 border-t pt-3'>
          <Button
            size='sm'
            variant='outline'
            disabled={pending}
            onClick={handleConnectCoexistence}
          >
            {pending ? 'Aguarde...' : 'Conectar número em uso no aplicativo'}
          </Button>
        </div>
      ) : null}

      {coexisting.length > 0 ? (
        <div className='space-y-2 border-t pt-3'>
          {coexisting.map((row) => (
            <CoexistenceRow
              key={row.id}
              workspaceId={workspaceId}
              connection={row}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

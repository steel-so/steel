'use client'

import { useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  NEXT_PUBLIC_META_APP_ID,
  NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID,
} from '@/lib/env/env'
import { notify } from '@/lib/notify'
import {
  type UpdateMetaChannelSettingsInput,
  useConnectMetaChannel,
  useConnectWhatsAppCoexistence,
  useListMetaChannelPages,
  useMetaChannelConnections,
  useMetaChannelSettings,
  useUpdateMetaChannelSettings,
  useWhatsAppCoexistenceSync,
} from '@/src/hooks/use-whatsapp-meta-channels'
import {
  launchEmbeddedSignup,
  launchMetaChannelsLogin,
} from '@/src/lib/whatsapp/embedded-signup-client'
import type {
  MetaChannelConnectionDTO,
  MetaChannelPageDTO,
  WhatsAppCoexistenceStatusDTO,
  WhatsAppMetaChannelSettingsDTO,
} from '@/types/whatsapp-meta-channel'

const SYNC_STATUS_LABEL: Record<WhatsAppCoexistenceStatusDTO, string> = {
  PENDING: 'Aguardando o cliente compartilhar o histórico no aplicativo',
  SYNCING: 'Importando contatos e conversas',
  COMPLETED: 'Importação concluída',
  DECLINED: 'O cliente não compartilhou o histórico',
  FAILED: 'A importação falhou',
}

const CHANNEL_LABEL = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  MESSENGER: 'Messenger',
} as const

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

function PagesDialog({
  workspaceId,
  pages,
  accessToken,
  settings,
  onClose,
}: {
  workspaceId: string
  pages: MetaChannelPageDTO[]
  accessToken: string
  settings: WhatsAppMetaChannelSettingsDTO
  onClose: () => void
}) {
  const connect = useConnectMetaChannel(workspaceId)

  function handleConnect(page: MetaChannelPageDTO) {
    const channels: ('MESSENGER' | 'INSTAGRAM')[] = []
    if (settings.messengerEnabled) channels.push('MESSENGER')
    if (settings.instagramEnabled && page.instagramAccountId) {
      channels.push('INSTAGRAM')
    }
    if (channels.length === 0) {
      notify.warning('Esta Página não tem um canal ativo para conectar')
      return
    }
    connect.mutate(
      { accessToken, pageId: page.pageId, channels },
      {
        onSuccess: () => {
          notify.success('Página conectada')
          onClose()
        },
        onError: (error) => notify.error(error, 'Não foi possível conectar'),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Escolha a Página</DialogTitle>
          <DialogDescription>
            O Messenger usa a Página; o Instagram usa a conta profissional
            vinculada a ela.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          {pages.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              Nenhuma Página encontrada nesta conta da Meta.
            </p>
          ) : (
            pages.map((page) => (
              <div
                key={page.pageId}
                className='flex items-center justify-between gap-3 rounded-md border p-3'
              >
                <div className='min-w-0'>
                  <p className='truncate font-medium text-sm'>{page.name}</p>
                  <p className='text-muted-foreground text-xs'>
                    {page.instagramUsername
                      ? `Instagram @${page.instagramUsername}`
                      : 'Sem Instagram vinculado'}
                    {page.connectedChannels.length > 0
                      ? ` · Conectado: ${page.connectedChannels
                          .map((channel) => CHANNEL_LABEL[channel])
                          .join(', ')}`
                      : ''}
                  </p>
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={connect.isPending}
                  onClick={() => handleConnect(page)}
                >
                  {page.connectedChannels.length > 0 ? 'Renovar' : 'Conectar'}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Instagram Direct, Messenger e Coexistência (OWNER/ADMIN). Tudo desligado
 * por padrão: os botões só aparecem com a chave ligada e o app da Meta
 * configurado no ambiente.
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
  const listPages = useListMetaChannelPages(workspaceId)
  const coexistence = useConnectWhatsAppCoexistence(workspaceId)
  const [pending, setPending] = useState(false)
  const [picker, setPicker] = useState<{
    accessToken: string
    pages: MetaChannelPageDTO[]
  } | null>(null)

  if (!isAdmin || !settings.data) return null
  const current = settings.data
  const appId = NEXT_PUBLIC_META_APP_ID
  const configId = NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID
  const metaReady = Boolean(appId && configId)
  const socialEnabled = current.instagramEnabled || current.messengerEnabled

  function save(patch: UpdateMetaChannelSettingsInput) {
    update.mutate(patch, {
      onSuccess: () => notify.success('Configuração salva'),
      onError: (error) => notify.error(error, 'Não foi possível salvar'),
    })
  }

  async function handleConnectPages() {
    if (!appId) return
    setPending(true)
    const login = await launchMetaChannelsLogin({ appId })
    if (!login.ok) {
      setPending(false)
      if (login.reason === 'error') notify.error(login.message)
      else notify.info(login.message)
      return
    }
    listPages.mutate(
      { accessToken: login.accessToken },
      {
        onSuccess: (pages) => {
          setPending(false)
          setPicker({ accessToken: login.accessToken, pages })
        },
        onError: (error) => {
          setPending(false)
          notify.error(error, 'Não foi possível listar as Páginas')
        },
      },
    )
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
  const social = rows.filter((row) => row.channel !== 'WHATSAPP')
  const coexisting = rows.filter((row) => row.coexistence)

  return (
    <div className='space-y-4 rounded-lg border p-4'>
      <div>
        <h3 className='font-medium text-sm'>
          Instagram, Messenger e Coexistência
        </h3>
        <p className='text-muted-foreground text-xs'>
          Atenda Direct, Messenger e comentários na mesma caixa do WhatsApp, com
          equipes, SLA e IA. Os canais da Meta dependem da aprovação do app na
          Meta e ficam desligados até você ligá-los.
        </p>
      </div>

      <SwitchRow
        id='messengerEnabled'
        title='Messenger'
        description='Recebe e responde as mensagens da Página do Facebook.'
        checked={current.messengerEnabled}
        disabled={update.isPending}
        onChange={(checked) => save({ messengerEnabled: checked })}
      />
      <SwitchRow
        id='instagramEnabled'
        title='Instagram Direct'
        description='Recebe e responde as mensagens da conta profissional do Instagram.'
        checked={current.instagramEnabled}
        disabled={update.isPending}
        onChange={(checked) => save({ instagramEnabled: checked })}
      />
      {socialEnabled ? (
        <SwitchRow
          id='commentsEnabled'
          title='Comentários nas publicações'
          description='Os comentários chegam como conversas, e você responde em público ou por mensagem privada.'
          checked={current.commentsEnabled}
          disabled={update.isPending}
          onChange={(checked) => save({ commentsEnabled: checked })}
        />
      ) : null}
      <SwitchRow
        id='coexistenceEnabled'
        title='Coexistência do WhatsApp'
        description='Conecta o número que o cliente já usa no aplicativo WhatsApp Business sem migrá-lo, e importa o histórico de conversas.'
        checked={current.coexistenceEnabled}
        disabled={update.isPending}
        onChange={(checked) => save({ coexistenceEnabled: checked })}
      />

      {metaReady && (socialEnabled || current.coexistenceEnabled) ? (
        <div className='flex flex-wrap gap-2 border-t pt-3'>
          {socialEnabled ? (
            <Button
              size='sm'
              variant='outline'
              disabled={pending}
              onClick={handleConnectPages}
            >
              {pending ? 'Aguarde...' : 'Conectar Página da Meta'}
            </Button>
          ) : null}
          {current.coexistenceEnabled ? (
            <Button
              size='sm'
              variant='outline'
              disabled={pending}
              onClick={handleConnectCoexistence}
            >
              {pending ? 'Aguarde...' : 'Conectar número em uso no aplicativo'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {social.length > 0 ? (
        <div className='space-y-2 border-t pt-3'>
          {social.map((row) => (
            <div
              key={row.id}
              className='flex items-center justify-between gap-2 rounded-md border p-3'
            >
              <p className='truncate font-medium text-sm'>{row.label}</p>
              <Badge variant='outline'>{CHANNEL_LABEL[row.channel]}</Badge>
            </div>
          ))}
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

      {picker ? (
        <PagesDialog
          workspaceId={workspaceId}
          pages={picker.pages}
          accessToken={picker.accessToken}
          settings={current}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  )
}

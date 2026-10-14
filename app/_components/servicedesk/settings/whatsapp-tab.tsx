'use client'

import {
  Copy01Icon,
  PlugSocketIcon,
  QrCodeIcon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useState } from 'react'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSdSettings, useUpdateSdSettings } from '@/src/hooks/use-sd-config'
import {
  useCreateSdWhatsappConnection,
  useDeleteSdWhatsappConnection,
  useSdWhatsappConnectionQrCode,
  useSdWhatsappConnections,
  useTestSdWhatsappConnection,
} from '@/src/hooks/use-sd-whatsapp'
import type { CreateWhatsAppConnectionDTO } from '@/src/schemas/whatsapp-connection.schema'
import type { SdWhatsappConnectionDTO } from '@/types/sd-whatsapp'
import type { WhatsAppProviderDTO } from '@/types/whatsapp-connection'
import { SD_TONE } from '../sd-tone'
import {
  ConfirmDeleteButton,
  EmptyState,
  ReadOnlyNotice,
  SettingsSection,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

/**
 * Aba "WhatsApp" das configurações do ServiceDesk: as conexões do módulo
 * (`module = SERVICE_DESK`, separadas das do Comunicação), qual é a ativa, o
 * teste das credenciais e a URL de webhook a colar no provedor.
 */

const EMPTY_FORM = {
  provider: 'ZAPI' as WhatsAppProviderDTO,
  label: '',
  phoneNumber: '',
  zapiInstanceId: '',
  zapiToken: '',
  zapiClientToken: '',
  metaPhoneNumberId: '',
  metaWabaId: '',
  metaAccessToken: '',
}

const STATUS: Record<string, { label: string; className: string }> = {
  CONNECTED: {
    label: 'Conectado',
    className: SD_TONE.emerald,
  },
  CONNECTING: {
    label: 'Conectando',
    className: SD_TONE.amber,
  },
  DISCONNECTED: {
    label: 'Desconectado',
    className: 'bg-muted text-muted-foreground',
  },
  ERROR: {
    label: 'Com erro',
    className: 'bg-destructive/10 text-destructive',
  },
}

/** URL pública do webhook (o provedor precisa alcançar o Steel). */
export function sdWebhookUrl(path: string): string {
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

function toPayload(form: typeof EMPTY_FORM): CreateWhatsAppConnectionDTO {
  return form.provider === 'ZAPI'
    ? {
        provider: 'ZAPI',
        label: form.label,
        phoneNumber: form.phoneNumber,
        zapiInstanceId: form.zapiInstanceId,
        zapiToken: form.zapiToken,
        zapiClientToken: form.zapiClientToken || undefined,
      }
    : {
        provider: 'META',
        label: form.label,
        phoneNumber: form.phoneNumber,
        metaPhoneNumberId: form.metaPhoneNumberId,
        metaWabaId: form.metaWabaId,
        metaAccessToken: form.metaAccessToken,
      }
}

function CreateConnectionDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const create = useCreateSdWhatsappConnection(workspaceId)

  function set<K extends keyof typeof EMPTY_FORM>(
    key: K,
    value: (typeof EMPTY_FORM)[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate(toPayload(form), {
      onSuccess: () => {
        notify.success('Conexão cadastrada')
        setForm(EMPTY_FORM)
        setOpen(false)
      },
      onError: (error) => notify.error(error),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size='sm'>Adicionar conexão</Button>} />
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Nova conexão do ServiceDesk</DialogTitle>
          <DialogDescription>
            Conecte um número via Z-API ou via Meta Cloud API. A primeira
            conexão cadastrada já vira a ativa do módulo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='sd-wa-provider'>Provedor</Label>
            <select
              id='sd-wa-provider'
              className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
              value={form.provider}
              onChange={(event) =>
                set('provider', event.target.value as WhatsAppProviderDTO)
              }
            >
              <option value='ZAPI'>Z-API</option>
              <option value='META'>Meta Cloud API</option>
            </select>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='sd-wa-label'>Nome</Label>
            <Input
              id='sd-wa-label'
              required
              placeholder='Ex.: Suporte, Central de serviços...'
              value={form.label}
              onChange={(event) => set('label', event.target.value)}
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='sd-wa-phone'>Número (DDI + DDD + número)</Label>
            <Input
              id='sd-wa-phone'
              required
              placeholder='5511999999999'
              value={form.phoneNumber}
              onChange={(event) => set('phoneNumber', event.target.value)}
            />
          </div>

          {form.provider === 'ZAPI' ? (
            <>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='sd-wa-instance'>ID da instância</Label>
                <Input
                  id='sd-wa-instance'
                  required
                  value={form.zapiInstanceId}
                  onChange={(event) =>
                    set('zapiInstanceId', event.target.value)
                  }
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='sd-wa-token'>Token</Label>
                <Input
                  id='sd-wa-token'
                  required
                  type='password'
                  value={form.zapiToken}
                  onChange={(event) => set('zapiToken', event.target.value)}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='sd-wa-client-token'>Client-Token</Label>
                <Input
                  id='sd-wa-client-token'
                  type='password'
                  aria-describedby='sd-wa-client-token-hint'
                  value={form.zapiClientToken}
                  onChange={(event) =>
                    set('zapiClientToken', event.target.value)
                  }
                />
                <p
                  id='sd-wa-client-token-hint'
                  className='text-muted-foreground text-xs'
                >
                  Token de segurança da conta (no painel da Z-API, em
                  Segurança). Obrigatório quando a conta exige; sem ele a Z-API
                  recusa as chamadas e o QR não aparece.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='sd-wa-phone-id'>Phone Number ID</Label>
                <Input
                  id='sd-wa-phone-id'
                  required
                  value={form.metaPhoneNumberId}
                  onChange={(event) =>
                    set('metaPhoneNumberId', event.target.value)
                  }
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='sd-wa-waba'>WhatsApp Business Account ID</Label>
                <Input
                  id='sd-wa-waba'
                  required
                  value={form.metaWabaId}
                  onChange={(event) => set('metaWabaId', event.target.value)}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='sd-wa-access-token'>Access Token</Label>
                <Input
                  id='sd-wa-access-token'
                  required
                  type='password'
                  value={form.metaAccessToken}
                  onChange={(event) =>
                    set('metaAccessToken', event.target.value)
                  }
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button type='submit' disabled={create.isPending}>
              {create.isPending ? 'Cadastrando...' : 'Cadastrar conexão'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QrCodeDialog({
  workspaceId,
  connectionId,
}: {
  workspaceId: string
  connectionId: string
}) {
  const [open, setOpen] = useState(false)
  const qrCode = useSdWhatsappConnectionQrCode(workspaceId, connectionId, open)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size='xs' variant='outline'>
            <SteelIcon icon={QrCodeIcon} size={14} strokeWidth={2} />
            QR Code
          </Button>
        }
      />
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Conectar via QR Code</DialogTitle>
          <DialogDescription>
            Abra o WhatsApp no celular, vá em Aparelhos conectados e escaneie o
            código abaixo.
          </DialogDescription>
        </DialogHeader>
        <div className='flex items-center justify-center py-4'>
          {qrCode.data?.status === 'connected' ? (
            <p className='text-sm'>Conectado com sucesso!</p>
          ) : qrCode.data?.qrCodeBase64 ? (
            <img
              src={qrCode.data.qrCodeBase64}
              alt='QR Code de conexão'
              className='size-56'
            />
          ) : (
            <p className='text-muted-foreground text-sm'>
              Carregando o QR code...
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WebhookRow({ connection }: { connection: SdWhatsappConnectionDTO }) {
  const url = sdWebhookUrl(connection.webhookPath)
  return (
    <div className='flex flex-col gap-1 rounded-lg bg-muted px-3 py-2'>
      <span className='font-medium text-muted-foreground text-xs'>
        URL do webhook
      </span>
      <div className='flex items-center gap-2'>
        <code className='min-w-0 flex-1 truncate text-xs'>{url}</code>
        <Button
          size='icon-xs'
          variant='ghost'
          aria-label={`Copiar a URL do webhook de ${connection.label}`}
          onClick={() => void copyText(url)}
        >
          <SteelIcon icon={Copy01Icon} strokeWidth={2} />
        </Button>
      </div>
      <p className='text-[11px] text-muted-foreground'>
        {connection.provider === 'ZAPI'
          ? 'Cole em Z-API > Webhooks: "Ao receber", "Ao enviar" e "Status da mensagem". O segredo já vai na URL.'
          : 'Cole no app da Meta em WhatsApp > Configuração > Webhook. O token de verificação e o segredo do app são os da plataforma.'}
      </p>
    </div>
  )
}

function ConnectionCard({
  workspaceId,
  connection,
  canEdit,
  activeId,
}: {
  workspaceId: string
  connection: SdWhatsappConnectionDTO
  canEdit: boolean
  activeId: string | null
}) {
  const test = useTestSdWhatsappConnection(workspaceId)
  const remove = useDeleteSdWhatsappConnection(workspaceId)
  const updateSettings = useUpdateSdSettings(workspaceId)
  const status = STATUS[connection.status] ?? {
    label: connection.status,
    className: 'bg-muted text-muted-foreground',
  }

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-card p-4',
        connection.active && 'border-primary/50',
      )}
      data-testid='sd-whatsapp-connection'
    >
      <header className='flex flex-wrap items-center gap-2'>
        <SteelIcon
          icon={WhatsappIcon}
          strokeWidth={2}
          className='text-muted-foreground'
        />
        <span className='font-medium text-sm'>{connection.label}</span>
        <Badge variant='outline'>
          {connection.provider === 'ZAPI' ? 'Z-API' : 'Meta Cloud API'}
        </Badge>
        <Badge variant='outline' className={status.className}>
          {status.label}
        </Badge>
        {connection.active ? (
          <Badge className='bg-primary/10 text-primary' variant='outline'>
            Conexão ativa
          </Badge>
        ) : null}
      </header>

      <p className='text-muted-foreground text-xs'>
        {connection.phoneNumber}
        {connection.zapiInstanceId
          ? ` · instância ${connection.zapiInstanceId}`
          : ''}
        {connection.metaPhoneNumberId
          ? ` · phone id ${connection.metaPhoneNumberId}`
          : ''}
      </p>

      {connection.statusError ? (
        <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs'>
          {connection.statusError}
        </p>
      ) : null}

      <WebhookRow connection={connection} />

      {canEdit ? (
        <footer className='flex flex-wrap items-center gap-2'>
          <Button
            size='xs'
            variant='outline'
            disabled={test.isPending}
            onClick={() =>
              test.mutate(connection.id, {
                onSuccess: (result) =>
                  result.connected
                    ? notify.success('Conexão funcionando')
                    : notify.warning(
                        result.error ?? 'O provedor não confirmou a conexão',
                      ),
                onError: (error) => notify.error(error),
              })
            }
          >
            <SteelIcon icon={PlugSocketIcon} size={14} strokeWidth={2} />
            {test.isPending ? 'Testando...' : 'Testar'}
          </Button>
          {connection.provider === 'ZAPI' ? (
            <QrCodeDialog
              workspaceId={workspaceId}
              connectionId={connection.id}
            />
          ) : null}
          {connection.active ? null : (
            <Button
              size='xs'
              variant='outline'
              disabled={updateSettings.isPending}
              onClick={() =>
                updateSettings.mutate(
                  { whatsappConnectionId: connection.id },
                  {
                    onSuccess: () =>
                      notify.success(
                        `${connection.label} agora é a conexão ativa`,
                      ),
                    onError: (error) => notify.error(error),
                  },
                )
              }
            >
              Usar esta conexão
            </Button>
          )}
          {connection.active && activeId ? (
            <Button
              size='xs'
              variant='ghost'
              disabled={updateSettings.isPending}
              onClick={() =>
                updateSettings.mutate(
                  { whatsappConnectionId: null },
                  {
                    onSuccess: () =>
                      notify.success('O ServiceDesk ficou sem WhatsApp ativo'),
                    onError: (error) => notify.error(error),
                  },
                )
              }
            >
              Desativar
            </Button>
          ) : null}
          <ConfirmDeleteButton
            iconOnly={false}
            label='Remover'
            title='Remover a conexão?'
            description={`"${connection.label}" deixa de enviar e receber mensagens no ServiceDesk. As conversas já recebidas continuam no histórico dos chamados.`}
            pending={remove.isPending}
            onConfirm={() =>
              remove.mutate(connection.id, {
                onSuccess: () => notify.success('Conexão removida'),
                onError: (error) => notify.error(error),
              })
            }
          />
        </footer>
      ) : null}
    </article>
  )
}

export function SdWhatsappSettingsTab() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const connections = useSdWhatsappConnections(workspaceId)
  const settings = useSdSettings(workspaceId)
  const updateSettings = useUpdateSdSettings(workspaceId)
  const items = connections.data ?? []
  const activeId = settings.data?.whatsappConnectionId ?? null

  return (
    <div className='flex flex-col gap-5'>
      {canEdit ? null : <ReadOnlyNotice />}

      <SettingsSection
        title='Conexões do WhatsApp'
        description='Números que atendem pelo ServiceDesk. São independentes das conexões do módulo Comunicação: mensagens recebidas aqui viram chamados.'
        actions={
          canEdit ? <CreateConnectionDialog workspaceId={workspaceId} /> : null
        }
      >
        {connections.isLoading ? (
          <Skeleton className='h-40 w-full' />
        ) : connections.error ? (
          <EmptyState>{connections.error.message}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>
            Nenhuma conexão cadastrada. Adicione um número Z-API ou Meta para
            abrir e responder chamados pelo WhatsApp.
          </EmptyState>
        ) : (
          <div className='flex flex-col gap-3'>
            {items.map((connection) => (
              <ConnectionCard
                key={connection.id}
                workspaceId={workspaceId}
                connection={connection}
                canEdit={canEdit}
                activeId={activeId}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title='Mensagens automáticas'
        description='O que o contato recebe sem um atendente digitar. A confirmação por e-mail é ligada em cada caixa, na aba E-mail.'
      >
        {settings.data ? (
          <ToggleRow
            label='Confirmar a abertura pelo WhatsApp'
            description='Responde com o código do chamado assim que ele é aberto.'
            checked={settings.data.whatsappSendAcknowledgement}
            disabled={!canEdit || updateSettings.isPending}
            onCheckedChange={(value) =>
              updateSettings.mutate(
                { whatsappSendAcknowledgement: value },
                { onError: (error) => notify.error(error) },
              )
            }
          />
        ) : (
          <Skeleton className='h-10 w-full' />
        )}
      </SettingsSection>

      <SettingsSection
        title='Como funciona'
        description='O caminho de uma mensagem que chega no número do ServiceDesk.'
      >
        <ol className='flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground text-sm'>
          <li>
            O provedor chama a URL de webhook acima e o Steel grava a conversa.
          </li>
          <li>
            Com o pré-atendimento por IA ligado (aba IA), a IA conversa com o
            contato, sugere artigos da base e só abre o chamado quando precisa.
          </li>
          <li>
            Sem IA, a primeira mensagem já abre um chamado e, com a confirmação
            ligada, o contato recebe o código de volta.
          </li>
          <li>
            Com o chamado aberto, as mensagens aparecem na aba WhatsApp dele e o
            agente responde por lá (texto, arquivo ou modelo aprovado).
          </li>
          <li>
            Na Meta, o texto livre só vale por 24 h após a última mensagem do
            contato; fora disso, só modelo aprovado. A Z-API não tem janela.
          </li>
        </ol>
      </SettingsSection>
    </div>
  )
}

'use client'

import { QrCodeIcon, TradeMarkIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { ConnectionSpendCapButton } from '@/app/_components/whatsapp/costs/whatsapp-spend-caps'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { PhoneInput } from '@/components/ui/phone-input'
import { cn } from '@/lib/utils'
import {
  NEXT_PUBLIC_META_APP_ID,
  NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID,
} from '@/lib/env/env'
import { notify } from '@/lib/notify'
import {
  useConnectWhatsAppViaMeta,
  useCreateWhatsAppConnection,
  useDeleteWhatsAppConnection,
  useRefreshWhatsAppConnectionStatus,
  useWhatsAppConnectionQrCode,
  useWhatsAppConnections,
} from '@/src/hooks/use-whatsapp-connections'
import { launchEmbeddedSignup } from '@/src/lib/whatsapp/embedded-signup-client'
import type {
  WhatsAppConnectionDTO,
  WhatsAppProviderDTO,
} from '@/types/whatsapp-connection'

const STATUS_LABEL: Record<WhatsAppConnectionDTO['status'], string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando',
  DISCONNECTED: 'Desconectado',
  ERROR: 'Com problema',
}

const STATUS_HINT: Partial<Record<WhatsAppConnectionDTO['status'], string>> = {
  CONNECTING:
    'Ainda não terminou de conectar. Se for Z-API, leia o QR Code com o celular.',
  DISCONNECTED:
    'Este número não está recebendo nem enviando mensagens agora. Reconecte para voltar a atender.',
  ERROR:
    'A conexão está com problema. Use "Testar conexão" para ver o motivo.',
}

const PROVIDER_LABEL: Record<WhatsAppProviderDTO, string> = {
  ZAPI: 'Z-API',
  META: 'Meta',
  WIDGET: 'Widget',
}

const PROVIDER_OPTIONS: {
  value: Exclude<WhatsAppProviderDTO, 'WIDGET'>
  title: string
  badge?: string
  points: string[]
}[] = [
  {
    value: 'META',
    title: 'Meta (API oficial)',
    badge: 'Recomendado',
    points: [
      'Número oficial, sem risco de bloqueio',
      'Permite modelos (templates) aprovados e envio em massa',
      'Texto livre só em até 24 horas após o cliente escrever',
    ],
  },
  {
    value: 'ZAPI',
    title: 'Z-API (QR Code)',
    points: [
      'Conecta lendo um QR Code, como o WhatsApp Web',
      'Texto livre a qualquer momento, sem modelos',
      'Não é oficial: há risco de o número ser bloqueado',
    ],
  },
]

const EMPTY_FORM = {
  provider: 'META' as WhatsAppProviderDTO,
  label: '',
  phoneNumber: '',
  zapiInstanceId: '',
  zapiToken: '',
  zapiClientToken: '',
  metaPhoneNumberId: '',
  metaWabaId: '',
  metaAccessToken: '',
}

function CreateConnectionDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [advanced, setAdvanced] = useState(false)
  const createConnection = useCreateWhatsAppConnection(workspaceId)

  function updateField<K extends keyof typeof EMPTY_FORM>(
    key: K,
    value: (typeof EMPTY_FORM)[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const payload =
      form.provider === 'ZAPI'
        ? {
            provider: 'ZAPI' as const,
            label: form.label,
            phoneNumber: form.phoneNumber,
            zapiInstanceId: form.zapiInstanceId,
            zapiToken: form.zapiToken,
            zapiClientToken: form.zapiClientToken || undefined,
          }
        : {
            provider: 'META' as const,
            label: form.label,
            phoneNumber: form.phoneNumber,
            metaPhoneNumberId: form.metaPhoneNumberId,
            metaWabaId: form.metaWabaId,
            metaAccessToken: form.metaAccessToken,
          }

    createConnection.mutate(payload, {
      onSuccess: () => {
        notify.success('Conexão criada')
        setForm(EMPTY_FORM)
        setAdvanced(false)
        setOpen(false)
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível criar a conexão'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size='sm'>Adicionar conexão</Button>} />
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Nova conexão do WhatsApp</DialogTitle>
          <DialogDescription>
            Escolha como o número será conectado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div
            role='radiogroup'
            aria-label='Provedor'
            className='grid gap-2 sm:grid-cols-2'
          >
            {PROVIDER_OPTIONS.map((option) => {
              const selected = form.provider === option.value
              return (
                <button
                  key={option.value}
                  type='button'
                  role='radio'
                  aria-checked={selected}
                  onClick={() => updateField('provider', option.value)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
                    selected && 'border-primary bg-muted/50',
                  )}
                >
                  <span className='flex items-center gap-2 font-medium text-sm'>
                    {option.title}
                    {option.badge ? (
                      <Badge variant='secondary'>{option.badge}</Badge>
                    ) : null}
                  </span>
                  <ul className='mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground text-xs'>
                    {option.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </button>
              )
            })}
          </div>

          {form.provider === 'META' && !advanced ? (
            <div className='space-y-2 rounded-lg border bg-muted/40 p-3 text-sm'>
              <p>
                O jeito mais fácil de conectar a Meta é o botão{' '}
                <strong>Conectar com a Meta</strong>, na tela de conexões: você
                entra na sua conta e o Steel configura tudo sozinho.
              </p>
              <Button
                type='button'
                size='xs'
                variant='outline'
                onClick={() => setAdvanced(true)}
              >
                Avançado: informar os dados manualmente
              </Button>
            </div>
          ) : (
            <>
              <div className='space-y-1.5'>
                <Label htmlFor='label'>Nome</Label>
                <Input
                  id='label'
                  required
                  placeholder='Ex: Suporte, Vendas...'
                  value={form.label}
                  onChange={(event) => updateField('label', event.target.value)}
                />
              </div>

              <div className='space-y-1.5'>
                <Label htmlFor='phoneNumber'>Número (DDD + número)</Label>
                <PhoneInput
                  id='phoneNumber'
                  required
                  value={form.phoneNumber}
                  onValueChange={(value) => updateField('phoneNumber', value)}
                />
              </div>

              {form.provider === 'ZAPI' ? (
                <>
                  <div className='space-y-1.5'>
                    <Label htmlFor='zapiInstanceId'>ID da instância</Label>
                    <Input
                      id='zapiInstanceId'
                      required
                      value={form.zapiInstanceId}
                      onChange={(event) =>
                        updateField('zapiInstanceId', event.target.value)
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label htmlFor='zapiToken'>Token</Label>
                    <Input
                      id='zapiToken'
                      required
                      type='password'
                      value={form.zapiToken}
                      onChange={(event) =>
                        updateField('zapiToken', event.target.value)
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label htmlFor='zapiClientToken'>Client-Token</Label>
                    <Input
                      id='zapiClientToken'
                      type='password'
                      aria-describedby='zapiClientToken-hint'
                      value={form.zapiClientToken}
                      onChange={(event) =>
                        updateField('zapiClientToken', event.target.value)
                      }
                    />
                    <p
                      id='zapiClientToken-hint'
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
                  <div className='space-y-1.5'>
                    <Label htmlFor='metaPhoneNumberId'>Phone Number ID</Label>
                    <Input
                      id='metaPhoneNumberId'
                      required
                      aria-describedby='metaPhoneNumberId-hint'
                      value={form.metaPhoneNumberId}
                      onChange={(event) =>
                        updateField('metaPhoneNumberId', event.target.value)
                      }
                    />
                    <p
                      id='metaPhoneNumberId-hint'
                      className='text-muted-foreground text-xs'
                    >
                      No Gerenciador do WhatsApp da Meta, em Configurações da API:
                      é o "ID do número de telefone".
                    </p>
                  </div>
                  <div className='space-y-1.5'>
                    <Label htmlFor='metaWabaId'>WhatsApp Business Account ID</Label>
                    <Input
                      id='metaWabaId'
                      required
                      aria-describedby='metaWabaId-hint'
                      value={form.metaWabaId}
                      onChange={(event) =>
                        updateField('metaWabaId', event.target.value)
                      }
                    />
                    <p
                      id='metaWabaId-hint'
                      className='text-muted-foreground text-xs'
                    >
                      Na mesma tela, o "ID da conta do WhatsApp Business".
                    </p>
                  </div>
                  <div className='space-y-1.5'>
                    <Label htmlFor='metaAccessToken'>Access Token</Label>
                    <Input
                      id='metaAccessToken'
                      required
                      type='password'
                      aria-describedby='metaAccessToken-hint'
                      value={form.metaAccessToken}
                      onChange={(event) =>
                        updateField('metaAccessToken', event.target.value)
                      }
                    />
                    <p
                      id='metaAccessToken-hint'
                      className='text-muted-foreground text-xs'
                    >
                      Token permanente de um usuário do sistema, gerado no
                      Gerenciador de Negócios da Meta, com permissão
                      whatsapp_business_messaging.
                    </p>
                  </div>
                </>
              )}


            </>
          )}

          <DialogFooter>
            <Button
              type='submit'
              disabled={
                createConnection.isPending ||
                (form.provider === 'META' && !advanced)
              }
            >
              {createConnection.isPending ? 'Criando...' : 'Criar conexão'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Conectar com a Meta": Embedded Signup. Hidden when not configured. */
function MetaSignupButton({ workspaceId }: { workspaceId: string }) {
  const [pending, setPending] = useState(false)
  const connect = useConnectWhatsAppViaMeta(workspaceId)

  if (!NEXT_PUBLIC_META_APP_ID || !NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID) {
    return (
      <div className='flex flex-col items-end gap-1'>
        <Button
          size='sm'
          variant='outline'
          disabled
          title='A conexão automática com a Meta ainda não foi ativada neste ambiente.'
        >
          Conectar com a Meta
        </Button>
        <p className='max-w-56 text-right text-muted-foreground text-xs'>
          Indisponível: a conexão automática com a Meta ainda não foi ativada.
          Fale com o suporte do Steel ou use "Adicionar conexão" e informe os
          dados manualmente.
        </p>
      </div>
    )
  }
  const appId = NEXT_PUBLIC_META_APP_ID
  const configId = NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID

  async function handleClick() {
    setPending(true)
    const result = await launchEmbeddedSignup({ appId, configId })
    if (!result.ok) {
      setPending(false)
      if (result.reason === 'error') notify.error(result.message)
      else notify.info(result.message)
      return
    }
    connect.mutate(
      {
        code: result.code,
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
      },
      {
        onSuccess: (connection) => {
          setPending(false)
          if (connection.status === 'CONNECTED') {
            notify.success('Número conectado e pronto para uso')
          } else {
            notify.warning(
              connection.statusError ??
                'Número conectado, mas a Meta ainda não o liberou',
            )
          }
        },
        onError: (error) => {
          setPending(false)
          notify.error(error, 'Não foi possível conectar pela Meta')
        },
      },
    )
  }

  return (
    <Button
      size='sm'
      variant='outline'
      onClick={handleClick}
      disabled={pending}
    >
      {pending ? 'Conectando...' : 'Conectar com a Meta'}
    </Button>
  )
}

function ZapiQrCodeDialog({
  workspaceId,
  connectionId,
}: {
  workspaceId: string
  connectionId: string
}) {
  const [open, setOpen] = useState(false)
  const qrCode = useWhatsAppConnectionQrCode(workspaceId, connectionId, open)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size='xs' variant='outline'>
            <SteelIcon icon={QrCodeIcon} size={14} />
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
        <div className='flex flex-col items-center justify-center gap-3 py-4'>
          {qrCode.isError ? (
            <>
              <p className='text-center text-destructive text-sm'>
                {qrCode.error instanceof Error && qrCode.error.message
                  ? qrCode.error.message
                  : 'Não foi possível buscar o QR Code.'}{' '}
                Confira o ID da instância e os tokens da Z-API.
              </p>
              <Button
                size='sm'
                variant='outline'
                disabled={qrCode.isFetching}
                onClick={() => qrCode.refetch()}
              >
                {qrCode.isFetching ? 'Tentando...' : 'Tentar de novo'}
              </Button>
            </>
          ) : qrCode.data?.status === 'connected' ? (
            <p className='text-sm'>Conectado com sucesso!</p>
          ) : qrCode.data?.qrCodeBase64 ? (
            <>
              <img
                src={qrCode.data.qrCodeBase64}
                alt='QR Code de conexão'
                className='size-56'
              />
              <p className='text-center text-muted-foreground text-xs'>
                O código muda a cada poucos segundos. Se expirar, ele é
                atualizado sozinho.
              </p>
            </>
          ) : (
            <p className='text-muted-foreground text-sm'>
              Carregando QR code...
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function WhatsappSettingsConnections({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [deletingConnection, setDeletingConnection] =
    useState<WhatsAppConnectionDTO | null>(null)
  const connections = useWhatsAppConnections(workspaceId)
  const deleteConnection = useDeleteWhatsAppConnection(workspaceId)
  const refreshStatus = useRefreshWhatsAppConnectionStatus(workspaceId)
  const canManage = useIsPrivileged()

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='font-medium text-sm'>Conexões</h3>
          <p className='text-muted-foreground text-xs'>
            Números conectados pela API oficial da Meta ou pela Z-API
          </p>
        </div>
        {canManage ? (
          <div className='flex items-start gap-2'>
            <MetaSignupButton workspaceId={workspaceId} />
            <CreateConnectionDialog workspaceId={workspaceId} />
          </div>
        ) : (
          <p className='max-w-56 text-right text-muted-foreground text-xs'>
            Só administradores conectam ou removem números.
          </p>
        )}
      </div>

      <div className='grid gap-3 md:grid-cols-2'>
        {(connections.data ?? []).map((connection) => (
          <Card key={connection.id}>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-sm'>
                <SteelIcon icon={TradeMarkIcon} size={16} />
                {connection.label}
                <Badge variant='outline'>
                  {PROVIDER_LABEL[connection.provider]}
                </Badge>
              </CardTitle>
              <CardDescription>{connection.phoneNumber}</CardDescription>
            </CardHeader>
            <CardContent className='text-muted-foreground text-xs'>
              Status: {STATUS_LABEL[connection.status] ?? connection.status}
              {STATUS_HINT[connection.status] ? (
                <p>{STATUS_HINT[connection.status]}</p>
              ) : null}
              {connection.statusError && (
                <p className='text-destructive'>{connection.statusError}</p>
              )}
            </CardContent>
            <CardFooter className='flex flex-wrap gap-2'>
              {canManage && connection.provider === 'ZAPI' && (
                <ZapiQrCodeDialog
                  workspaceId={workspaceId}
                  connectionId={connection.id}
                />
              )}
              {canManage &&
                (connection.provider === 'META' ||
                  connection.provider === 'ZAPI') && (
                  <Button
                    size='xs'
                    variant='outline'
                    disabled={refreshStatus.isPending}
                    onClick={() =>
                      refreshStatus.mutate(connection.id, {
                        onSuccess: (checked) =>
                          checked.status === 'CONNECTED'
                            ? notify.success('Conexão funcionando')
                            : notify.warning(
                                checked.statusError ??
                                  'A conexão não está ativa agora',
                              ),
                        onError: (error) =>
                          notify.error(error, 'Não foi possível verificar'),
                      })
                    }
                  >
                    {connection.provider === 'META'
                      ? 'Atualizar status'
                      : 'Testar conexão'}
                  </Button>
                )}
              {connection.provider === 'META' && (
                <ConnectionSpendCapButton
                  workspaceId={workspaceId}
                  connectionId={connection.id}
                />
              )}
              {canManage && (
                <Button
                  size='xs'
                  variant='destructive'
                  onClick={() => setDeletingConnection(connection)}
                >
                  Remover
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
        {connections.isError && (
          <p className='text-destructive text-sm'>
            Não foi possível carregar as conexões.{' '}
            <Button
              size='xs'
              variant='outline'
              onClick={() => connections.refetch()}
            >
              Tentar de novo
            </Button>
          </p>
        )}
        {connections.data?.length === 0 && (
          <div className='space-y-1 text-sm md:col-span-2'>
            <p className='text-muted-foreground'>
              Nenhuma conexão cadastrada ainda.
            </p>
            <p className='text-muted-foreground text-xs'>
              Comece por "Conectar com a Meta" (recomendado) ou use "Adicionar
              conexão" para ligar um número pela Z-API.
            </p>
          </div>
        )}
      </div>

      <AlertDialog
        open={deletingConnection !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingConnection(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conexão</AlertDialogTitle>
            <AlertDialogDescription>
              "{deletingConnection?.label}" será desconectado. Conversas e
              mensagens já recebidas por ele não são apagadas, mas ele deixa de
              enviar/receber mensagens novas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteConnection.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={deleteConnection.isPending}
              onClick={() => {
                if (!deletingConnection) return
                deleteConnection.mutate(deletingConnection.id, {
                  onSuccess: () => {
                    notify.success('Conexão removida')
                    setDeletingConnection(null)
                  },
                  onError: (error) =>
                    notify.error(error, 'Não foi possível remover'),
                })
              }}
            >
              {deleteConnection.isPending ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

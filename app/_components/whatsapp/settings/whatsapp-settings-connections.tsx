'use client'

import { QrCodeIcon, TradeMarkIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

function CreateConnectionDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
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
            Conecte um número via Z-API ou via Meta Cloud API.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='provider'>Provedor</Label>
            <Select
              value={form.provider}
              onValueChange={(value) =>
                updateField(
                  'provider',
                  (value ?? 'ZAPI') as WhatsAppProviderDTO,
                )
              }
            >
              <SelectTrigger id='provider' className='w-full'>
                <SelectValue placeholder='Provedor' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='ZAPI'>Z-API</SelectItem>
                  <SelectItem value='META'>Meta Cloud API</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

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
            <Label htmlFor='phoneNumber'>Número (DDI + DDD + número)</Label>
            <Input
              id='phoneNumber'
              required
              placeholder='5511999999999'
              value={form.phoneNumber}
              onChange={(event) =>
                updateField('phoneNumber', event.target.value)
              }
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
                  value={form.metaPhoneNumberId}
                  onChange={(event) =>
                    updateField('metaPhoneNumberId', event.target.value)
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='metaWabaId'>WhatsApp Business Account ID</Label>
                <Input
                  id='metaWabaId'
                  required
                  value={form.metaWabaId}
                  onChange={(event) =>
                    updateField('metaWabaId', event.target.value)
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='metaAccessToken'>Access Token</Label>
                <Input
                  id='metaAccessToken'
                  required
                  type='password'
                  value={form.metaAccessToken}
                  onChange={(event) =>
                    updateField('metaAccessToken', event.target.value)
                  }
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button type='submit' disabled={createConnection.isPending}>
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
    return null
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

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='font-medium text-sm'>Conexões</h3>
          <p className='text-muted-foreground text-xs'>
            Números conectados via Z-API ou Meta Cloud API
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <MetaSignupButton workspaceId={workspaceId} />
          <CreateConnectionDialog workspaceId={workspaceId} />
        </div>
      </div>

      <div className='grid gap-3 md:grid-cols-2'>
        {(connections.data ?? []).map((connection) => (
          <Card key={connection.id}>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-sm'>
                <SteelIcon icon={TradeMarkIcon} size={16} />
                {connection.label}
                <Badge variant='outline'>{connection.provider}</Badge>
              </CardTitle>
              <CardDescription>{connection.phoneNumber}</CardDescription>
            </CardHeader>
            <CardContent className='text-muted-foreground text-xs'>
              Status: {connection.status}
              {connection.statusError && (
                <p className='text-destructive'>{connection.statusError}</p>
              )}
            </CardContent>
            <CardFooter className='flex gap-2'>
              {connection.provider === 'ZAPI' && (
                <ZapiQrCodeDialog
                  workspaceId={workspaceId}
                  connectionId={connection.id}
                />
              )}
              {connection.provider === 'META' && (
                <Button
                  size='xs'
                  variant='outline'
                  disabled={refreshStatus.isPending}
                  onClick={() =>
                    refreshStatus.mutate(connection.id, {
                      onError: (error) =>
                        notify.error(error, 'Não foi possível verificar'),
                    })
                  }
                >
                  Atualizar status
                </Button>
              )}
              <Button
                size='xs'
                variant='destructive'
                onClick={() => setDeletingConnection(connection)}
              >
                Remover
              </Button>
            </CardFooter>
          </Card>
        ))}
        {connections.data?.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            Nenhuma conexão cadastrada ainda.
          </p>
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

'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCreateWhatsAppStore,
  useDeleteWhatsAppStore,
  useRotateWhatsAppStoreSecret,
  useUpdateWhatsAppStore,
  useWhatsAppStores,
} from '@/src/hooks/use-whatsapp-commerce'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import type {
  WhatsAppStoreIntegrationDTO,
  WhatsAppStoreProviderDTO,
} from '@/types/whatsapp-commerce'
import { SimpleSelect } from '../chatbots/chatbot-select'
import { formatInZone } from './commerce-format'

const PROVIDER_LABEL: Record<WhatsAppStoreProviderDTO, string> = {
  TRAY: 'Tray',
  NUVEMSHOP: 'Nuvemshop',
  VTEX: 'VTEX',
}

const PROVIDER_OPTIONS = (
  Object.keys(PROVIDER_LABEL) as WhatsAppStoreProviderDTO[]
).map((value) => ({ value, label: PROVIDER_LABEL[value] }))

function useWebhookUrl(storeId: string): string {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  return `${origin}/api/whatsapp/webhook/ecommerce/${storeId}`
}

/** Shown once, right after the store is created or its secret rotated. */
function SecretDialog({
  store,
  secret,
  onClose,
}: {
  store: WhatsAppStoreIntegrationDTO | null
  secret: string
  onClose: () => void
}) {
  const url = useWebhookUrl(store?.id ?? '')
  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Segredo da loja</DialogTitle>
          <DialogDescription>
            Copie agora: o segredo não aparece de novo. A loja (ou a automação
            que a representa) assina cada chamada com ele.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3 text-sm'>
          <div className='space-y-1'>
            <Label>Endereço do webhook</Label>
            <Input readOnly value={url} onFocus={(e) => e.target.select()} />
          </div>
          <div className='space-y-1'>
            <Label>Segredo (HMAC-SHA256)</Label>
            <Input
              readOnly
              value={secret}
              onFocus={(event) => event.target.select()}
            />
          </div>
          <p className='text-muted-foreground text-xs'>
            Envie o cabeçalho <code>x-steel-signature</code> com o HMAC-SHA256
            do corpo, em hexadecimal, calculado com este segredo. A Nuvemshop
            usa o cabeçalho <code>x-linkedstore-hmac-sha256</code> da mesma
            forma.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Já copiei</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateStoreDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (store: WhatsAppStoreIntegrationDTO, secret: string) => void
}) {
  const create = useCreateWhatsAppStore(workspaceId)
  const connections = useWhatsAppConnections(workspaceId)
  const [provider, setProvider] = useState<WhatsAppStoreProviderDTO>('TRAY')
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [storeUrl, setStoreUrl] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [storeId, setStoreId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const metaConnections = (connections.data ?? []).filter(
    (connection) => connection.provider === 'META',
  )

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    create.mutate(
      {
        provider,
        name,
        connectionId,
        storeUrl: storeUrl.trim() || undefined,
        accessToken: accessToken.trim() || undefined,
        storeId: storeId.trim() || undefined,
      },
      {
        onSuccess: (created) => {
          onOpenChange(false)
          setName('')
          setAccessToken('')
          onCreated(created, created.webhookSecret)
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>Conectar loja</DialogTitle>
            <DialogDescription>
              A loja avisa o Steel por webhook e o Steel manda a mensagem pelo
              WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-1.5'>
            <Label>Plataforma</Label>
            <SimpleSelect
              ariaLabel='Plataforma'
              value={provider}
              options={PROVIDER_OPTIONS}
              onChange={(value) =>
                setProvider(value as WhatsAppStoreProviderDTO)
              }
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='storeName'>Nome</Label>
            <Input
              id='storeName'
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label>Conexão do WhatsApp</Label>
            <SimpleSelect
              ariaLabel='Conexão do WhatsApp'
              value={connectionId}
              placeholder='Escolha uma conexão da API oficial'
              options={metaConnections.map((connection) => ({
                value: connection.id,
                label: `${connection.label} (${connection.phoneNumber})`,
              }))}
              onChange={setConnectionId}
            />
          </div>
          {provider !== 'VTEX' ? (
            <details className='rounded-md border p-3 text-sm'>
              <summary className='cursor-pointer font-medium'>
                Credenciais da API da loja (opcional)
              </summary>
              <p className='mt-2 text-muted-foreground text-xs'>
                Só para ler os produtos da loja no catálogo. Ficam
                criptografadas.
              </p>
              <div className='mt-3 space-y-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='storeUrl'>
                    {provider === 'TRAY'
                      ? 'Endereço da API (api_address)'
                      : 'Endereço da loja'}
                  </Label>
                  <Input
                    id='storeUrl'
                    value={storeUrl}
                    placeholder='https://'
                    onChange={(event) => setStoreUrl(event.target.value)}
                  />
                </div>
                {provider === 'NUVEMSHOP' ? (
                  <div className='space-y-1.5'>
                    <Label htmlFor='storeIdField'>Id da loja</Label>
                    <Input
                      id='storeIdField'
                      value={storeId}
                      onChange={(event) => setStoreId(event.target.value)}
                    />
                  </div>
                ) : null}
                <div className='space-y-1.5'>
                  <Label htmlFor='accessToken'>Token de acesso</Label>
                  <Input
                    id='accessToken'
                    type='password'
                    autoComplete='off'
                    value={accessToken}
                    onChange={(event) => setAccessToken(event.target.value)}
                  />
                </div>
              </div>
            </details>
          ) : null}
          {error ? <p className='text-destructive text-sm'>{error}</p> : null}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type='submit'
              disabled={create.isPending || !name.trim() || !connectionId}
            >
              {create.isPending ? 'Conectando...' : 'Conectar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StoreRow({
  workspaceId,
  store,
  canEdit,
  onSecret,
}: {
  workspaceId: string
  store: WhatsAppStoreIntegrationDTO
  canEdit: boolean
  onSecret: (store: WhatsAppStoreIntegrationDTO, secret: string) => void
}) {
  const update = useUpdateWhatsAppStore(workspaceId, store.id)
  const rotate = useRotateWhatsAppStoreSecret(workspaceId)
  const remove = useDeleteWhatsAppStore(workspaceId)
  const url = useWebhookUrl(store.id)

  return (
    <li className='space-y-2 rounded-md border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <p className='font-medium'>{store.name}</p>
          <Badge variant='outline'>{PROVIDER_LABEL[store.provider]}</Badge>
          {store.hasCredentials ? (
            <Badge variant='secondary'>API da loja salva</Badge>
          ) : null}
        </div>
        <div className='flex items-center gap-2 text-sm'>
          <span>{store.enabled ? 'Recebendo eventos' : 'Desligada'}</span>
          <Switch
            aria-label={`Loja ${store.name} ligada`}
            checked={store.enabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(enabled) =>
              update.mutate(
                { enabled },
                {
                  onError: (error) =>
                    notify.error(error, 'Não foi possível atualizar a loja'),
                },
              )
            }
          />
        </div>
      </div>
      <p className='break-all font-mono text-muted-foreground text-xs'>{url}</p>
      <p className='text-muted-foreground text-xs'>
        {store.lastEventAt
          ? `Último evento: ${formatInZone(store.lastEventAt)}`
          : 'Nenhum evento recebido ainda'}
      </p>
      {canEdit ? (
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={rotate.isPending}
            onClick={() =>
              rotate.mutate(store.id, {
                onSuccess: (rotated) => onSecret(store, rotated.webhookSecret),
                onError: (error) =>
                  notify.error(error, 'Não foi possível gerar o segredo'),
              })
            }
          >
            Gerar novo segredo
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(store.id, {
                onSuccess: () => notify.success('Loja removida'),
                onError: (error) =>
                  notify.error(error, 'Não foi possível remover a loja'),
              })
            }
          >
            Remover
          </Button>
        </div>
      ) : null}
    </li>
  )
}

export function StoreList({ workspaceId }: { workspaceId: string }) {
  const canEdit = useIsPrivileged()
  const stores = useWhatsAppStores(workspaceId)
  const [creating, setCreating] = useState(false)
  const [reveal, setReveal] = useState<{
    store: WhatsAppStoreIntegrationDTO
    secret: string
  } | null>(null)

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-sm'>
          Cada loja tem um endereço de webhook e um segredo próprios.
        </p>
        {canEdit ? (
          <Button onClick={() => setCreating(true)}>Conectar loja</Button>
        ) : null}
      </div>

      {stores.isLoading ? (
        <Skeleton className='h-24 w-full' />
      ) : (stores.data ?? []).length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Nenhuma loja conectada.
        </p>
      ) : (
        <ul className='space-y-3'>
          {stores.data?.map((store) => (
            <StoreRow
              key={store.id}
              workspaceId={workspaceId}
              store={store}
              canEdit={canEdit}
              onSecret={(target, secret) =>
                setReveal({ store: target, secret })
              }
            />
          ))}
        </ul>
      )}

      <CreateStoreDialog
        workspaceId={workspaceId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(store, secret) => setReveal({ store, secret })}
      />
      <SecretDialog
        store={reveal?.store ?? null}
        secret={reveal?.secret ?? ''}
        onClose={() => setReveal(null)}
      />
    </div>
  )
}

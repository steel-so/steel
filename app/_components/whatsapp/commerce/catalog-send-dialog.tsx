'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useSendCatalogProducts,
  useWhatsAppCatalogProducts,
  useWhatsAppCommerceSettings,
} from '@/src/hooks/use-whatsapp-commerce'
import { formatBrl } from './commerce-format'

const MAX_PRODUCTS = 30
const DEFAULT_BODY = 'Olá! Separamos estes produtos para você. Toque para ver.'

function SendForm({
  workspaceId,
  conversationId,
  onClose,
}: {
  workspaceId: string
  conversationId: string
  onClose: () => void
}) {
  const settings = useWhatsAppCommerceSettings(workspaceId)
  const products = useWhatsAppCatalogProducts(workspaceId, {
    onlyAvailable: true,
    enabled: settings.data?.catalogEnabled ?? false,
  })
  const send = useSendCatalogProducts(workspaceId)
  const [selected, setSelected] = useState<string[]>([])
  const [body, setBody] = useState(DEFAULT_BODY)

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...current, id].slice(0, MAX_PRODUCTS)
        : current.filter((value) => value !== id),
    )

  const submit = () =>
    send.mutate(
      { conversationId, productIds: selected, bodyText: body },
      {
        onSuccess: () => {
          notify.success('Produtos enviados')
          onClose()
        },
        onError: (error) => notify.error(error.message),
      },
    )

  if (settings.data && !settings.data.catalogEnabled) {
    return (
      <p className='text-muted-foreground text-sm'>
        O catálogo está desligado neste workspace. Um administrador ativa em
        Catálogo, Configurações.
      </p>
    )
  }

  return (
    <>
      <div className='max-h-64 space-y-1 overflow-y-auto rounded-md border p-2'>
        {(products.data ?? []).length === 0 ? (
          <p className='p-2 text-muted-foreground text-sm'>
            {products.isLoading
              ? 'Carregando...'
              : 'Nenhum produto disponível. Sincronize o catálogo.'}
          </p>
        ) : (
          products.data?.map((product) => (
            <label
              key={product.id}
              htmlFor={`catalog-pick-${product.id}`}
              className='flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted'
            >
              <Checkbox
                id={`catalog-pick-${product.id}`}
                checked={selected.includes(product.id)}
                onCheckedChange={(checked) => toggle(product.id, checked)}
                aria-label={product.name}
              />
              <span className='flex-1 truncate'>{product.name}</span>
              <span className='text-muted-foreground text-xs'>
                {formatBrl(product.price)}
              </span>
            </label>
          ))
        )}
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='catalogBody'>Mensagem</Label>
        <Textarea
          id='catalogBody'
          rows={3}
          maxLength={1024}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button variant='outline' onClick={onClose}>
          Cancelar
        </Button>
        <Button
          onClick={submit}
          disabled={send.isPending || selected.length === 0 || !body.trim()}
        >
          {send.isPending
            ? 'Enviando...'
            : selected.length === 0
              ? 'Enviar'
              : `Enviar ${selected.length}`}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Atendente escolhe produtos do catálogo e manda para a conversa aberta. */
export function CatalogSendDialog({
  workspaceId,
  conversationId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar produtos</DialogTitle>
          <DialogDescription>
            O cliente vê os produtos do catálogo e pode montar o carrinho.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SendForm
            workspaceId={workspaceId}
            conversationId={conversationId}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

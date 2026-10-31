'use client'

import { useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  useSetCatalogProductAvailable,
  useSyncWhatsAppCatalog,
  useWhatsAppCatalogProducts,
  useWhatsAppCommerceSettings,
} from '@/src/hooks/use-whatsapp-commerce'
import { formatBrl, formatInZone } from './commerce-format'

const SOURCE_LABEL = {
  CRM: 'CRM',
  TRAY: 'Tray',
  NUVEMSHOP: 'Nuvemshop',
} as const

export function CatalogProductsTable({ workspaceId }: { workspaceId: string }) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppCommerceSettings(workspaceId)
  const products = useWhatsAppCatalogProducts(workspaceId)
  const sync = useSyncWhatsAppCatalog(workspaceId)
  const setAvailable = useSetCatalogProductAvailable(workspaceId)
  const [search, setSearch] = useState('')

  const rows = (products.data ?? []).filter((product) =>
    product.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  function handleSync() {
    sync.mutate(undefined, {
      onSuccess: (result) =>
        notify.success(
          `Catálogo sincronizado: ${result.created} novos, ${result.updated} atualizados, ${result.removed} indisponíveis`,
        ),
      onError: (error) =>
        notify.error(error, 'Não foi possível sincronizar o catálogo'),
    })
  }

  if (settings.data && !settings.data.catalogEnabled) {
    return (
      <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
        O catálogo está desligado.{' '}
        {isAdmin
          ? 'Ative-o na aba Configurações.'
          : 'Peça a um administrador para ativá-lo.'}
      </p>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Input
          aria-label='Buscar produto'
          placeholder='Buscar produto'
          className='max-w-xs'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className='flex items-center gap-3'>
          {settings.data?.lastCatalogSyncAt ? (
            <span className='text-muted-foreground text-xs'>
              Última sincronização:{' '}
              {formatInZone(settings.data.lastCatalogSyncAt)}
            </span>
          ) : null}
          {isAdmin ? (
            <Button onClick={handleSync} disabled={sync.isPending}>
              {sync.isPending ? 'Sincronizando...' : 'Sincronizar agora'}
            </Button>
          ) : null}
        </div>
      </div>

      {products.isLoading ? (
        <Skeleton className='h-40 w-full' />
      ) : rows.length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
          Nenhum produto no catálogo. Sincronize para trazer os produtos da
          origem escolhida.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Id na Meta</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className='text-right'>Preço</TableHead>
                <TableHead>Disponível</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className='font-medium'>{product.name}</TableCell>
                  <TableCell className='font-mono text-xs'>
                    {product.retailerId}
                  </TableCell>
                  <TableCell>
                    <Badge variant='outline'>
                      {SOURCE_LABEL[product.source]}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    {formatBrl(product.price)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`Disponível: ${product.name}`}
                      checked={product.available}
                      disabled={!isAdmin || setAvailable.isPending}
                      onCheckedChange={(available) =>
                        setAvailable.mutate(
                          { productId: product.id, available },
                          {
                            onError: (error) =>
                              notify.error(
                                error,
                                'Não foi possível atualizar o produto',
                              ),
                          },
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

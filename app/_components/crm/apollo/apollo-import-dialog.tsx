'use client'

import Link from 'next/link'
import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCrmApolloConnection } from '@/src/hooks/use-crm-apollo'
import { ApolloHistoryTab } from './apollo-history-tab'
import { ApolloListsTab } from './apollo-lists-tab'
import { ApolloSearchTab } from './apollo-search-tab'

type TabValue = 'search' | 'lists' | 'history'

/** Importar da Apollo: search, saved lists and import history, in a modal. */
export function ApolloImportDialog({
  open,
  onOpenChange,
  workspaceId,
  slug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  slug: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden p-4 sm:h-[90dvh] sm:max-w-6xl sm:p-6'>
        <DialogHeader>
          <DialogTitle>Importar da Apollo</DialogTitle>
          <DialogDescription>
            Busque pessoas na Apollo.io, escolha uma lista salva e acompanhe o
            histórico das importações.
          </DialogDescription>
        </DialogHeader>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {open ? (
            <ApolloImportBody workspaceId={workspaceId} slug={slug} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ApolloImportBody({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const connection = useCrmApolloConnection(workspaceId)
  const [tab, setTab] = useState<TabValue>('search')

  if (connection.isLoading) {
    return (
      <p className='p-4 text-muted-foreground text-sm'>Carregando conexão…</p>
    )
  }
  if (connection.error || !connection.data) {
    return (
      <p role='alert' className='p-4 text-destructive text-sm'>
        {connection.error?.message ?? 'Erro ao carregar a conexão'}
      </p>
    )
  }

  if (!connection.data.connected) {
    return (
      <div className='flex min-w-0 flex-col items-center gap-3 p-8 text-center'>
        <h2 className='font-semibold text-lg'>Conecte a sua conta da Apollo</h2>
        <p className='max-w-md text-muted-foreground text-sm'>
          Para buscar e importar leads, cadastre a chave de API da sua conta da
          Apollo.io. Só administradores do workspace fazem esse passo.
        </p>
        <Link
          href={`/${slug}/settings/integrations`}
          className={buttonVariants()}
        >
          Ir para Ajustes › Integrações
        </Link>
      </div>
    )
  }

  const defaultList = connection.data.defaultMailingListId
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      {connection.data.status === 'ERROR' && connection.data.statusError ? (
        <p
          role='alert'
          className='rounded-lg border border-destructive/40 p-3 text-destructive text-sm'
        >
          A Apollo recusou a chave: {connection.data.statusError} Atualize a
          chave em Ajustes › Integrações.
        </p>
      ) : null}
      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList className='max-w-full overflow-x-auto'>
          <TabsTrigger value='search'>Buscar na Apollo</TabsTrigger>
          <TabsTrigger value='lists'>Minhas listas da Apollo</TabsTrigger>
          <TabsTrigger value='history'>Histórico de importações</TabsTrigger>
        </TabsList>
        <TabsContent value='search' className='pt-2'>
          <ApolloSearchTab
            workspaceId={workspaceId}
            defaultMailingListId={defaultList}
            phoneRevealAvailable={connection.data.phoneRevealAvailable}
            onImported={() => setTab('history')}
          />
        </TabsContent>
        <TabsContent value='lists' className='pt-2'>
          <ApolloListsTab
            workspaceId={workspaceId}
            defaultMailingListId={defaultList}
            phoneRevealAvailable={connection.data.phoneRevealAvailable}
            onImported={() => setTab('history')}
          />
        </TabsContent>
        <TabsContent value='history' className='pt-2'>
          <ApolloHistoryTab workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

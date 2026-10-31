'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  useAiProcedure,
  useAiProcedureCatalog,
  useDeleteAiProcedure,
} from '@/src/hooks/use-ai-procedures'
import { AiProcedureEditor } from './ai-procedure-editor'
import { AiProcedureRuns, AiProcedureVersions } from './ai-procedure-history'
import { AiProcedurePreview } from './ai-procedure-preview'

/** `/ai/procedures/new` and `/ai/procedures/[id]`. */
export function AiProcedureDetail({
  workspaceId,
  slug,
  procedureId,
}: {
  workspaceId: string
  slug: string
  /** `null` = creating. */
  procedureId: string | null
}) {
  const router = useRouter()
  const catalog = useAiProcedureCatalog(workspaceId)
  const procedure = useAiProcedure(workspaceId, procedureId ?? '')
  const remove = useDeleteAiProcedure(workspaceId)
  const [confirming, setConfirming] = useState(false)
  const canManage = catalog.data?.canManage ?? false

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title={procedureId ? (procedure.data?.name ?? 'Procedimento') : 'Novo procedimento'}
        actions={
          procedureId && canManage ? (
            <Button
              size='sm'
              variant={confirming ? 'destructive' : 'outline'}
              disabled={remove.isPending}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true)
                  return
                }
                remove.mutate(procedureId, {
                  onSuccess: () => {
                    notify.success('Procedimento excluído.')
                    router.push(`/${slug}/ai/procedures`)
                  },
                  onError: notify.error,
                })
              }}
            >
              {confirming ? 'Confirmar exclusão' : 'Excluir'}
            </Button>
          ) : null
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-5 px-4 pt-2 pb-10 sm:px-6 sm:pt-4'>
          {!procedureId ? (
            <>
              <header className='space-y-1'>
                <h1 className='font-semibold text-lg'>Novo procedimento</h1>
                <p className='text-muted-foreground text-sm'>
                  Descreva quando usar e monte os passos na ordem em que devem
                  acontecer.
                </p>
              </header>
              <AiProcedureEditor
                workspaceId={workspaceId}
                slug={slug}
                canManage={canManage}
              />
            </>
          ) : procedure.isLoading ? (
            <Skeleton className='h-64 w-full' />
          ) : procedure.isError || !procedure.data ? (
            <p className='text-destructive text-sm'>
              Não foi possível carregar o procedimento.
            </p>
          ) : (
            <Tabs defaultValue='steps'>
              <TabsList>
                <TabsTrigger value='steps'>Roteiro</TabsTrigger>
                <TabsTrigger value='preview'>Pré-visualizar</TabsTrigger>
                <TabsTrigger value='versions'>Versões</TabsTrigger>
                <TabsTrigger value='runs'>Execuções</TabsTrigger>
              </TabsList>
              <TabsContent value='steps' className='pt-3'>
                <AiProcedureEditor
                  key={`${procedure.data.id}:${procedure.data.currentVersion}`}
                  workspaceId={workspaceId}
                  slug={slug}
                  procedure={procedure.data}
                  canManage={canManage}
                />
              </TabsContent>
              <TabsContent value='preview' className='pt-3'>
                <AiProcedurePreview
                  workspaceId={workspaceId}
                  procedureId={procedure.data.id}
                />
              </TabsContent>
              <TabsContent value='versions' className='pt-3'>
                <AiProcedureVersions
                  workspaceId={workspaceId}
                  procedureId={procedure.data.id}
                  canManage={canManage}
                />
              </TabsContent>
              <TabsContent value='runs' className='pt-3'>
                <AiProcedureRuns
                  workspaceId={workspaceId}
                  procedureId={procedure.data.id}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { PlusSignIcon, Task01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelAiNotice } from '@/app/_components/steel-ai/steel-ai-notice'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAiProcedureCatalog,
  useAiProcedures,
} from '@/src/hooks/use-ai-procedures'
import { PROCEDURE_STATUS_LABEL } from './ai-procedure-labels'

/** `/ai/procedures` — runbooks with mandatory steps. */
export function AiProceduresPage({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const procedures = useAiProcedures(workspaceId)
  const catalog = useAiProcedureCatalog(workspaceId)
  const canManage = catalog.data?.canManage ?? false

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title='Procedimentos'
        actions={
          canManage ? (
            <Button
              size='sm'
              nativeButton={false}
              render={<Link href={`/${slug}/ai/procedures/new`} />}
            >
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              <span className='hidden sm:inline'>Novo procedimento</span>
            </Button>
          ) : null
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-4xl space-y-5 px-4 pt-2 pb-10 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <h1 className='font-semibold text-lg'>Procedimentos</h1>
            <p className='max-w-prose text-muted-foreground text-sm'>
              Roteiros com condições e passos obrigatórios, como “segunda via de
              boleto: validar o CPF, consultar e enviar”. A resposta automática
              do WhatsApp e os agentes seguem o roteiro na ordem; a IA não pode
              pular nem reordenar passos, e uma falha passa a conversa para um
              atendente.
            </p>
          </header>

          {!canManage && !catalog.isLoading ? (
            <SteelAiNotice tone='info' icon={Task01Icon}>
              Só o dono e os administradores criam e editam procedimentos. Você
              pode consultar o que está configurado.
            </SteelAiNotice>
          ) : null}

          {procedures.isLoading ? (
            <div className='space-y-3'>
              <Skeleton className='h-20 w-full' />
              <Skeleton className='h-20 w-full' />
            </div>
          ) : procedures.isError ? (
            <p className='text-destructive text-sm'>
              {procedures.error instanceof Error
                ? procedures.error.message
                : 'Não foi possível carregar os procedimentos.'}
            </p>
          ) : !procedures.data?.length ? (
            <EmptyState>
              Nenhum procedimento ainda. Crie o primeiro roteiro para a IA
              seguir passo a passo.
            </EmptyState>
          ) : (
            <ul className='grid gap-3'>
              {procedures.data.map((procedure) => (
                <li key={procedure.id}>
                  <Link
                    href={`/${slug}/ai/procedures/${procedure.id}`}
                    className='block rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/50'
                  >
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>{procedure.name}</span>
                      <Badge
                        variant={
                          procedure.status === 'ACTIVE' ? 'default' : 'secondary'
                        }
                      >
                        {PROCEDURE_STATUS_LABEL[procedure.status]}
                      </Badge>
                      <span className='ml-auto text-muted-foreground text-xs'>
                        {procedure.steps.length}{' '}
                        {procedure.steps.length === 1 ? 'passo' : 'passos'} ·{' '}
                        {procedure.runsThisMonth}{' '}
                        {procedure.runsThisMonth === 1
                          ? 'execução no mês'
                          : 'execuções no mês'}
                      </span>
                    </div>
                    <p className='mt-1 line-clamp-2 text-muted-foreground text-sm'>
                      {procedure.whenToUse}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

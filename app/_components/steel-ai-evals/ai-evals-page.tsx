'use client'

import {
  PlusSignIcon,
  TestTube01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelAiNotice } from '@/app/_components/steel-ai/steel-ai-notice'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { useAiEvalSets, useCreateAiEvalSet } from '@/src/hooks/use-ai-evals'
import { AI_EVAL_MAX_SETS } from '@/src/lib/ai/quality-labels'
import { formatEvalDate, runSummary } from './ai-eval-format'
import { AiEvalSetForm } from './ai-eval-set-form'

/** `/ai/evals` — the workspace's eval sets (admins). */
export function AiEvalsPage({
  workspaceId,
  slug,
  canManage,
}: {
  workspaceId: string
  slug: string
  canManage: boolean
}) {
  const router = useRouter()
  const sets = useAiEvalSets(workspaceId, canManage)
  const create = useCreateAiEvalSet(workspaceId)
  const [open, setOpen] = useState(false)
  const count = sets.data?.length ?? 0

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title='Avaliações'
        actions={
          canManage ? (
            <Button
              size='sm'
              onClick={() => setOpen(true)}
              disabled={count >= AI_EVAL_MAX_SETS}
            >
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              <span className='hidden sm:inline'>Novo conjunto</span>
            </Button>
          ) : null
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-4xl space-y-5 px-4 pt-2 pb-10 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <h1 className='font-semibold text-lg'>Avaliações</h1>
            <p className='max-w-prose text-muted-foreground text-sm'>
              Conjuntos de perguntas com a resposta esperada. Rode o conjunto
              antes de trocar o modelo, o prompt ou uma skill e compare o
              resultado com a última execução. O custo entra na cota de IA do
              espaço de trabalho.
            </p>
          </header>

          {!canManage ? (
            <SteelAiNotice tone='info' icon={TestTube01Icon}>
              Só o dono e os administradores do espaço de trabalho gerenciam as
              avaliações. Você ainda pode avaliar as respostas com 👍/👎.
            </SteelAiNotice>
          ) : sets.isLoading ? (
            <div className='space-y-3'>
              <Skeleton className='h-20 w-full' />
              <Skeleton className='h-20 w-full' />
            </div>
          ) : sets.isError ? (
            <p className='text-destructive text-sm'>
              {sets.error instanceof Error
                ? sets.error.message
                : 'Não foi possível carregar os conjuntos.'}
            </p>
          ) : count === 0 ? (
            <EmptyState>
              Nenhum conjunto ainda. Crie um e adicione perguntas — ou salve
              respostas do chat com o botão “Salvar como caso de teste”.
            </EmptyState>
          ) : (
            <ul className='grid gap-3'>
              {sets.data?.map((set) => (
                <li key={set.id}>
                  <Link
                    href={`/${slug}/ai/evals/${set.id}`}
                    className='block rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/50'
                  >
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>{set.name}</span>
                      <Badge variant='secondary'>{set.targetLabel}</Badge>
                      <span className='ml-auto text-muted-foreground text-xs'>
                        {set.caseCount} {set.caseCount === 1 ? 'caso' : 'casos'}
                      </span>
                    </div>
                    {set.description ? (
                      <p className='mt-1 line-clamp-2 text-muted-foreground text-sm'>
                        {set.description}
                      </p>
                    ) : null}
                    <p className='mt-1.5 text-muted-foreground text-xs'>
                      {set.lastRun
                        ? `Última execução: ${runSummary(set.lastRun)} · ${formatEvalDate(set.lastRun.finishedAt ?? set.lastRun.createdAt)}`
                        : 'Ainda não rodou.'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>Novo conjunto de teste</DialogTitle>
            <DialogDescription>
              Escolha o que será avaliado. Depois, adicione as perguntas.
            </DialogDescription>
          </DialogHeader>
          <AiEvalSetForm
            workspaceId={workspaceId}
            pending={create.isPending}
            onCancel={() => setOpen(false)}
            onSubmit={(input) =>
              create.mutate(input, {
                onSuccess: (created) => {
                  setOpen(false)
                  notify.success('Conjunto criado.')
                  router.push(`/${slug}/ai/evals/${created.id}`)
                },
                onError: notify.error,
              })
            }
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

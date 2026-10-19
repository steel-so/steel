'use client'

import { TestTube01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useLatestAiEvals, useStartAiEvalRun } from '@/src/hooks/use-ai-evals'
import type {
  AiEvalRunReason,
  AiEvalTargetKey,
} from '@/src/lib/ai/quality-labels'
import { formatEvalDate, runSummary } from './ai-eval-format'

export interface AiEvalCandidate {
  modelKey?: string | null
  promptOverride?: string | null
  skillId?: string | null
}

/**
 * "Rodar avaliação antes de trocar" (ADR 0039): the last result of every
 * eval set of a target and a button that runs them with the draft (model,
 * prompt or skill) still unsaved. Admins only — renders nothing for others.
 */
export function AiEvalGuard({
  workspaceId,
  target,
  candidate,
  reason,
  changed,
  className,
}: {
  workspaceId: string
  target: AiEvalTargetKey
  /** The unsaved draft to evaluate (omit = current settings). */
  candidate?: AiEvalCandidate
  reason: Exclude<AiEvalRunReason, 'manual'>
  /** The draft differs from what is saved: stress the call to action. */
  changed?: boolean
  className?: string
}) {
  const params = useParams<{ 'workspace-slug'?: string }>()
  const slug = params?.['workspace-slug']
  const latest = useLatestAiEvals(workspaceId, target)
  const start = useStartAiEvalRun(workspaceId)
  if (latest.isError || !latest.data) return null
  const sets = latest.data
  const evalsHref = slug ? `/${slug}/ai/evals` : null

  async function runAll() {
    let started = 0
    for (const set of sets) {
      if (set.caseCount === 0) continue
      try {
        await start.mutateAsync({
          setId: set.id,
          modelKey: candidate?.modelKey ?? null,
          promptOverride: candidate?.promptOverride ?? null,
          skillId: candidate?.skillId ?? null,
          reason: changed ? reason : 'manual',
        })
        started += 1
      } catch (error) {
        notify.error(error, `Não foi possível rodar “${set.name}”`)
      }
    }
    if (started > 0) {
      notify.success(
        started === 1
          ? 'Avaliação na fila. Acompanhe em Steel AI › Avaliações.'
          : `${started} avaliações na fila. Acompanhe em Steel AI › Avaliações.`,
      )
    }
  }

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border px-3 py-2.5 text-sm',
        changed && 'border-primary/40 bg-primary/5',
        className,
      )}
      data-testid='ai-eval-guard'
    >
      <div className='flex items-center gap-1.5 font-medium text-xs'>
        <SteelIcon icon={TestTube01Icon} strokeWidth={2} className='size-3.5' />
        Avaliação
      </div>
      {sets.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Nenhum conjunto de teste para comparar antes de trocar.{' '}
          {evalsHref ? (
            <Link
              href={evalsHref}
              className='font-medium text-foreground underline underline-offset-4'
            >
              Criar conjunto
            </Link>
          ) : null}
        </p>
      ) : (
        <>
          <ul className='space-y-0.5 text-muted-foreground text-xs'>
            {sets.map((set) => (
              <li key={set.id}>
                <span className='font-medium text-foreground'>{set.name}</span>
                {': '}
                {set.lastRun
                  ? `${runSummary(set.lastRun)} · ${set.lastRun.modelLabel ?? 'modelo padrão'} · ${formatEvalDate(set.lastRun.finishedAt)}`
                  : set.caseCount === 0
                    ? 'sem casos'
                    : 'ainda não rodou'}
              </li>
            ))}
          </ul>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              size='xs'
              variant={changed ? 'default' : 'outline'}
              disabled={
                start.isPending || sets.every((set) => set.caseCount === 0)
              }
              onClick={() => void runAll()}
            >
              Rodar avaliação antes de trocar
            </Button>
            {evalsHref ? (
              <Link
                href={evalsHref}
                className='text-muted-foreground text-xs underline-offset-4 hover:underline'
              >
                Ver resultados
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

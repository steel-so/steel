'use client'

import {
  Delete02Icon,
  PauseIcon,
  PencilEdit02Icon,
  PlayIcon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCrmCadences,
  useDeleteCrmCadence,
  useUpdateCrmCadence,
} from '@/src/hooks/use-crm-cadences'
import type { CrmCadenceDTO } from '@/types/crm-cadence'
import { CadenceEditorSheet } from './cadence-editor-sheet'
import { CadenceEnrollmentsList } from './cadence-enrollments-list'
import {
  CADENCE_STATUS_LABEL,
  describeDelay,
  formatPercent,
  STEP_TYPE_LABEL,
} from './cadence-labels'

/** "Cadências" page: the cadences of the workspace, their numbers and who is running. */
export function CrmCadencesPanel({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const cadences = useCrmCadences(workspaceId)
  const update = useUpdateCrmCadence(workspaceId)
  const remove = useDeleteCrmCadence(workspaceId)
  const [editing, setEditing] = useState<CrmCadenceDTO | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const detail = cadences.data?.find((item) => item.id === detailId) ?? null

  function toggle(cadence: CrmCadenceDTO) {
    const next = cadence.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    update.mutate(
      { cadenceId: cadence.id, status: next },
      {
        onSuccess: () =>
          notify.success(
            next === 'PAUSED' ? 'Cadência pausada' : 'Cadência ativada',
          ),
        onError: (error) => notify.error(error),
      },
    )
  }

  function archive(cadence: CrmCadenceDTO) {
    if (
      !window.confirm(
        `Arquivar "${cadence.name}"? Quem está nela sai da sequência; o histórico fica.`,
      )
    ) {
      return
    }
    remove.mutate(cadence.id, {
      onSuccess: () => notify.success('Cadência arquivada'),
      onError: (error) => notify.error(error),
    })
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='max-w-2xl text-muted-foreground text-sm'>
          Sequências de e-mail, WhatsApp e tarefas, lead a lead. Diferente das
          campanhas, que saem em massa, cada lead tem o seu próprio relógio e a
          cadência para sozinha quando ele responde.
        </p>
        <Button
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          <SteelIcon icon={PlusSignIcon} />
          Nova cadência
        </Button>
      </div>

      {cadences.isLoading ? (
        <div className='grid gap-3 md:grid-cols-2'>
          <Skeleton className='h-40' />
          <Skeleton className='h-40' />
        </div>
      ) : cadences.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar as cadências.
        </p>
      ) : (cadences.data ?? []).length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center'>
          <p className='font-medium'>Nenhuma cadência ainda</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Crie uma sequência de contatos e inscreva leads nela pela tela de
            Leads.
          </p>
        </div>
      ) : (
        <ul className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {cadences.data?.map((cadence) => (
            <li
              key={cadence.id}
              className='flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4'
            >
              <div className='flex items-start justify-between gap-2'>
                <button
                  type='button'
                  className='min-w-0 text-left'
                  onClick={() => setDetailId(cadence.id)}
                >
                  <span className='block truncate font-medium hover:underline'>
                    {cadence.name}
                  </span>
                  {cadence.description ? (
                    <span className='line-clamp-2 text-muted-foreground text-xs'>
                      {cadence.description}
                    </span>
                  ) : null}
                </button>
                <Badge
                  variant={
                    cadence.status === 'ACTIVE' ? 'secondary' : 'outline'
                  }
                >
                  {CADENCE_STATUS_LABEL[cadence.status]}
                </Badge>
              </div>

              <ol className='flex flex-wrap gap-1 text-xs'>
                {cadence.steps.map((step) => (
                  <li
                    key={step.id}
                    className='rounded-full bg-muted px-2 py-0.5'
                    title={describeDelay(
                      step.delayValue,
                      step.delayUnit,
                      step.position === 0,
                    )}
                  >
                    {step.position + 1}. {STEP_TYPE_LABEL[step.type]}
                  </li>
                ))}
              </ol>

              <dl className='grid grid-cols-3 gap-2 text-center text-xs'>
                <Stat label='Inscritos' value={cadence.stats?.enrolled ?? 0} />
                <Stat label='Em andamento' value={cadence.stats?.active ?? 0} />
                <Stat
                  label='Respostas'
                  value={
                    cadence.stats
                      ? `${cadence.stats.replied} (${formatPercent(cadence.stats.replyRate)})`
                      : 0
                  }
                />
              </dl>

              <div className='mt-auto flex flex-wrap gap-1'>
                <Button
                  size='xs'
                  variant='outline'
                  disabled={update.isPending}
                  onClick={() => toggle(cadence)}
                >
                  <SteelIcon
                    icon={cadence.status === 'ACTIVE' ? PauseIcon : PlayIcon}
                  />
                  {cadence.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}
                </Button>
                <Button
                  size='xs'
                  variant='outline'
                  onClick={() => {
                    setEditing(cadence)
                    setEditorOpen(true)
                  }}
                >
                  <SteelIcon icon={PencilEdit02Icon} />
                  Editar
                </Button>
                <Button
                  size='xs'
                  variant='ghost'
                  aria-label={`Arquivar ${cadence.name}`}
                  disabled={remove.isPending}
                  onClick={() => archive(cadence)}
                >
                  <SteelIcon icon={Delete02Icon} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CadenceEditorSheet
        workspaceId={workspaceId}
        workspaceSlug={slug}
        cadence={editing}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />

      <Sheet
        open={detail !== null}
        onOpenChange={(next) => {
          if (!next) setDetailId(null)
        }}
      >
        <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>{detail.name}</SheetTitle>
                <SheetDescription>
                  {detail.steps.length} passos ·{' '}
                  {detail.stopOnReply
                    ? 'para quando o lead responde'
                    : 'não para quando o lead responde'}
                </SheetDescription>
              </SheetHeader>
              <div className='flex flex-col gap-4 px-4 pb-4'>
                <ol className='flex flex-col gap-2 text-sm'>
                  {detail.steps.map((step) => {
                    const counts = detail.stats?.sentByStep.find(
                      (item) => item.position === step.position,
                    )
                    return (
                      <li
                        key={step.id}
                        className='flex flex-wrap items-baseline gap-x-2 rounded-md border p-2'
                      >
                        <span className='font-medium'>
                          {step.position + 1}. {STEP_TYPE_LABEL[step.type]}
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          {describeDelay(
                            step.delayValue,
                            step.delayUnit,
                            step.position === 0,
                          )}
                        </span>
                        <span className='ml-auto text-muted-foreground text-xs'>
                          {counts?.sent ?? 0} feitos
                          {counts?.failed ? ` · ${counts.failed} falhas` : ''}
                        </span>
                      </li>
                    )
                  })}
                </ol>
                <h3 className='font-medium text-sm'>Inscritos</h3>
                <CadenceEnrollmentsList
                  workspaceId={workspaceId}
                  cadenceId={detail.id}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className='rounded-md bg-muted/50 p-2'>
      <dd className='font-semibold text-sm'>{value}</dd>
      <dt className='text-muted-foreground'>{label}</dt>
    </div>
  )
}

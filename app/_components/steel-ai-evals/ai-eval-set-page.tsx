'use client'

import {
  ArrowLeft01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlayIcon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import { formatUsd } from '@/app/_components/steel-ai-usage/usage-format'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
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
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useAiEvalRun,
  useAiEvalRuns,
  useAiEvalSet,
  useDeleteAiEvalCase,
  useDeleteAiEvalSet,
  useSaveAiEvalCase,
  useStartAiEvalRun,
  useUpdateAiEvalSet,
} from '@/src/hooks/use-ai-evals'
import { useSteelAiCapabilities } from '@/src/hooks/use-steel-ai'
import {
  AI_EVAL_MAX_CASES,
  AI_EVAL_RUN_REASON_LABELS,
} from '@/src/lib/ai/quality-labels'
import type { AiEvalCaseDTO, AiEvalRunDTO } from '@/types/ai-quality'
import { AiEvalCaseForm } from './ai-eval-case-form'
import {
  formatEvalDate,
  formatPercent,
  formatScore,
  RUN_STATUS_LABEL,
  runSummary,
} from './ai-eval-format'
import { AiEvalSetForm } from './ai-eval-set-form'

const DEFAULT_MODEL = '__default__'

type CaseDialog = { kind: 'new' } | { kind: 'edit'; testCase: AiEvalCaseDTO }

/** Model picker + start of a run (current model or a candidate). */
function RunDialog({
  workspaceId,
  setId,
  open,
  onOpenChange,
  onStarted,
}: {
  workspaceId: string
  setId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (run: AiEvalRunDTO) => void
}) {
  const capabilities = useSteelAiCapabilities(workspaceId)
  const start = useStartAiEvalRun(workspaceId)
  const [modelKey, setModelKey] = useState(DEFAULT_MODEL)
  const models = capabilities.data?.models ?? []
  const labels = new Map(models.map((m) => [m.key, m.label]))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Rodar avaliação</DialogTitle>
          <DialogDescription>
            Cada caso é respondido e corrigido no servidor; a tela atualiza
            sozinha. O custo entra na cota de IA do espaço de trabalho.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-1.5'>
          <Label>Modelo</Label>
          <Select
            value={modelKey}
            onValueChange={(value) =>
              setModelKey(typeof value === 'string' ? value : DEFAULT_MODEL)
            }
          >
            <SelectTrigger aria-label='Modelo' className='w-full'>
              <SelectValue>
                {(value: string) =>
                  value === DEFAULT_MODEL
                    ? 'Modelo padrão atual'
                    : (labels.get(value) ?? value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value={DEFAULT_MODEL}>
                  Modelo padrão atual
                </SelectItem>
                {models.map((model) => (
                  <SelectItem key={model.key} value={model.key}>
                    {model.label} · {model.providerLabel}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className='text-muted-foreground text-xs'>
            Escolha outro modelo para ver como ele se sai antes de trocar.
          </p>
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={start.isPending}
            onClick={() =>
              start.mutate(
                {
                  setId,
                  modelKey: modelKey === DEFAULT_MODEL ? null : modelKey,
                  reason:
                    modelKey === DEFAULT_MODEL ? 'manual' : 'model_change',
                },
                {
                  onSuccess: (run) => {
                    onOpenChange(false)
                    notify.success('Avaliação na fila.')
                    onStarted(run)
                  },
                  onError: notify.error,
                },
              )
            }
          >
            <SteelIcon icon={PlayIcon} strokeWidth={2} />
            Rodar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RunDetail({
  workspaceId,
  setId,
  runId,
}: {
  workspaceId: string
  setId: string
  runId: string
}) {
  const run = useAiEvalRun(workspaceId, setId, runId)
  if (run.isLoading) return <Skeleton className='h-32 w-full' />
  if (!run.data) {
    return (
      <p className='text-destructive text-sm'>
        Não foi possível carregar a execução.
      </p>
    )
  }
  const data = run.data
  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs'>
        <span>{runSummary(data)}</span>
        <span>Nota média {formatScore(data.avgScore)}</span>
        <span>{data.modelLabel ?? 'Modelo padrão'}</span>
        <span>{formatUsd(data.costUsd)}</span>
        <span>{AI_EVAL_RUN_REASON_LABELS[data.reason]}</span>
      </div>
      {data.error ? (
        <p className='text-destructive text-sm'>{data.error}</p>
      ) : null}
      {data.results.length === 0 ? (
        <EmptyState>
          {data.status === 'QUEUED' || data.status === 'RUNNING'
            ? 'Os resultados aparecem aqui conforme os casos são corrigidos.'
            : 'Nenhum caso corrigido.'}
        </EmptyState>
      ) : (
        <ul className='space-y-2'>
          {data.results.map((result) => (
            <li
              key={result.id}
              className='space-y-1.5 rounded-lg border px-3 py-2.5 text-sm'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={result.passed ? 'secondary' : 'destructive'}>
                  {result.passed ? 'Passou' : 'Falhou'}
                </Badge>
                {result.judgeScore !== null ? (
                  <span className='text-muted-foreground text-xs'>
                    Nota {formatScore(result.judgeScore)}
                  </span>
                ) : null}
                <span className='min-w-0 flex-1 truncate font-medium'>
                  {result.input}
                </span>
              </div>
              {result.output ? (
                <p className='line-clamp-6 whitespace-pre-wrap break-words text-muted-foreground'>
                  {result.output}
                </p>
              ) : null}
              {result.failedChecks.length > 0 ? (
                <ul className='list-inside list-disc text-xs'>
                  {result.failedChecks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              ) : null}
              {result.judgeRationale ? (
                <p className='text-xs'>
                  <span className='font-medium'>Juiz:</span>{' '}
                  {result.judgeRationale}
                </p>
              ) : null}
              {result.error ? (
                <p className='text-destructive text-xs'>{result.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** `/ai/evals/[setId]` — cases, runs and results of one set (admins). */
export function AiEvalSetPage({
  workspaceId,
  slug,
  setId,
}: {
  workspaceId: string
  slug: string
  setId: string
}) {
  const router = useRouter()
  const set = useAiEvalSet(workspaceId, setId)
  const runs = useAiEvalRuns(workspaceId, setId)
  const update = useUpdateAiEvalSet(workspaceId, setId)
  const removeSet = useDeleteAiEvalSet(workspaceId)
  const saveCase = useSaveAiEvalCase(workspaceId, setId)
  const removeCase = useDeleteAiEvalCase(workspaceId, setId)
  const [editingSet, setEditingSet] = useState(false)
  const [deletingSet, setDeletingSet] = useState(false)
  const [caseDialog, setCaseDialog] = useState<CaseDialog | null>(null)
  const [deletingCase, setDeletingCase] = useState<AiEvalCaseDTO | null>(null)
  const [running, setRunning] = useState(false)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const runId = selectedRun ?? runs.data?.[0]?.id ?? null

  if (set.isLoading) {
    return (
      <div className='flex h-full w-full flex-col'>
        <SteelAiTopBar title='Avaliações' />
        <div className='mx-auto w-full max-w-4xl space-y-3 px-4 pt-4 sm:px-6'>
          <Skeleton className='h-8 w-1/2' />
          <Skeleton className='h-40 w-full' />
        </div>
      </div>
    )
  }
  if (!set.data) {
    return (
      <div className='flex h-full w-full flex-col'>
        <SteelAiTopBar title='Avaliações' />
        <div className='mx-auto w-full max-w-4xl px-4 pt-4 sm:px-6'>
          <p className='text-destructive text-sm'>
            {set.error instanceof Error
              ? set.error.message
              : 'Conjunto não encontrado.'}
          </p>
        </div>
      </div>
    )
  }
  const data = set.data
  const busyRun =
    data.lastRun?.status === 'QUEUED' || data.lastRun?.status === 'RUNNING'

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title={data.name}
        actions={
          <Button
            size='sm'
            disabled={data.caseCount === 0 || busyRun}
            onClick={() => setRunning(true)}
          >
            <SteelIcon icon={PlayIcon} strokeWidth={2} />
            <span className='hidden sm:inline'>
              {busyRun ? 'Rodando…' : 'Rodar avaliação'}
            </span>
          </Button>
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-4xl space-y-5 px-4 pt-2 pb-10 sm:px-6 sm:pt-4'>
          <Link
            href={`/${slug}/ai/evals`}
            className='inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground'
          >
            <SteelIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className='size-4'
            />
            Avaliações
          </Link>
          <header className='flex flex-wrap items-start gap-3'>
            <div className='min-w-0 flex-1 space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <h1 className='font-semibold text-lg'>{data.name}</h1>
                <Badge variant='secondary'>{data.targetLabel}</Badge>
              </div>
              {data.description ? (
                <p className='max-w-prose text-muted-foreground text-sm'>
                  {data.description}
                </p>
              ) : null}
            </div>
            <div className='flex gap-1'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setEditingSet(true)}
              >
                <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                Editar
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Excluir conjunto'
                onClick={() => setDeletingSet(true)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
          </header>

          <Card>
            <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-2'>
              <div className='space-y-1.5'>
                <CardTitle>Casos de teste</CardTitle>
                <CardDescription>
                  {data.caseCount} de {AI_EVAL_MAX_CASES} casos.
                </CardDescription>
              </div>
              <Button
                size='sm'
                variant='outline'
                disabled={data.caseCount >= AI_EVAL_MAX_CASES}
                onClick={() => setCaseDialog({ kind: 'new' })}
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Novo caso
              </Button>
            </CardHeader>
            <CardContent>
              {data.cases.length === 0 ? (
                <EmptyState>
                  Adicione perguntas com a resposta esperada para começar.
                </EmptyState>
              ) : (
                <ul className='divide-y'>
                  {data.cases.map((testCase) => (
                    <li
                      key={testCase.id}
                      className='flex items-start gap-2 py-2.5 first:pt-0'
                    >
                      <div className='min-w-0 flex-1 space-y-0.5'>
                        <p className='line-clamp-2 text-sm'>{testCase.input}</p>
                        <p className='text-muted-foreground text-xs'>
                          {[
                            testCase.expected ? 'resposta esperada' : null,
                            testCase.criteria ? 'critério' : null,
                            testCase.mustContain.length +
                              testCase.mustNotContain.length >
                            0
                              ? `${testCase.mustContain.length + testCase.mustNotContain.length} verificações`
                              : null,
                            testCase.sourceMessageId ? 'salvo do chat' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        aria-label='Editar caso'
                        onClick={() =>
                          setCaseDialog({ kind: 'edit', testCase })
                        }
                      >
                        <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        aria-label='Excluir caso'
                        onClick={() => setDeletingCase(testCase)}
                      >
                        <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Execuções</CardTitle>
              <CardDescription>
                Compare antes de trocar o modelo, o prompt ou a skill.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {(runs.data ?? []).length === 0 ? (
                <EmptyState>Nenhuma execução ainda.</EmptyState>
              ) : (
                <ul className='flex flex-wrap gap-2' aria-label='Execuções'>
                  {runs.data?.map((run) => (
                    <li key={run.id}>
                      <button
                        type='button'
                        aria-pressed={run.id === runId}
                        onClick={() => setSelectedRun(run.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:bg-muted',
                          run.id === runId && 'border-primary bg-muted',
                        )}
                      >
                        <span className='block font-medium'>
                          {run.status === 'DONE'
                            ? formatPercent(run.passRate)
                            : RUN_STATUS_LABEL[run.status]}
                          {' · '}
                          {run.modelLabel ?? 'Padrão'}
                        </span>
                        <span className='block text-muted-foreground'>
                          {formatEvalDate(run.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {runId ? (
                <RunDetail
                  workspaceId={workspaceId}
                  setId={setId}
                  runId={runId}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <RunDialog
        workspaceId={workspaceId}
        setId={setId}
        open={running}
        onOpenChange={setRunning}
        onStarted={(run) => setSelectedRun(run.id)}
      />

      <Dialog open={editingSet} onOpenChange={setEditingSet}>
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>Editar conjunto</DialogTitle>
            <DialogDescription>
              O que é avaliado não muda depois de criado.
            </DialogDescription>
          </DialogHeader>
          <AiEvalSetForm
            workspaceId={workspaceId}
            set={data}
            pending={update.isPending}
            onCancel={() => setEditingSet(false)}
            onSubmit={(input) =>
              update.mutate(input, {
                onSuccess: () => {
                  setEditingSet(false)
                  notify.success('Conjunto salvo.')
                },
                onError: notify.error,
              })
            }
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={caseDialog !== null}
        onOpenChange={(open) => !open && setCaseDialog(null)}
      >
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>
              {caseDialog?.kind === 'edit' ? 'Editar caso' : 'Novo caso'}
            </DialogTitle>
            <DialogDescription>
              Informe a resposta esperada, um critério ou verificações de texto.
            </DialogDescription>
          </DialogHeader>
          {caseDialog ? (
            <AiEvalCaseForm
              key={caseDialog.kind === 'edit' ? caseDialog.testCase.id : 'new'}
              testCase={
                caseDialog.kind === 'edit' ? caseDialog.testCase : undefined
              }
              pending={saveCase.isPending}
              onCancel={() => setCaseDialog(null)}
              onSubmit={(input) =>
                saveCase.mutate(
                  {
                    ...input,
                    ...(caseDialog.kind === 'edit'
                      ? { id: caseDialog.testCase.id }
                      : {}),
                  },
                  {
                    onSuccess: () => {
                      setCaseDialog(null)
                      notify.success('Caso salvo.')
                    },
                    onError: notify.error,
                  },
                )
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingCase !== null}
        onOpenChange={(open) => !open && setDeletingCase(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este caso?</AlertDialogTitle>
            <AlertDialogDescription>
              As execuções antigas guardam a pergunta e o resultado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={removeCase.isPending}
              onClick={() =>
                deletingCase &&
                removeCase.mutate(deletingCase.id, {
                  onSuccess: () => {
                    setDeletingCase(null)
                    notify.success('Caso excluído.')
                  },
                  onError: notify.error,
                })
              }
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deletingSet} onOpenChange={setDeletingSet}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{data.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Os casos e todas as execuções do conjunto são apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={removeSet.isPending}
              onClick={() =>
                removeSet.mutate(setId, {
                  onSuccess: () => {
                    notify.success('Conjunto excluído.')
                    router.push(`/${slug}/ai/evals`)
                  },
                  onError: notify.error,
                })
              }
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

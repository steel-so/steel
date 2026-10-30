'use client'

import {
  Cancel01Icon,
  Delete02Icon,
  PlayIcon,
  TestTube01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { notify } from '@/lib/notify'
import {
  useDeleteSteelAgent,
  useRunSteelAgent,
  useSteelAgent,
  useSteelAgentCatalog,
  useSteelAgentRuns,
  useTestSteelAgent,
} from '@/src/hooks/use-steel-agents'
import { SteelAgentEditor } from './steel-agent-editor'
import {
  describeTrigger,
  formatAgentDate,
  RUN_STATUS_LABEL,
  RUN_STATUS_VARIANT,
  TEST_RUN_LABEL,
  TRIGGER_LABEL,
} from './steel-agent-labels'
import { SteelAgentSimulations } from './steel-agent-simulations'
import { SteelAgentVersions } from './steel-agent-versions'

export const TEST_AGENT_HINT =
  'Roda o agente uma vez em modo teste: consulta os dados de verdade, mas só simula as alterações — nada é gravado, enviado ou mandado para aprovação.'

const TABS = ['runs', 'versions', 'simulations', 'config'] as const

/** Only a known tab opens from the URL; anything else falls back to the runs. */
export function resolveTab(tab: string | undefined): (typeof TABS)[number] {
  return TABS.find((known) => known === tab) ?? 'runs'
}

/** `/ai/agents/[agentId]` — run history + configuration. */
export function SteelAgentDetail({
  workspaceId,
  slug,
  agentId,
  currentUserId,
  fromTemplate = false,
  initialTab,
}: {
  workspaceId: string
  slug: string
  agentId: string
  currentUserId: string
  /** Just created from a template: nudge to "Testar agente" first. */
  fromTemplate?: boolean
  /** `?tab=` of the link (e.g. a notification): which tab opens first. */
  initialTab?: string
}) {
  const agent = useSteelAgent(workspaceId, agentId)
  const catalog = useSteelAgentCatalog(workspaceId)
  const runs = useSteelAgentRuns(workspaceId, agentId)
  const runNow = useRunSteelAgent(workspaceId, agentId)
  const testRun = useTestSteelAgent(workspaceId, agentId)
  const remove = useDeleteSteelAgent(workspaceId)
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [nudge, setNudge] = useState(fromTemplate)
  const canManage = catalog.data?.canManage ?? false

  if (agent.isLoading) {
    return (
      <div className='flex h-full min-h-0 w-full flex-col'>
        <SteelAiTopBar />
        <div
          className='mx-auto w-full max-w-3xl space-y-3 px-4 pt-2 sm:px-6 sm:pt-4'
          aria-hidden
        >
          <Skeleton className='h-7 w-56 max-w-full' />
          <Skeleton className='h-40 rounded-xl' />
        </div>
      </div>
    )
  }
  if (!agent.data) {
    return (
      <div className='flex h-full min-h-0 w-full flex-col'>
        <SteelAiTopBar />
        <div className='mx-auto w-full max-w-3xl px-4 pt-4 text-muted-foreground text-sm sm:px-6'>
          Agente não encontrado.{' '}
          <Link href={`/${slug}/ai/agents`} className='text-primary underline'>
            Voltar para os agentes
          </Link>
        </div>
      </div>
    )
  }
  const data = agent.data
  const canRun = canManage || data.owner?.id === currentUserId

  async function run() {
    try {
      const created = await runNow.mutateAsync()
      notify.success('Execução enfileirada.')
      router.push(`/${slug}/ai/agents/${agentId}/runs/${created.id}`)
    } catch (error) {
      notify.error(error)
    }
  }

  async function test() {
    try {
      const created = await testRun.mutateAsync()
      notify.success('Teste enfileirado. Nada será alterado.')
      router.push(`/${slug}/ai/agents/${agentId}/runs/${created.id}`)
    } catch (error) {
      notify.error(error)
    }
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(agentId)
      notify.success('Agente excluído.')
      router.push(`/${slug}/ai/agents`)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title={data.name}
        actions={
          <div className='flex items-center gap-1'>
            {canRun ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size='sm'
                      variant='outline'
                      aria-label='Testar agente'
                      className='max-sm:size-8 max-sm:px-0'
                      disabled={testRun.isPending}
                      onClick={test}
                    />
                  }
                >
                  <SteelIcon icon={TestTube01Icon} strokeWidth={2} />
                  <span className='hidden sm:inline'>Testar</span>
                </TooltipTrigger>
                <TooltipContent side='bottom' className='max-w-64'>
                  {TEST_AGENT_HINT}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {canRun ? (
              <Button
                size='sm'
                aria-label='Executar agora'
                className='max-sm:size-8 max-sm:px-0'
                disabled={!data.enabled || runNow.isPending}
                onClick={run}
              >
                <SteelIcon icon={PlayIcon} strokeWidth={2} />
                <span className='hidden sm:inline'>Executar agora</span>
              </Button>
            ) : null}
            {canManage ? (
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Excluir agente'
                onClick={() => setDeleting(true)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            ) : null}
          </div>
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-5 px-4 pt-2 pb-8 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <h1 className='min-w-0 break-words font-semibold text-lg'>
                {data.name}
              </h1>
              <Badge variant={data.enabled ? 'secondary' : 'outline'}>
                {data.enabled ? 'Ativo' : 'Pausado'}
              </Badge>
            </div>
            <p className='text-muted-foreground text-sm'>
              {describeTrigger(data, catalog.data?.events)}
              {data.nextRunAt
                ? ` · próxima: ${formatAgentDate(data.nextRunAt, data.timezone)}`
                : null}
            </p>
          </header>

          {nudge && canRun ? (
            <div
              role='note'
              aria-label='Teste o agente antes de ativar'
              className='flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center'
            >
              <SteelIcon
                icon={TestTube01Icon}
                strokeWidth={2}
                className='hidden size-5 shrink-0 text-muted-foreground sm:block'
              />
              <div className='min-w-0 flex-1 space-y-0.5'>
                <p className='font-medium text-sm'>
                  Agente criado a partir de um modelo. Teste antes de ativar.
                </p>
                <p className='text-muted-foreground text-sm'>
                  {TEST_AGENT_HINT}
                </p>
              </div>
              <div className='flex shrink-0 items-center gap-1'>
                <Button
                  size='sm'
                  disabled={testRun.isPending}
                  onClick={test}
                  className='flex-1 sm:flex-none'
                >
                  <SteelIcon icon={TestTube01Icon} strokeWidth={2} />
                  Testar agente
                </Button>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  aria-label='Dispensar aviso'
                  onClick={() => setNudge(false)}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                </Button>
              </div>
            </div>
          ) : null}

          <Tabs defaultValue={resolveTab(initialTab)}>
            <TabsList>
              <TabsTrigger value='runs'>Execuções</TabsTrigger>
              <TabsTrigger value='versions'>Versões</TabsTrigger>
              <TabsTrigger value='simulations'>Simulações</TabsTrigger>
              <TabsTrigger value='config'>Configuração</TabsTrigger>
            </TabsList>
            <TabsContent value='runs' className='pt-3'>
              {runs.isLoading ? (
                <Skeleton className='h-24 rounded-xl' />
              ) : (runs.data ?? []).length === 0 ? (
                <p className='rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
                  Nenhuma execução ainda.
                </p>
              ) : (
                <ul className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card'>
                  {(runs.data ?? []).map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/${slug}/ai/agents/${agentId}/runs/${item.id}`}
                        className='flex flex-col items-start gap-1 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 sm:flex-row sm:items-center sm:gap-3'
                      >
                        <span className='flex shrink-0 items-center gap-1.5'>
                          <Badge variant={RUN_STATUS_VARIANT[item.status]}>
                            {RUN_STATUS_LABEL[item.status]}
                          </Badge>
                          {item.isTest ? (
                            <Badge variant='outline' className='gap-1'>
                              <SteelIcon
                                icon={TestTube01Icon}
                                strokeWidth={2}
                                className='size-3'
                              />
                              {TEST_RUN_LABEL}
                            </Badge>
                          ) : null}
                        </span>
                        <span className='w-full min-w-0 flex-1 truncate text-sm sm:w-auto'>
                          {item.summary ?? item.error ?? '—'}
                        </span>
                        <span className='shrink-0 whitespace-nowrap text-muted-foreground text-xs'>
                          {TRIGGER_LABEL[item.triggerType]} ·{' '}
                          {formatAgentDate(item.createdAt, data.timezone)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value='versions' className='pt-3'>
              <SteelAgentVersions
                workspaceId={workspaceId}
                agentId={agentId}
                timezone={data.timezone}
              />
            </TabsContent>
            <TabsContent value='simulations' className='pt-3'>
              <SteelAgentSimulations
                workspaceId={workspaceId}
                slug={slug}
                agentId={agentId}
                timezone={data.timezone}
                canSimulate={canRun}
              />
            </TabsContent>
            <TabsContent value='config' className='pt-3'>
              <SteelAgentEditor
                key={data.updatedAt}
                workspaceId={workspaceId}
                agent={data}
                currentUserId={currentUserId}
                onSaved={() => undefined}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agente?</AlertDialogTitle>
            <AlertDialogDescription>
              “{data.name}” e o histórico de execuções serão excluídos. O que o
              agente já alterou continua valendo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

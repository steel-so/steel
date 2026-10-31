'use client'

import {
  AiBrain01Icon,
  DashboardSquare02Icon,
  PlusSignIcon,
  Shield01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { SteelAiTemplateGallery } from '@/app/_components/steel-ai-templates/steel-ai-template-gallery'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAiTemplates } from '@/src/hooks/use-ai-templates'
import {
  useSteelAgentCatalog,
  useSteelAgents,
} from '@/src/hooks/use-steel-agents'
import {
  describeTrigger,
  formatAgentDate,
  RUN_STATUS_LABEL,
  RUN_STATUS_VARIANT,
} from './steel-agent-labels'

/** `/ai/agents` — the workspace agents with status and last run. */
export function SteelAgentsList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const agents = useSteelAgents(workspaceId)
  const catalog = useSteelAgentCatalog(workspaceId)
  const templates = useAiTemplates(workspaceId)
  const router = useRouter()
  const [gallery, setGallery] = useState(false)
  const canManage = catalog.data?.canManage ?? false
  const canCreate = canManage || (catalog.data?.canCreate ?? false)
  // Templates are an OWNER/ADMIN gallery; creating still needs `canManage`.
  const canUseTemplates = canManage && (templates.data?.canUse ?? false)
  const list = agents.data ?? []

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title='Agentes'
        actions={
          canCreate || canManage ? (
            <div className='flex items-center gap-1'>
              {canManage ? (
                <Button
                  size='sm'
                  variant='outline'
                  aria-label='Governança'
                  className='max-sm:size-8 max-sm:px-0'
                  render={<Link href={`/${slug}/ai/agents/governance`} />}
                  nativeButton={false}
                >
                  <SteelIcon icon={Shield01Icon} strokeWidth={2} />
                  <span className='hidden sm:inline'>Governança</span>
                </Button>
              ) : null}
              {canUseTemplates ? (
                <Button
                  size='sm'
                  variant='outline'
                  aria-label='Modelos'
                  className='max-sm:size-8 max-sm:px-0'
                  onClick={() => setGallery(true)}
                >
                  <SteelIcon icon={DashboardSquare02Icon} strokeWidth={2} />
                  <span className='hidden sm:inline'>Modelos</span>
                </Button>
              ) : null}
              {canCreate ? (
                <Button
                  size='sm'
                  aria-label='Novo agente'
                  className='max-sm:size-8 max-sm:px-0'
                  render={<Link href={`/${slug}/ai/agents/new`} />}
                  nativeButton={false}
                >
                  <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                  <span className='hidden sm:inline'>Novo agente</span>
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-5 px-4 pt-2 pb-8 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <h1 className='font-semibold text-lg'>Steel Agents</h1>
            <p className='max-w-prose text-muted-foreground text-sm'>
              Agentes que trabalham sozinhos — por agenda, por evento ou pelo
              botão — com as permissões do responsável. Escritas que pedem
              aprovação chegam na caixa de entrada.
            </p>
          </header>

          {agents.isLoading ? (
            <div className='space-y-2' aria-hidden>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className='h-16 rounded-xl' />
              ))}
            </div>
          ) : agents.isError ? (
            <p className='text-destructive text-sm'>
              Não foi possível carregar os agentes.
            </p>
          ) : list.length === 0 ? (
            <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center'>
              <SteelIcon
                icon={AiBrain01Icon}
                strokeWidth={1.5}
                className='size-8 text-muted-foreground'
              />
              <p className='font-medium text-sm'>Nenhum agente ainda</p>
              <p className='max-w-sm text-muted-foreground text-sm'>
                {canCreate
                  ? 'Crie um agente para triar chamados, acompanhar leads ou resumir o dia automaticamente.'
                  : 'Peça a um administrador para criar o primeiro agente.'}
              </p>
              {canUseTemplates ? (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setGallery(true)}
                >
                  <SteelIcon icon={DashboardSquare02Icon} strokeWidth={2} />
                  Criar a partir de modelo
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              {canUseTemplates ? (
                <button
                  type='button'
                  onClick={() => setGallery(true)}
                  className='flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50'
                >
                  <SteelIcon
                    icon={DashboardSquare02Icon}
                    strokeWidth={1.5}
                    className='size-5 shrink-0 text-muted-foreground'
                  />
                  <span className='min-w-0 flex-1'>
                    <span className='block font-medium text-sm'>
                      Criar a partir de modelo
                    </span>
                    <span className='block text-muted-foreground text-xs'>
                      Agentes prontos para chamados, funil, WhatsApp, consumo de
                      IA e acessos.
                    </span>
                  </span>
                </button>
              ) : null}
              <ul className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card'>
                {list.map((agent) => (
                  <li key={agent.id}>
                    <Link
                      href={`/${slug}/ai/agents/${agent.id}`}
                      className='flex flex-col gap-1.5 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 sm:flex-row sm:items-center sm:gap-4'
                    >
                      <div className='min-w-0 flex-1 space-y-0.5'>
                        <div className='flex min-w-0 items-center gap-2'>
                          <span className='truncate font-medium text-sm'>
                            {agent.name}
                          </span>
                          <Badge
                            variant={agent.enabled ? 'secondary' : 'outline'}
                            className='shrink-0'
                          >
                            {agent.enabled ? 'Ativo' : 'Pausado'}
                          </Badge>
                        </div>
                        <p className='truncate text-muted-foreground text-xs'>
                          {describeTrigger(agent, catalog.data?.events)}
                          {agent.owner
                            ? ` · ${agent.owner.name}`
                            : ' · Sem responsável'}
                        </p>
                      </div>
                      <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:shrink-0 sm:flex-nowrap'>
                        {agent.lastRun ? (
                          <>
                            <Badge
                              variant={RUN_STATUS_VARIANT[agent.lastRun.status]}
                            >
                              {RUN_STATUS_LABEL[agent.lastRun.status]}
                            </Badge>
                            <span className='whitespace-nowrap text-muted-foreground'>
                              {formatAgentDate(
                                agent.lastRun.createdAt,
                                agent.timezone,
                              )}
                            </span>
                          </>
                        ) : (
                          <span className='text-muted-foreground'>
                            Nunca executado
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      {canUseTemplates && templates.data ? (
        <SteelAiTemplateGallery
          kind='agents'
          open={gallery}
          onOpenChange={setGallery}
          templates={templates.data.agents}
          agentModeEnabled={templates.data.agentModeEnabled}
          onPick={(template) => {
            setGallery(false)
            router.push(`/${slug}/ai/agents/new?template=${template.id}`)
          }}
        />
      ) : null}
    </div>
  )
}

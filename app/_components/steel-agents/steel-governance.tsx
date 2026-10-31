'use client'

import {
  Download01Icon,
  PauseCircleIcon,
  PlayCircleIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
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
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  steelGovernanceExportUrl,
  useKillSteelAgents,
  useResumeSteelAgents,
  useSteelGovernance,
} from '@/src/hooks/use-steel-governance'
import type { SteelGovernanceDTO } from '@/types/steel-governance'
import { formatAgentDate } from './steel-agent-labels'
import { SteelGovernanceInventory } from './steel-governance-inventory'
import {
  formatRate,
  formatUsd,
  PERIOD_OPTIONS,
} from './steel-governance-labels'
import { SteelGovernanceMcp } from './steel-governance-mcp'
import { SteelGovernancePolicy } from './steel-governance-policy'

const TIMEZONE = 'America/Sao_Paulo'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-xl border border-border/80 bg-card px-3 py-2.5'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='font-semibold text-base tabular-nums'>{value}</dd>
    </div>
  )
}

function KillSwitchBanner({
  workspaceId,
  killSwitch,
}: {
  workspaceId: string
  killSwitch: SteelGovernanceDTO['killSwitch']
}) {
  const kill = useKillSteelAgents(workspaceId)
  const resume = useResumeSteelAgents(workspaceId)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  async function confirmKill() {
    try {
      const result = await kill.mutateAsync(reason.trim() || null)
      setOpen(false)
      setReason('')
      notify.success(
        `Agentes pausados. ${result.canceledRuns} execução(ões) e ${result.canceledActions} aprovação(ões) pendente(s) canceladas.`,
      )
    } catch (error) {
      notify.error(error)
    }
  }

  async function confirmResume() {
    try {
      await resume.mutateAsync()
      notify.success(
        'Agentes liberados. Eles voltam a rodar nos próximos gatilhos.',
      )
    } catch (error) {
      notify.error(error)
    }
  }

  if (killSwitch.active) {
    return (
      <div
        role='alert'
        className='flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center'
      >
        <div className='min-w-0 flex-1 space-y-0.5'>
          <p className='font-medium text-destructive text-sm'>
            Todos os agentes estão pausados por emergência
          </p>
          <p className='text-muted-foreground text-xs'>
            Desde {formatAgentDate(killSwitch.at, TIMEZONE)}
            {killSwitch.byName ? ` por ${killSwitch.byName}` : ''}.
            {killSwitch.reason ? ` Motivo: ${killSwitch.reason}` : ''}
          </p>
        </div>
        <Button
          size='sm'
          variant='outline'
          disabled={resume.isPending}
          onClick={confirmResume}
        >
          <SteelIcon icon={PlayCircleIcon} strokeWidth={2} />
          Retomar agentes
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className='flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 sm:flex-row sm:items-center'>
        <div className='min-w-0 flex-1 space-y-0.5'>
          <p className='font-medium text-sm'>Desligamento de emergência</p>
          <p className='text-muted-foreground text-xs'>
            Pausa todos os agentes do workspace de uma vez: nada novo roda e as
            aprovações pendentes são canceladas. O que já foi feito continua
            valendo.
          </p>
        </div>
        <Button size='sm' variant='destructive' onClick={() => setOpen(true)}>
          <SteelIcon icon={PauseCircleIcon} strokeWidth={2} />
          Pausar todos os agentes
        </Button>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausar todos os agentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Nenhum agente roda até alguém retomar. Execuções na fila e ações
              aguardando aprovação são canceladas. Fica registrado na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            aria-label='Motivo'
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder='Motivo (opcional), por exemplo: comportamento inesperado do agente de cobrança'
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={kill.isPending}
              onClick={confirmKill}
            >
              Pausar agora
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** `/ai/agents/governance` — A6 inventory, kill switch, A8 policy and MCP. */
export function SteelGovernance({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [days, setDays] = useState<number>(30)
  const governance = useSteelGovernance(workspaceId, days)
  const data = governance.data

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar title='Governança dos agentes' />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-4xl space-y-5 px-4 pt-2 pb-8 sm:px-6 sm:pt-4'>
          <header className='flex flex-col gap-3 sm:flex-row sm:items-start'>
            <div className='min-w-0 flex-1 space-y-1'>
              <h1 className='font-semibold text-lg'>Governança</h1>
              <p className='max-w-prose text-muted-foreground text-sm'>
                Quem responde por cada agente, o que ele pode fazer, quanto é
                aprovado ou rejeitado e quanto custa frente ao que entrega.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <Select
                items={PERIOD_OPTIONS.map((o) => ({
                  value: String(o.value),
                  label: o.label,
                }))}
                value={String(days)}
                onValueChange={(next) => next && setDays(Number(next))}
              >
                <SelectTrigger aria-label='Período' className='w-44'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size='sm'
                variant='outline'
                render={
                  <a
                    href={steelGovernanceExportUrl(workspaceId, days)}
                    download
                  />
                }
                nativeButton={false}
              >
                <SteelIcon icon={Download01Icon} strokeWidth={2} />
                Exportar CSV
              </Button>
            </div>
          </header>

          {governance.isLoading ? (
            <div className='space-y-2' aria-hidden>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className='h-20 rounded-xl' />
              ))}
            </div>
          ) : governance.isError || !data ? (
            <p className='text-destructive text-sm'>
              Não foi possível carregar a governança. Ela é aberta a quem
              administra os agentes.{' '}
              <Link href={`/${slug}/ai/agents`} className='underline'>
                Voltar aos agentes
              </Link>
            </p>
          ) : (
            <>
              <KillSwitchBanner
                workspaceId={workspaceId}
                killSwitch={data.killSwitch}
              />
              <dl className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Stat
                  label='Agentes ativos'
                  value={`${data.totals.active} de ${data.totals.agents}`}
                />
                <Stat label='Execuções' value={String(data.totals.runs)} />
                <Stat
                  label='Aprovação das ações'
                  value={formatRate(data.totals.approvalRate)}
                />
                <Stat
                  label='Custo no período'
                  value={formatUsd(data.totals.costUsd)}
                />
              </dl>
              <Tabs defaultValue='inventory'>
                <TabsList>
                  <TabsTrigger value='inventory'>Inventário</TabsTrigger>
                  <TabsTrigger value='policy'>Permissões</TabsTrigger>
                  <TabsTrigger value='mcp'>Servidores MCP</TabsTrigger>
                </TabsList>
                <TabsContent value='inventory' className='pt-3'>
                  <SteelGovernanceInventory data={data} slug={slug} />
                </TabsContent>
                <TabsContent value='policy' className='pt-3'>
                  <SteelGovernancePolicy
                    workspaceId={workspaceId}
                    policy={data.policy}
                  />
                </TabsContent>
                <TabsContent value='mcp' className='pt-3'>
                  <SteelGovernanceMcp workspaceId={workspaceId} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

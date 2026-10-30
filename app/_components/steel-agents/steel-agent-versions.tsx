'use client'

import { useState } from 'react'
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
import { notify } from '@/lib/notify'
import {
  useSteelAgentVersionActions,
  useSteelAgentVersions,
} from '@/src/hooks/use-steel-agents'
import type {
  SteelAgentVersionDTO,
  SteelAgentVersionStatsDTO,
} from '@/types/steel-agent'
import {
  formatAgentDate,
  formatRate,
  formatUsd,
  VERSION_STATUS_LABEL,
  VERSION_STATUS_VARIANT,
} from './steel-agent-labels'

type Confirm = {
  kind: 'promote' | 'discard' | 'restore'
  version: number
  id: string
}

const CONFIRM_COPY: Record<
  Confirm['kind'],
  { title: string; body: (n: number) => string; action: string }
> = {
  promote: {
    title: 'Promover versão?',
    body: (n) =>
      `A v${n} passa a rodar em 100% das execuções e a versão atual deixa de ser a publicada.`,
    action: 'Promover',
  },
  discard: {
    title: 'Descartar versão?',
    body: (n) =>
      `A v${n} deixa de receber execuções e não será publicada. O histórico fica guardado.`,
    action: 'Descartar',
  },
  restore: {
    title: 'Restaurar versão?',
    body: (n) =>
      `O conteúdo da v${n} vira uma nova versão e passa pela mesma avaliação de qualquer edição.`,
    action: 'Restaurar',
  },
}

function StatsRow({ stats }: { stats: SteelAgentVersionStatsDTO }) {
  if (stats.runs === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        Sem execuções reais ainda.
      </p>
    )
  }
  const items: [string, string][] = [
    ['Execuções', String(stats.runs)],
    ['Sucesso', formatRate(stats.successRate)],
    ['Custo médio', formatUsd(stats.avgCostUsd)],
    ['Aprovação das ações', formatRate(stats.approvalRate)],
  ]
  return (
    <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4'>
      {items.map(([label, value]) => (
        <div key={label} className='min-w-0'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='font-medium tabular-nums'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function VersionCard({
  version,
  timezone,
  canManage,
  onAction,
}: {
  version: SteelAgentVersionDTO
  timezone: string
  canManage: boolean
  onAction: (kind: Confirm['kind'], version: SteelAgentVersionDTO) => void
}) {
  const live = version.status === 'PUBLISHED' || version.status === 'CHALLENGER'
  const canRestore =
    version.status === 'SUPERSEDED' ||
    version.status === 'REJECTED' ||
    version.status === 'DISCARDED'
  return (
    <li className='space-y-2 rounded-xl border border-border/80 bg-card p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-semibold text-sm'>v{version.number}</span>
        <Badge variant={VERSION_STATUS_VARIANT[version.status]}>
          {VERSION_STATUS_LABEL[version.status]}
          {version.status === 'CHALLENGER' && version.rolloutPercent
            ? ` · ${version.rolloutPercent}%`
            : ''}
        </Badge>
        <span className='ml-auto text-muted-foreground text-xs'>
          {formatAgentDate(version.createdAt, timezone)}
        </span>
      </div>
      {version.changeNote ? (
        <p className='text-sm'>{version.changeNote}</p>
      ) : null}
      {version.evalTotal !== null ? (
        <p className='text-muted-foreground text-sm'>
          Avaliação: {version.evalPassed} de {version.evalTotal} casos (
          {formatRate(version.evalPassRate)}).
        </p>
      ) : version.status === 'PENDING_EVAL' && !version.simulationId ? (
        <p className='text-muted-foreground text-sm'>
          Aguardando o resultado da avaliação…
        </p>
      ) : null}
      {version.simTotal !== null ? (
        <p className='text-muted-foreground text-sm'>
          Simulação: {version.simPassed} de {version.simTotal} cenários (
          {formatRate(version.simPassRate)}).
        </p>
      ) : version.status === 'PENDING_EVAL' && version.simulationId ? (
        <p className='text-muted-foreground text-sm'>
          Rodando os cenários de simulação…
        </p>
      ) : null}
      {version.evalNote && version.status === 'REJECTED' ? (
        <p className='text-destructive text-sm'>{version.evalNote}</p>
      ) : null}
      {live || version.stats.runs > 0 ? (
        <StatsRow stats={version.stats} />
      ) : null}
      <details className='text-sm'>
        <summary className='cursor-pointer text-muted-foreground text-xs'>
          Ver instruções e ferramentas
        </summary>
        <pre className='mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-xs'>
          {version.instructions}
        </pre>
        <p className='mt-2 text-muted-foreground text-xs'>
          Máximo de {version.maxToolRounds} etapas ·{' '}
          {version.tools.length === 0
            ? 'sem ferramentas'
            : version.tools
                .map(
                  (t) =>
                    `${t.toolName} (${t.mode === 'AUTO' ? 'automática' : 'com aprovação'})`,
                )
                .join(', ')}
        </p>
      </details>
      {canManage ? (
        <div className='flex flex-wrap gap-2 pt-1'>
          {version.status === 'CHALLENGER' ? (
            <Button size='sm' onClick={() => onAction('promote', version)}>
              Promover para 100%
            </Button>
          ) : null}
          {version.status === 'PENDING_EVAL' ||
          version.status === 'CHALLENGER' ? (
            <Button
              size='sm'
              variant='outline'
              onClick={() => onAction('discard', version)}
            >
              Descartar
            </Button>
          ) : null}
          {canRestore ? (
            <Button
              size='sm'
              variant='outline'
              onClick={() => onAction('restore', version)}
            >
              Restaurar como nova versão
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** "Versões" tab of an agent: history, gate result and the A/B comparison. */
export function SteelAgentVersions({
  workspaceId,
  agentId,
  timezone,
}: {
  workspaceId: string
  agentId: string
  timezone: string
}) {
  const versions = useSteelAgentVersions(workspaceId, agentId)
  const { promote, discard, restore } = useSteelAgentVersionActions(
    workspaceId,
    agentId,
  )
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  if (versions.isLoading) return <Skeleton className='h-32 rounded-xl' />
  if (!versions.data) {
    return (
      <p className='text-destructive text-sm'>
        Não foi possível carregar as versões.
      </p>
    )
  }
  const data = versions.data
  const published = data.versions.find((v) => v.id === data.publishedVersionId)
  const challenger = data.versions.find(
    (v) => v.id === data.challengerVersionId,
  )
  const busy = promote.isPending || discard.isPending || restore.isPending

  async function run() {
    if (!confirm) return
    try {
      if (confirm.kind === 'promote') await promote.mutateAsync(confirm.id)
      if (confirm.kind === 'discard') await discard.mutateAsync(confirm.id)
      if (confirm.kind === 'restore') {
        await restore.mutateAsync({ versionId: confirm.id })
      }
      notify.success(
        confirm.kind === 'promote'
          ? `v${confirm.version} promovida.`
          : confirm.kind === 'discard'
            ? `v${confirm.version} descartada.`
            : `v${confirm.version} restaurada como nova versão.`,
      )
      setConfirm(null)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        {data.evalSetId
          ? `Mudanças só são publicadas se ao menos ${formatRate(data.evalMinPassRate)} dos casos do conjunto de avaliação passarem.`
          : 'Sem conjunto de avaliação: as mudanças são publicadas na hora. Configure um na aba Configuração para travar a publicação.'}
        {data.simGateEnabled
          ? ` Também precisam passar em ao menos ${formatRate(data.simGateMinPassRate)} dos cenários de simulação salvos.`
          : ''}
      </p>

      {published && challenger ? (
        <section
          aria-label='Comparação A/B'
          className='space-y-3 rounded-xl border border-border/80 bg-muted/30 p-4'
        >
          <h3 className='font-semibold text-sm'>
            Teste A/B: v{published.number} × v{challenger.number} (
            {challenger.rolloutPercent}% das execuções na v{challenger.number})
          </h3>
          <div className='grid gap-4 sm:grid-cols-2'>
            {[published, challenger].map((v) => (
              <div key={v.id} className='space-y-1'>
                <p className='font-medium text-sm'>
                  v{v.number} · {VERSION_STATUS_LABEL[v.status]}
                </p>
                <StatsRow stats={v.stats} />
              </div>
            ))}
          </div>
          <p className='text-muted-foreground text-xs'>
            Execuções de teste não entram na comparação. Promova a versão nova
            quando os números convencerem, ou descarte-a para voltar a 100% na
            publicada.
          </p>
        </section>
      ) : null}

      {data.versions.length === 0 ? (
        <p className='rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
          Nenhuma versão ainda. A primeira é criada quando você editar o agente.
        </p>
      ) : (
        <ul className='space-y-3'>
          {data.versions.map((version) => (
            <VersionCard
              key={version.id}
              version={version}
              timezone={timezone}
              canManage={data.canManage && !busy}
              onAction={(kind, v) =>
                setConfirm({ kind, version: v.number, id: v.id })
              }
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm ? CONFIRM_COPY[confirm.kind].title : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? CONFIRM_COPY[confirm.kind].body(confirm.version) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={busy} onClick={run}>
              {confirm ? CONFIRM_COPY[confirm.kind].action : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

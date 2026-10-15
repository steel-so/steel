'use client'

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  LinkSquare02Icon,
  Loading03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import {
  crmSitesKeys,
  type SitePublishProblem,
} from '@/src/hooks/use-crm-sites'
import {
  siteExperimentKeys,
  useSiteExperimentImpact,
} from '@/src/hooks/use-site-experiments'
import type { SiteChangeItem, SiteChangesDTO } from '@/types/site-studio'
import { ExperimentPublishNotice } from './experiments/publish-notice'
import { useSiteEditor } from './site-editor-context'
import { useOpenTarget } from './use-open-target'

type Phase =
  | { step: 'loading' }
  | { step: 'review'; changes: SiteChangesDTO }
  | { step: 'publishing'; changes: SiteChangesDTO }
  | { step: 'done'; url: string; version: number }
  | { step: 'invalid'; message: string; problems: SitePublishProblem[] }
  | { step: 'error'; message: string }

const CHANGE_LABELS: Record<SiteChangeItem['change'], string> = {
  added: 'Nova',
  changed: 'Alterada',
  removed: 'Removida',
}

function ChangeList({
  title,
  items,
}: {
  title: string
  items: SiteChangeItem[]
}) {
  if (items.length === 0) return null
  return (
    <div className='grid gap-1.5'>
      <h3 className='font-medium text-muted-foreground text-xs'>{title}</h3>
      <ul className='grid gap-1'>
        {items.map((item) => (
          <li
            key={`${item.id}-${item.change}`}
            className='flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm'
          >
            <span className='min-w-0 truncate'>{item.name}</span>
            <span
              data-change={item.change}
              className={
                item.change === 'removed'
                  ? 'shrink-0 text-destructive text-xs'
                  : 'shrink-0 text-muted-foreground text-xs'
              }
            >
              {CHANGE_LABELS[item.change]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** pt-BR lines for the site-wide changes. */
export function siteWideChanges(changes: SiteChangesDTO): string[] {
  const lines: string[] = []
  if (changes.structure) lines.push('Ordem ou hierarquia das páginas')
  if (changes.theme) lines.push('Tema (cores, fontes, botões ou espaçamentos)')
  if (changes.settings) lines.push('Nome, SEO ou configurações do site')
  return lines
}

function Summary({ changes }: { changes: SiteChangesDTO }) {
  const wide = siteWideChanges(changes)
  if (changes.total === 0) {
    return (
      <p className='rounded-md bg-muted px-3 py-3 text-muted-foreground text-sm'>
        O site no ar já está igual ao rascunho. Não há nada novo para publicar.
      </p>
    )
  }
  return (
    <div className='grid max-h-[50vh] gap-4 overflow-y-auto pr-1'>
      <ChangeList
        title={changes.firstPublish ? 'Páginas que entram no ar' : 'Páginas'}
        items={changes.pages}
      />
      <ChangeList title='Cabeçalho e rodapé' items={changes.globals} />
      {wide.length > 0 ? (
        <div className='grid gap-1.5'>
          <h3 className='font-medium text-muted-foreground text-xs'>
            Site inteiro
          </h3>
          <ul className='grid gap-1'>
            {wide.map((line) => (
              <li key={line} className='rounded-md border px-3 py-2 text-sm'>
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/**
 * "Publicar": saves what is pending, shows what goes live (pages, header
 * and footer, theme, settings), publishes, then gives the live address.
 * Pages that fail validation are listed with a shortcut to open them.
 */
export function PublishDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { site, api, flushTheme, setSite, workspaceId, globals } =
    useSiteEditor()
  const { save } = useCanvasEditor()
  const openTarget = useOpenTarget()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>({ step: 'loading' })
  // Running A/B tests whose variants this publish changes (restarted).
  const impact = useSiteExperimentImpact(
    workspaceId,
    site.id,
    open && phase.step === 'review',
  )
  const restarts = impact.data?.experiments.length ?? 0

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhase({ step: 'loading' })
    void (async () => {
      const [savedDoc, savedTheme] = await Promise.all([save(), flushTheme()])
      if (cancelled) return
      if (!savedDoc || !savedTheme) {
        setPhase({
          step: 'error',
          message:
            'Não foi possível salvar as últimas alterações. Tente de novo antes de publicar.',
        })
        return
      }
      try {
        const changes = await api.changes(site.id)
        if (!cancelled) setPhase({ step: 'review', changes })
      } catch (error) {
        if (!cancelled) {
          setPhase({
            step: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Não foi possível carregar o resumo',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, api, site.id, save, flushTheme])

  async function publish(changes: SiteChangesDTO) {
    setPhase({ step: 'publishing', changes })
    try {
      const result = await api.publishDetailed(site.id)
      if (!result.ok) {
        setPhase({
          step: 'invalid',
          message: result.message,
          problems: result.problems,
        })
        return
      }
      setSite(result.site)
      void queryClient.invalidateQueries({
        queryKey: crmSitesKeys.versions(workspaceId, site.id),
      })
      void queryClient.invalidateQueries({
        queryKey: crmSitesKeys.list(workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: siteExperimentKeys.list(workspaceId, site.id),
      })
      setPhase({
        step: 'done',
        url: result.site.url,
        version: result.version.number,
      })
    } catch (error) {
      notify.error(error, 'Não foi possível publicar o site')
      setPhase({ step: 'review', changes })
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      notify.success('Endereço copiado.')
    } catch {
      notify.error('Não foi possível copiar o endereço.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='publish-dialog'>
        {phase.step === 'done' ? (
          <>
            <DialogHeader>
              <span className='mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary'>
                <SteelIcon icon={CheckmarkCircle02Icon} className='size-5' />
              </span>
              <DialogTitle>Seu site está no ar</DialogTitle>
              <DialogDescription>
                Versão {phase.version} publicada. Quem acessar o endereço abaixo
                já vê as mudanças.
              </DialogDescription>
            </DialogHeader>
            <div className='flex items-center gap-2'>
              <Input
                readOnly
                value={phase.url}
                aria-label='Endereço do site'
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant='outline'
                size='icon'
                aria-label='Copiar endereço'
                onClick={() => void copy(phase.url)}
              >
                <SteelIcon icon={Copy01Icon} />
              </Button>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => onOpenChange(false)}>
                Continuar editando
              </Button>
              <Button
                nativeButton={false}
                render={
                  <a
                    href={phase.url}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                <SteelIcon icon={LinkSquare02Icon} data-icon='inline-start' />
                Abrir o site
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Publicar “{site.name}”</DialogTitle>
              <DialogDescription>
                {phase.step === 'review' && phase.changes.firstPublish
                  ? `Primeira publicação: o site vai ao ar em ${site.url}.`
                  : 'Confira o que muda no site no ar antes de publicar.'}
              </DialogDescription>
            </DialogHeader>

            {phase.step === 'loading' ? (
              <p
                role='status'
                className='flex items-center gap-2 py-6 text-muted-foreground text-sm'
              >
                <SteelIcon
                  icon={Loading03Icon}
                  className='size-4 animate-spin'
                />
                Salvando e comparando com o site no ar…
              </p>
            ) : null}

            {phase.step === 'review' || phase.step === 'publishing' ? (
              <Summary changes={phase.changes} />
            ) : null}

            {phase.step === 'review' || phase.step === 'publishing' ? (
              <ExperimentPublishNotice impact={impact.data} />
            ) : null}

            {phase.step === 'error' ? (
              <p
                role='alert'
                className='flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-3 text-destructive text-sm'
              >
                <SteelIcon icon={AlertCircleIcon} className='mt-0.5 size-4' />
                {phase.message}
              </p>
            ) : null}

            {phase.step === 'invalid' ? (
              <div className='grid gap-3' role='alert'>
                <p className='text-destructive text-sm'>{phase.message}</p>
                <ul className='grid max-h-[40vh] gap-2 overflow-y-auto'>
                  {phase.problems.map((problem) => (
                    <li
                      key={problem.id}
                      className='grid gap-1 rounded-md border px-3 py-2 text-sm'
                    >
                      <div className='flex items-center justify-between gap-2'>
                        <span className='font-medium'>{problem.name}</span>
                        <Button
                          size='xs'
                          variant='outline'
                          onClick={async () => {
                            onOpenChange(false)
                            await openTarget({
                              kind: globals.some(
                                (global) => global.id === problem.id,
                              )
                                ? 'global'
                                : 'page',
                              id: problem.id,
                            })
                          }}
                        >
                          Abrir
                        </Button>
                      </div>
                      <ul className='list-disc pl-4 text-muted-foreground text-xs'>
                        {problem.problems.slice(0, 3).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <DialogFooter>
              <Button variant='outline' onClick={() => onOpenChange(false)}>
                {phase.step === 'review' && phase.changes.total === 0
                  ? 'Fechar'
                  : 'Cancelar'}
              </Button>
              {phase.step === 'review' || phase.step === 'publishing' ? (
                <Button
                  onClick={() => void publish(phase.changes)}
                  disabled={
                    phase.step === 'publishing' ||
                    (phase.changes.total === 0 && !phase.changes.firstPublish)
                  }
                  data-testid='publish-confirm'
                >
                  {phase.step === 'publishing'
                    ? 'Publicando…'
                    : restarts > 0
                      ? 'Publicar e reiniciar testes'
                      : 'Publicar agora'}
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

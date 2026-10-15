'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import {
  crmSitesApi,
  crmSitesKeys,
  useSiteForms,
} from '@/src/hooks/use-crm-sites'
import { clickableNodes } from '@/src/lib/sites/experiments'
import type { UpdateSiteExperimentDTO } from '@/src/schemas/site-experiment.schema'
import type { SitePageSummaryDTO } from '@/types/site'
import type {
  SiteExperimentDTO,
  SiteExperimentGoalDTO,
  SiteExperimentVariantDTO,
} from '@/types/site-experiment'
import { endDayOf, endsAtOf, startDayOf, startsAtOf } from './format'

type GoalType = SiteExperimentGoalDTO['type']

const GOAL_TYPES: Array<{ value: GoalType; label: string }> = [
  { value: 'FORM', label: 'Envio de formulário' },
  { value: 'CLICK', label: 'Clique em um botão ou link' },
  { value: 'PAGE', label: 'Chegar a uma página' },
]

const ANY_FORM = '__any'

/**
 * "Configurar teste": name, traffic split, goal and schedule. Changing the
 * variants or the goal of a test that is on the air asks to restart it
 * (`SITE_EXPERIMENT_RUNNING`), so two setups never mix in one result.
 */
export function ExperimentSettingsDialog({
  open,
  onOpenChange,
  workspaceId,
  siteId,
  timezone,
  experiment,
  pages,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  siteId: string
  timezone: string
  experiment: SiteExperimentDTO
  pages: SitePageSummaryDTO[]
  onSave: (dto: UpdateSiteExperimentDTO) => Promise<SiteExperimentDTO>
}) {
  const id = useId()
  const forms = useSiteForms(workspaceId)
  const testedPage = useQuery({
    queryKey: crmSitesKeys.page(workspaceId, siteId, experiment.pageId),
    queryFn: () => crmSitesApi(workspaceId).page(siteId, experiment.pageId),
    enabled: open,
  })
  const [name, setName] = useState(experiment.name)
  const [variants, setVariants] = useState<SiteExperimentVariantDTO[]>(
    experiment.variants,
  )
  const [goal, setGoal] = useState<SiteExperimentGoalDTO>(experiment.goal)
  const [startDay, setStartDay] = useState('')
  const [endDay, setEndDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(experiment.name)
    setVariants(experiment.variants)
    setGoal(experiment.goal)
    setStartDay(startDayOf(experiment.startsAt, timezone))
    setEndDay(experiment.endsAt ? endDayOf(experiment.endsAt, timezone) : '')
  }, [open, experiment, timezone])

  const clickables = useMemo(
    () => (testedPage.data ? clickableNodes(testedPage.data.document) : []),
    [testedPage.data],
  )
  const goalPages = pages.filter(
    (page) =>
      page.id !== experiment.pageId &&
      !experiment.variants.some((variant) => variant.pageId === page.id),
  )
  const publishedForms = (forms.data ?? []).filter(
    (form) => form.status === 'PUBLISHED',
  )
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0)
  const goalReady =
    goal.type === 'FORM' ||
    (goal.type === 'CLICK' && goal.nodeId) ||
    (goal.type === 'PAGE' && goal.pageId)
  const scheduleOk = !startDay || !endDay || endDay >= startDay
  const valid =
    name.trim().length > 0 &&
    total === 100 &&
    variants.every((variant) => variant.name.trim() && variant.weight >= 1) &&
    Boolean(goalReady) &&
    scheduleOk

  function setWeight(index: number, value: string) {
    const weight = Math.max(0, Math.min(99, Math.round(Number(value) || 0)))
    setVariants((current) =>
      current.map((variant, i) =>
        i === index ? { ...variant, weight } : variant,
      ),
    )
  }

  function setVariantName(index: number, value: string) {
    setVariants((current) =>
      current.map((variant, i) =>
        i === index ? { ...variant, name: value } : variant,
      ),
    )
  }

  function changeGoalType(type: GoalType) {
    if (type === goal.type) return
    if (type === 'FORM') setGoal({ type: 'FORM' })
    else if (type === 'CLICK') setGoal({ type: 'CLICK', nodeId: '' })
    else setGoal({ type: 'PAGE', pageId: '' })
  }

  function payload(restart: boolean): UpdateSiteExperimentDTO {
    return {
      name: name.trim(),
      variants: variants.map((variant) => ({
        ...variant,
        name: variant.name.trim(),
      })),
      goal,
      startsAt: startsAtOf(startDay, timezone),
      endsAt: endsAtOf(endDay, timezone),
      ...(restart ? { restart: true } : {}),
    }
  }

  async function save(restart = false) {
    setBusy(true)
    try {
      await onSave(payload(restart))
      notify.success(restart ? 'Teste reiniciado.' : 'Teste salvo.')
      setConfirmRestart(false)
      onOpenChange(false)
    } catch (error) {
      if (isApiErrorCode(error, 'SITE_EXPERIMENT_RUNNING')) {
        setConfirmRestart(true)
      } else {
        notify.error(error, 'Não foi possível salvar o teste')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className='sm:max-w-lg'
          data-testid='experiment-settings'
        >
          <DialogHeader>
            <DialogTitle>Configurar teste</DialogTitle>
            <DialogDescription>
              Divisão do tráfego, meta e agenda do teste A/B.
            </DialogDescription>
          </DialogHeader>
          <form
            className='grid max-h-[65vh] gap-4 overflow-y-auto pr-1'
            onSubmit={(event) => {
              event.preventDefault()
              if (valid) void save()
            }}
          >
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-name`}>Nome</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <fieldset className='grid gap-2'>
              <legend className='mb-1.5 font-medium text-sm'>
                Divisão do tráfego
              </legend>
              {variants.map((variant, index) => (
                <div
                  key={variant.key}
                  className='grid grid-cols-[1.5rem_1fr_5.5rem] items-center gap-2'
                >
                  <span className='flex size-6 items-center justify-center rounded bg-muted font-semibold text-xs'>
                    {variant.key}
                  </span>
                  <Input
                    aria-label={`Nome da variante ${variant.key}`}
                    value={variant.name}
                    maxLength={60}
                    onChange={(event) =>
                      setVariantName(index, event.target.value)
                    }
                  />
                  <div className='relative'>
                    <Input
                      aria-label={`Tráfego da variante ${variant.key} (%)`}
                      type='number'
                      inputMode='numeric'
                      min={1}
                      max={99}
                      value={variant.weight}
                      className='pr-7 text-right tabular-nums'
                      onChange={(event) => setWeight(index, event.target.value)}
                    />
                    <span className='pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground text-xs'>
                      %
                    </span>
                  </div>
                </div>
              ))}
              <p
                className={
                  total === 100
                    ? 'text-muted-foreground text-xs'
                    : 'text-destructive text-xs'
                }
                role={total === 100 ? undefined : 'alert'}
              >
                Total: {total}%{total === 100 ? '' : ' — precisa somar 100%'}
              </p>
            </fieldset>

            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-goal`}>
                Meta (o que conta como conversão)
              </Label>
              <Select
                value={goal.type}
                onValueChange={(value) => changeGoalType(value as GoalType)}
              >
                <SelectTrigger id={`${id}-goal`} className='w-full'>
                  <SelectValue>
                    {(value: string) =>
                      GOAL_TYPES.find((item) => item.value === value)?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {GOAL_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {goal.type === 'FORM' ? (
                <Select
                  value={goal.formToken ?? ANY_FORM}
                  onValueChange={(value) =>
                    setGoal(
                      value === ANY_FORM || typeof value !== 'string'
                        ? { type: 'FORM' }
                        : { type: 'FORM', formToken: value },
                    )
                  }
                >
                  <SelectTrigger
                    aria-label='Formulário da meta'
                    className='w-full'
                  >
                    <SelectValue>
                      {(value: string) =>
                        value === ANY_FORM
                          ? 'Qualquer formulário do site'
                          : (publishedForms.find(
                              (form) => form.publicToken === value,
                            )?.name ?? 'Formulário escolhido')
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_FORM}>
                      Qualquer formulário do site
                    </SelectItem>
                    {publishedForms.map((form) => (
                      <SelectItem key={form.id} value={form.publicToken}>
                        {form.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {goal.type === 'CLICK' ? (
                clickables.length === 0 ? (
                  <p className='text-muted-foreground text-xs'>
                    {testedPage.isLoading
                      ? 'Carregando os elementos da página…'
                      : 'A página testada não tem botões ou links.'}
                  </p>
                ) : (
                  <Select
                    value={goal.nodeId || null}
                    onValueChange={(value) => {
                      const item = clickables.find((node) => node.id === value)
                      if (item) {
                        setGoal({
                          type: 'CLICK',
                          nodeId: item.id,
                          label: item.label,
                        })
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label='Botão ou link da meta'
                      className='w-full'
                    >
                      <SelectValue placeholder='Escolha o botão ou link'>
                        {(value: string | null) =>
                          clickables.find((node) => node.id === value)?.label ??
                          'Escolha o botão ou link'
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {clickables.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {node.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              ) : null}
              {goal.type === 'PAGE' ? (
                <Select
                  value={goal.pageId || null}
                  onValueChange={(value) =>
                    typeof value === 'string' &&
                    setGoal({ type: 'PAGE', pageId: value })
                  }
                >
                  <SelectTrigger aria-label='Página da meta' className='w-full'>
                    <SelectValue placeholder='Escolha a página'>
                      {(value: string | null) =>
                        goalPages.find((page) => page.id === value)?.title ??
                        'Escolha a página'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {goalPages.map((page) => (
                      <SelectItem key={page.id} value={page.id}>
                        {page.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <fieldset className='grid gap-2'>
              <legend className='mb-1.5 font-medium text-sm'>Agenda</legend>
              <div className='grid gap-2 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label
                    htmlFor={`${id}-start`}
                    className='font-normal text-xs'
                  >
                    Começa em
                  </Label>
                  <Input
                    id={`${id}-start`}
                    type='date'
                    value={startDay}
                    onChange={(event) => setStartDay(event.target.value)}
                  />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor={`${id}-end`} className='font-normal text-xs'>
                    Termina em (inclusive)
                  </Label>
                  <Input
                    id={`${id}-end`}
                    type='date'
                    value={endDay}
                    min={startDay || undefined}
                    onChange={(event) => setEndDay(event.target.value)}
                  />
                </div>
              </div>
              <p
                className={
                  scheduleOk
                    ? 'text-muted-foreground text-xs'
                    : 'text-destructive text-xs'
                }
              >
                {scheduleOk
                  ? `Em branco: começa ao iniciar e vai até você encerrar. Datas no fuso do site (${timezone}).`
                  : 'O fim precisa ser no mesmo dia ou depois do início.'}
              </p>
            </fieldset>

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type='submit' disabled={!valid || busy}>
                {busy ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reiniciar o teste?</AlertDialogTitle>
            <AlertDialogDescription>
              Este teste está no ar. Mudar as variantes, a divisão do tráfego ou
              a meta recomeça a contagem numa nova rodada, para não misturar
              resultados de configurações diferentes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save(true)} disabled={busy}>
              Salvar e reiniciar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

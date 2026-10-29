'use client'

import {
  Add01Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  Mail01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCrmNewsletterWelcomeSteps,
  useDeleteCrmNewsletterWelcomeStep,
  useReorderCrmNewsletterWelcomeSteps,
  useUpdateCrmNewsletterWelcomeStep,
} from '@/src/hooks/use-crm-newsletter-automation'
import {
  CRM_NEWSLETTER_WELCOME_MAX_STEPS,
  type CrmNewsletterWelcomeStepDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { formatCount, formatRate } from '../issues/issue-format'
import { delayLabel, welcomeStepEditorHref } from './automation-format'
import { NewWelcomeStepDialog } from './new-welcome-step-dialog'

export type NewsletterWelcomeTabProps = {
  workspaceId: string
  workspaceSlug: string
  newsletterId: string
  senderVerified: boolean
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex min-w-0 flex-col'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <span className='font-medium text-sm tabular-nums'>{value}</span>
    </div>
  )
}

function StepCard({
  step,
  index,
  count,
  editorHref,
  busy,
  onToggle,
  onMove,
  onDelete,
}: {
  step: CrmNewsletterWelcomeStepDTO
  index: number
  count: number
  editorHref: string
  busy: boolean
  onToggle: (enabled: boolean) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}) {
  const { stats } = step
  return (
    <li
      className='flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center'
      data-testid='welcome-step'
    >
      <div className='flex min-w-0 flex-1 items-start gap-3'>
        <span
          className='flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-sm tabular-nums'
          aria-hidden
        >
          {index + 1}
        </span>
        <div className='min-w-0'>
          <Link
            href={editorHref}
            className='block truncate font-medium hover:underline'
          >
            {step.subject}
          </Link>
          <p className='truncate text-muted-foreground text-xs'>
            {delayLabel(step.delayValue, step.delayUnit)}
          </p>
        </div>
      </div>
      <div className='grid grid-cols-3 gap-4 sm:w-64'>
        <Stat label='Enviados' value={formatCount(stats.sent)} />
        <Stat label='Abertura' value={formatRate(stats.opened, stats.sent)} />
        <Stat label='Clique' value={formatRate(stats.clicked, stats.sent)} />
      </div>
      <div className='flex items-center justify-between gap-2 sm:justify-end'>
        <div className='flex items-center gap-2 text-sm'>
          <Switch
            id={`welcome-step-${step.id}`}
            checked={step.enabled}
            disabled={busy}
            onCheckedChange={(checked) => onToggle(checked)}
            aria-label={`Etapa ${index + 1} ligada`}
          />
          <label
            htmlFor={`welcome-step-${step.id}`}
            className='text-muted-foreground sm:sr-only'
          >
            {step.enabled ? 'Ligada' : 'Desligada'}
          </label>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Ações da etapa ${step.subject}`}
            className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          >
            <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-52'>
            <DropdownMenuItem render={<Link href={editorHref} />}>
              <SteelIcon icon={PencilEdit02Icon} />
              Abrir editor
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || index === 0}
              onClick={() => onMove(-1)}
            >
              <SteelIcon icon={ArrowUp01Icon} />
              Mover para cima
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || index === count - 1}
              onClick={() => onMove(1)}
            >
              <SteelIcon icon={ArrowDown01Icon} />
              Mover para baixo
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant='destructive' onClick={onDelete}>
              <SteelIcon icon={Delete02Icon} />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

/**
 * "Boas-vindas" tab of a newsletter (newsletter2, nl2-automation): the
 * ordered welcome series, each step with its delay after the confirmation,
 * an on/off switch and sent / open / click numbers; the content is edited
 * in the full-screen Steel Canvas editor.
 */
export function NewsletterWelcomeTab({
  workspaceId,
  workspaceSlug,
  newsletterId,
  senderVerified,
}: NewsletterWelcomeTabProps) {
  const steps = useCrmNewsletterWelcomeSteps(workspaceId, newsletterId)
  const update = useUpdateCrmNewsletterWelcomeStep(workspaceId, newsletterId)
  const reorder = useReorderCrmNewsletterWelcomeSteps(workspaceId, newsletterId)
  const remove = useDeleteCrmNewsletterWelcomeStep(workspaceId, newsletterId)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<CrmNewsletterWelcomeStepDTO | null>(
    null,
  )

  const items = steps.data ?? []
  const full = items.length >= CRM_NEWSLETTER_WELCOME_MAX_STEPS
  const busy = update.isPending || reorder.isPending

  function toggle(step: CrmNewsletterWelcomeStepDTO, enabled: boolean) {
    update.mutate(
      { stepId: step.id, enabled },
      {
        onSuccess: () =>
          notify.success(enabled ? 'Etapa ligada' : 'Etapa desligada'),
        onError: (error) => notify.error(error),
      },
    )
  }

  function move(index: number, direction: -1 | 1) {
    const ids = items.map((step) => step.id)
    const target = index + direction
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorder.mutate(ids, { onError: (error) => notify.error(error) })
  }

  function confirmDelete() {
    if (!deleting) return
    remove.mutate(deleting.id, {
      onSuccess: () => {
        notify.success('Etapa excluída')
        setDeleting(null)
      },
      onError: (error) => notify.error(error),
    })
  }

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      {!senderVerified ? (
        <Alert>
          <SteelIcon icon={Alert02Icon} />
          <AlertTitle>O remetente ainda não está verificado</AlertTitle>
          <AlertDescription>
            A série fica guardada, mas os e-mails só saem depois que o domínio
            do remetente estiver verificado.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h2 className='font-medium text-base'>Série de boas-vindas</h2>
          <p className='text-muted-foreground text-sm'>
            E-mails automáticos para cada novo assinante, contados a partir da
            confirmação da inscrição. Assinantes importados não recebem.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          disabled={full || steps.isLoading}
          title={
            full
              ? `A série aceita no máximo ${CRM_NEWSLETTER_WELCOME_MAX_STEPS} etapas`
              : undefined
          }
          data-testid='new-welcome-step'
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Nova etapa
        </Button>
      </div>

      {steps.isLoading ? (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-20 w-full' />
        </div>
      ) : steps.isError ? (
        <p className='rounded-xl border p-6 text-center text-muted-foreground text-sm'>
          Não foi possível carregar a série. Tente de novo em instantes.
        </p>
      ) : items.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center'>
          <SteelIcon
            icon={Mail01Icon}
            className='size-6 text-muted-foreground'
          />
          <div className='max-w-md'>
            <p className='font-medium'>Nenhuma etapa ainda</p>
            <p className='text-muted-foreground text-sm'>
              Comece com um e-mail de boas-vindas logo após a confirmação e
              acrescente outros nos dias seguintes, como uma apresentação dos
              melhores conteúdos.
            </p>
          </div>
          <Button variant='outline' onClick={() => setCreating(true)}>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Criar a primeira etapa
          </Button>
        </div>
      ) : (
        <ol className='flex flex-col gap-3'>
          {items.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              index={index}
              count={items.length}
              editorHref={welcomeStepEditorHref(
                workspaceSlug,
                newsletterId,
                step.id,
              )}
              busy={busy}
              onToggle={(enabled) => toggle(step, enabled)}
              onMove={(direction) => move(index, direction)}
              onDelete={() => setDeleting(step)}
            />
          ))}
        </ol>
      )}

      <NewWelcomeStepDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        newsletterId={newsletterId}
        isFirst={items.length === 0}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta etapa?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.subject} deixa de ser enviada e as estatísticas dela
              são apagadas. Para só pausar, desligue a etapa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

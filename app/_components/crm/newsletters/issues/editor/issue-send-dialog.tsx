'use client'

import {
  Alert02Icon,
  Calendar03Icon,
  MailSend01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { useEmailEditorData } from '@/app/_components/crm/email-editor/editor-data'
import { IssueAudienceSection } from '@/app/_components/crm/newsletters/segments/issue-audience-section'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { notify } from '@/lib/notify'
import {
  crmNewsletterIssueKeys,
  useCrmNewsletterIssueAction,
  useCrmNewsletterIssuePreflight,
} from '@/src/hooks/use-crm-newsletter-issues'
import {
  CRM_NEWSLETTER_MIN_SCHEDULE_MINUTES,
  type CrmNewsletterIssuePreflightDTO,
} from '@/src/schemas/crm-newsletter-issue.schema'
import {
  formatCount,
  formatIssueDateTime,
  formatUsageMonth,
  isoToSaoPauloLocal,
  issueReportHref,
  newsletterHref,
  saoPauloLocalToIso,
} from '../issue-format'
import { useIssueEditor } from './issue-editor-context'
import { saveEditorNow } from './issue-test-send-dialog'

type Mode = 'now' | 'schedule'

export const SENDER_BLOCKED_HINT =
  'O envio fica bloqueado até o domínio do remetente estar verificado em Ajustes › Domínios de e-mail.'

function Summary({ preflight }: { preflight: CrmNewsletterIssuePreflightDTO }) {
  const { usage, remaining, audience } = preflight
  return (
    <dl className='grid grid-cols-2 gap-2 text-sm'>
      <div className='rounded-lg border p-3'>
        <dt className='text-muted-foreground text-xs'>
          Assinantes que recebem
        </dt>
        <dd className='font-semibold text-xl tabular-nums'>
          {formatCount(audience)}
        </dd>
      </div>
      <div className='rounded-lg border p-3'>
        <dt className='text-muted-foreground text-xs'>
          Saldo de {formatUsageMonth(usage.month)}
        </dt>
        <dd className='font-semibold text-xl tabular-nums'>
          {remaining === null ? 'Ilimitado' : formatCount(remaining)}
        </dd>
        {usage.limit !== null ? (
          <dd className='text-muted-foreground text-xs'>
            {formatCount(usage.emailsSent)} de {formatCount(usage.limit)} usados
          </dd>
        ) : null}
      </div>
    </dl>
  )
}

function Checklist({
  preflight,
}: {
  preflight: CrmNewsletterIssuePreflightDTO
}) {
  const warnings = preflight.checklist.filter(
    (item) => item.level === 'warning',
  )
  if (preflight.blockers.length === 0 && warnings.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>Tudo certo para enviar.</p>
    )
  }
  return (
    <ul className='grid gap-1.5 text-sm'>
      {preflight.blockers.map((blocker) => (
        <li
          key={blocker.code}
          className='flex items-start gap-2 text-destructive'
        >
          <SteelIcon icon={Alert02Icon} className='mt-0.5 size-4 shrink-0' />
          <span>{blocker.message}</span>
        </li>
      ))}
      {warnings.map((item, index) => (
        <li
          key={`${item.code}-${index}`}
          className='flex items-start gap-2 text-muted-foreground'
        >
          <SteelIcon icon={Alert02Icon} className='mt-0.5 size-4 shrink-0' />
          <span>{item.message}</span>
        </li>
      ))}
    </ul>
  )
}

function SendBody({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const issue = useIssueEditor()
  const { flushMeta } = useEmailEditorData()
  const { save, store } = useCanvasEditor()
  const [ready, setReady] = useState(false)
  const preflight = useCrmNewsletterIssuePreflight(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
    ready,
  )
  const action = useCrmNewsletterIssueAction(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const [mode, setMode] = useState<Mode>(
    issue.status === 'SCHEDULED' ? 'schedule' : 'now',
  )
  const [when, setWhen] = useState(() =>
    isoToSaoPauloLocal(
      issue.scheduledAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ),
  )
  const whenId = useId()
  // nl2-segments: unsaved or invalid audience changes block the send.
  const [audienceBusy, setAudienceBusy] = useState(false)

  // Save pending edits first (once): the checks run on the saved issue.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const saved = await saveEditorNow(flushMeta, save, () =>
        Boolean(store.getState().dirty),
      )
      if (!saved) {
        notify.error('Não foi possível salvar a edição antes de enviar')
        onDone()
        return
      }
      await queryClient.invalidateQueries({
        queryKey: crmNewsletterIssueKeys.preflight(
          issue.workspaceId,
          issue.newsletterId,
          issue.issueId,
        ),
      })
      setReady(true)
    })()
  }, [flushMeta, save, store, queryClient, issue, onDone])

  const scheduledIso = mode === 'schedule' ? saoPauloLocalToIso(when) : null
  const tooSoon =
    mode === 'schedule' &&
    (!scheduledIso ||
      new Date(scheduledIso).getTime() <
        Date.now() + CRM_NEWSLETTER_MIN_SCHEDULE_MINUTES * 60_000)
  const blocked = (preflight.data?.blockers.length ?? 1) > 0 || audienceBusy

  function confirm() {
    if (blocked || tooSoon) return
    action.mutate(
      {
        action: 'send',
        ...(scheduledIso ? { scheduledAt: scheduledIso } : {}),
      },
      {
        onSuccess: (result) => {
          onDone()
          if (result.status === 'SCHEDULED') {
            notify.success(
              `Edição agendada para ${formatIssueDateTime(result.scheduledAt)}`,
            )
            router.push(newsletterHref(issue.slug, issue.newsletterId))
          } else {
            notify.success('Envio iniciado')
            router.push(
              issueReportHref(issue.slug, issue.newsletterId, issue.issueId),
            )
          }
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  function cancelSchedule() {
    action.mutate(
      { action: 'cancel' },
      {
        onSuccess: () => {
          notify.success('Agendamento cancelado: a edição voltou a rascunho')
          onDone()
          router.refresh()
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enviar edição</DialogTitle>
        <DialogDescription>
          Confira a audiência e o saldo do mês. Depois que o envio começa, a
          edição não pode mais ser alterada.
        </DialogDescription>
      </DialogHeader>
      {!preflight.data ? (
        <div className='grid gap-2' aria-busy='true'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-10 w-full' />
        </div>
      ) : (
        <div className='grid gap-4'>
          <Summary preflight={preflight.data} />
          <IssueAudienceSection
            workspaceId={issue.workspaceId}
            newsletterId={issue.newsletterId}
            issueId={issue.issueId}
            onBusyChange={setAudienceBusy}
          />
          <Checklist preflight={preflight.data} />
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as Mode)}
            className='grid gap-2'
          >
            <Label className='flex items-center gap-2 font-normal'>
              <RadioGroupItem value='now' />
              Enviar agora
            </Label>
            <Label className='flex items-center gap-2 font-normal'>
              <RadioGroupItem value='schedule' />
              Agendar
            </Label>
          </RadioGroup>
          {mode === 'schedule' ? (
            <div className='grid gap-1.5'>
              <Label htmlFor={whenId}>Data e hora (horário de Brasília)</Label>
              <Input
                id={whenId}
                type='datetime-local'
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                aria-invalid={tooSoon || undefined}
              />
              {tooSoon ? (
                <p className='text-destructive text-xs' role='alert'>
                  Agende para pelo menos {CRM_NEWSLETTER_MIN_SCHEDULE_MINUTES}{' '}
                  minutos à frente.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <DialogFooter className='gap-2'>
        {issue.status === 'SCHEDULED' ? (
          <Button
            variant='outline'
            className='sm:mr-auto'
            disabled={action.isPending}
            onClick={cancelSchedule}
          >
            Cancelar agendamento
          </Button>
        ) : null}
        <Button variant='ghost' onClick={onDone}>
          Fechar
        </Button>
        <Button
          onClick={confirm}
          disabled={!preflight.data || blocked || tooSoon || action.isPending}
          data-testid='issue-send-confirm'
        >
          <SteelIcon
            icon={mode === 'schedule' ? Calendar03Icon : MailSend01Icon}
            strokeWidth={2}
          />
          {action.isPending
            ? 'Enviando…'
            : mode === 'schedule'
              ? 'Agendar envio'
              : `Enviar para ${formatCount(preflight.data?.audience ?? 0)}`}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Top-bar "Enviar": disabled with the reason while the sender is unverified. */
export function IssueSendButton() {
  const { senderVerified, status } = useIssueEditor()
  const [open, setOpen] = useState(false)
  const label = status === 'SCHEDULED' ? 'Agendada' : 'Enviar'

  if (!senderVerified) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className='inline-flex' />}>
          <Button
            size='sm'
            disabled
            className='pointer-events-none'
            title={SENDER_BLOCKED_HINT}
          >
            <SteelIcon icon={MailSend01Icon} strokeWidth={2} />
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent className='max-w-64'>
          {SENDER_BLOCKED_HINT}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <>
      <Button size='sm' onClick={() => setOpen(true)} data-testid='issue-send'>
        <SteelIcon icon={MailSend01Icon} strokeWidth={2} />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-2xl'>
          {open ? <SendBody onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

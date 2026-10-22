'use client'

import {
  ArrowDown01Icon,
  Call02Icon,
  CallEnd01Icon,
  Delete02Icon,
  SparklesIcon,
  Task01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  type PhoneCallTaskTarget,
  phoneCallRecordingUrl,
  useCreateTaskFromCallStep,
  useDeletePhoneCallRecording,
} from '@/src/hooks/use-phone-calls'
import type {
  PhoneCallRecordDTO,
  WhatsAppPhoneCallStatusDTO,
} from '@/types/whatsapp-phone-call'

/** Calls are placed on Brazilian PABXs; times follow the PABX clock. */
const CALL_TIMEZONE = 'America/Sao_Paulo'

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: CALL_TIMEZONE,
})

const DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: CALL_TIMEZONE,
})

export const PHONE_CALL_STATUS_LABEL: Record<
  WhatsAppPhoneCallStatusDTO,
  string
> = {
  QUEUED: 'Chamando o ramal',
  DIALING: 'Chamando o contato',
  IN_PROGRESS: 'Em ligação',
  COMPLETED: 'Atendida',
  BUSY: 'Ocupado',
  NO_ANSWER: 'Não atendeu',
  CANCELED: 'Cancelada',
  EXTENSION_NO_ANSWER: 'Ramal não atendeu',
  FAILED: 'Falhou',
}

/** pt-BR text of `aiSkipReason` (machine codes from the worker). */
const SKIP_LABEL: Record<string, string> = {
  transcription_disabled: 'Transcrição desligada nas configurações.',
  ai_disabled: 'O Steel AI está desligado neste workspace.',
  no_transcription_provider: 'Transcrição indisponível no servidor.',
  ai_quota_exceeded: 'A cota de IA do mês acabou.',
  ai_provider_unavailable: 'Nenhum modelo de IA disponível.',
  empty_transcript: 'Não havia fala para transcrever.',
  no_recording: 'A gravação não está mais disponível.',
  transcription_failed: 'Não foi possível transcrever a ligação.',
  summary_failed: 'A transcrição está pronta, mas o resumo falhou.',
}

const SENTIMENT: Record<
  NonNullable<PhoneCallRecordDTO['sentiment']>,
  { label: string; variant: 'secondary' | 'outline' | 'destructive' }
> = {
  POSITIVE: { label: 'Cliente satisfeito', variant: 'secondary' },
  NEUTRAL: { label: 'Cliente neutro', variant: 'outline' },
  NEGATIVE: { label: 'Cliente insatisfeito', variant: 'destructive' },
}

export function formatCallDuration(seconds: number | null): string {
  const s = Math.max(0, Math.floor(seconds ?? 0))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function AiStatusLine({ call }: { call: PhoneCallRecordDTO }) {
  if (call.aiStatus === 'PENDING' || call.aiStatus === 'PROCESSING') {
    return (
      <p className='flex items-center gap-1.5 text-muted-foreground text-xs'>
        <SteelIcon icon={SparklesIcon} size={14} className='animate-pulse' />
        Transcrevendo e resumindo a ligação…
      </p>
    )
  }
  const reason = call.aiSkipReason ? SKIP_LABEL[call.aiSkipReason] : null
  if (call.aiStatus === 'SKIPPED' || call.aiStatus === 'FAILED' || reason) {
    return (
      <p className='text-muted-foreground text-xs'>
        {reason ?? 'A ligação não foi transcrita.'}
      </p>
    )
  }
  return null
}

function NextStep({
  step,
  workspaceId,
  call,
  taskTarget,
}: {
  step: string
  workspaceId: string
  call: PhoneCallRecordDTO
  taskTarget: PhoneCallTaskTarget | null
}) {
  const createTask = useCreateTaskFromCallStep(workspaceId)
  const [created, setCreated] = useState(false)

  async function handleCreate() {
    if (!taskTarget) return
    try {
      await createTask.mutateAsync({
        target: taskTarget,
        title: step.slice(0, 200),
        body: `Próximo passo da ligação de ${DATE_TIME.format(new Date(call.createdAt))}.`,
      })
      setCreated(true)
      notify.success('Tarefa criada')
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao criar a tarefa',
      )
    }
  }

  return (
    <li className='flex items-start justify-between gap-2'>
      <span className='min-w-0 flex-1 break-words'>{step}</span>
      {taskTarget ? (
        <Button
          variant='ghost'
          size='xs'
          className='shrink-0'
          disabled={created || createTask.isPending}
          onClick={handleCreate}
        >
          <SteelIcon icon={Task01Icon} size={14} />
          {created ? 'Criada' : 'Criar tarefa'}
        </Button>
      ) : null}
    </li>
  )
}

/**
 * One click-to-call in a timeline (conversation, ticket, CRM record): status
 * and duration, the audio player, the AI summary with sentiment and next
 * steps ("Criar tarefa"), and the transcript behind a toggle (ADR 0043).
 */
export function PhoneCallCard({
  workspaceId,
  call,
  taskTarget,
  className,
}: {
  workspaceId: string
  call: PhoneCallRecordDTO
  /** Where "Criar tarefa" creates the task; `null` hides the button. */
  taskTarget: PhoneCallTaskTarget | null
  className?: string
}) {
  const canDelete = useIsPrivileged()
  const deleteRecording = useDeletePhoneCallRecording(workspaceId)
  const answered = call.status === 'COMPLETED'
  const sentiment = call.sentiment ? SENTIMENT[call.sentiment] : null
  const inbound = call.direction === 'INBOUND'
  const parties = [call.userName, call.contactName ?? call.destination]
  const who = (inbound ? parties.reverse() : parties)
    .filter(Boolean)
    .join(' → ')

  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleDeleteRecording() {
    try {
      await deleteRecording.mutateAsync(call.id)
      setConfirmDelete(false)
      notify.success('Gravação apagada')
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao apagar a gravação',
      )
    }
  }

  return (
    <article
      className={cn(
        'flex w-full min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground text-sm',
        className,
      )}
      aria-label={`Ligação de ${DATE_TIME.format(new Date(call.createdAt))}`}
    >
      <header className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full',
            answered
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <SteelIcon icon={answered ? Call02Icon : CallEnd01Icon} size={16} />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate font-medium'>
            {inbound ? 'Ligação recebida' : 'Ligação'}
            {who ? ` · ${who}` : ''}
          </p>
          <p className='text-muted-foreground text-xs'>
            {DATE_TIME.format(new Date(call.createdAt))}
            {answered ? ` · ${formatCallDuration(call.durationSeconds)}` : ''}
          </p>
        </div>
        <Badge variant={answered ? 'secondary' : 'outline'}>
          {inbound && call.status === 'NO_ANSWER'
            ? 'Perdida'
            : PHONE_CALL_STATUS_LABEL[call.status]}
        </Badge>
      </header>

      {call.recording ? (
        <div className='flex flex-col gap-1'>
          {/* biome-ignore lint/a11y/useMediaCaption: phone call audio has no captions; the transcript below is the text alternative */}
          <audio
            controls
            preload='none'
            className='h-9 w-full'
            src={phoneCallRecordingUrl(workspaceId, call.id)}
          />
          <div className='flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs'>
            <span>
              {call.recording.expiresAt
                ? `Áudio guardado até ${DATE.format(new Date(call.recording.expiresAt))}`
                : 'Áudio guardado'}
            </span>
            {canDelete ? (
              <Button
                variant='ghost'
                size='xs'
                disabled={deleteRecording.isPending}
                onClick={() => setConfirmDelete(true)}
              >
                <SteelIcon icon={Delete02Icon} size={14} />
                Apagar áudio
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <AiStatusLine call={call} />

      {call.summary ? (
        <section className='flex flex-col gap-1.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='flex items-center gap-1 font-medium text-xs'>
              <SteelIcon
                icon={SparklesIcon}
                size={14}
                className='text-primary'
              />
              Resumo da IA
            </span>
            {sentiment ? (
              <Badge variant={sentiment.variant}>{sentiment.label}</Badge>
            ) : null}
          </div>
          <p className='whitespace-pre-line break-words'>{call.summary}</p>
        </section>
      ) : null}

      {call.nextSteps.length > 0 ? (
        <section className='flex flex-col gap-1'>
          <span className='font-medium text-xs'>Próximos passos</span>
          <ul className='flex flex-col gap-1'>
            {call.nextSteps.map((step) => (
              <NextStep
                key={step}
                step={step}
                call={call}
                workspaceId={workspaceId}
                taskTarget={taskTarget}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {call.transcript ? (
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                variant='ghost'
                size='xs'
                className='group w-fit px-1 text-muted-foreground'
              />
            }
          >
            <SteelIcon
              icon={ArrowDown01Icon}
              size={14}
              className='transition-transform group-data-[panel-open]:rotate-180'
            />
            Transcrição
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className='mt-1 max-h-72 overflow-y-auto whitespace-pre-line break-words rounded-md bg-muted p-2 text-muted-foreground text-xs'>
              {call.transcript}
            </p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o áudio da ligação</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo de áudio é apagado agora e não pode ser recuperado. A
              transcrição e o resumo continuam na ligação. A ação fica
              registrada na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRecording.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={deleteRecording.isPending}
              onClick={handleDeleteRecording}
            >
              Apagar áudio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}

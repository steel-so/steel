'use client'

import { Skeleton } from '@/components/ui/skeleton'
import {
  useDocumentEvents,
  useDocumentVersions,
} from '@/src/hooks/use-documents'
import type { DocumentEventDTO } from '@/types/document'
import { formatDocumentDateTime } from './documents-tone'

/** What happened, as the end of "<quem> …" (pt-BR, lower case). */
const EVENT_LABELS: Record<string, string> = {
  CREATED: 'criou o documento',
  SENT: 'enviou o documento',
  OPENED: 'abriu o documento',
  FORWARDED: 'abriu um link encaminhado',
  LINK_CLICKED: 'clicou em um link',
  VIDEO_PLAYED: 'assistiu a um vídeo',
  ATTACHMENT_DOWNLOADED: 'baixou um anexo',
  PDF_DOWNLOADED: 'baixou o PDF',
  FIELDS_SUBMITTED: 'enviou as respostas',
  ACCEPTED: 'aceitou o documento',
  DECLINED: 'recusou o documento',
  PAYMENT_STARTED: 'começou o pagamento',
  PAID: 'pagou',
  EXPIRED: 'O documento expirou',
  REOPENED: 'reabriu o documento',
}

/** Events with no person behind them. */
const IMPERSONAL = new Set(['EXPIRED'])

const DOT_TONE: Record<string, string> = {
  ACCEPTED: 'bg-primary',
  PAID: 'bg-primary',
  DECLINED: 'bg-destructive',
  EXPIRED: 'bg-destructive',
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The event as one pt-BR sentence: "Maria Souza abriu o documento". */
export function describeDocumentEvent(event: DocumentEventDTO): string {
  const label = EVENT_LABELS[event.type] ?? 'registrou uma atividade'
  if (IMPERSONAL.has(event.type)) return label
  const who =
    event.recipient?.name ??
    event.actor?.name ??
    text(event.data.name) ??
    'Um visitante'
  const version =
    typeof event.data.versionNumber === 'number'
      ? ` (versão ${event.data.versionNumber})`
      : ''
  const target = text(event.data.target)
  const detail =
    event.type === 'LINK_CLICKED' && target
      ? `: ${target}`
      : event.type === 'DECLINED' && text(event.data.reason)
        ? ` — “${text(event.data.reason)}”`
        : ''
  return `${who} ${label}${version}${detail}`
}

/** "Atividade": the document's events, newest first. */
export function DocumentActivity({
  workspaceId,
  documentId,
}: {
  workspaceId: string
  documentId: string
}) {
  const events = useDocumentEvents(workspaceId, documentId)
  if (events.isLoading) {
    return (
      <div className='grid gap-3' aria-busy='true'>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className='h-10 w-full' />
        ))}
      </div>
    )
  }
  if (events.error) {
    return (
      <p className='text-muted-foreground text-sm'>
        Não foi possível carregar a atividade.
      </p>
    )
  }
  const items = [...(events.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  if (items.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>Nenhuma atividade ainda.</p>
    )
  }
  return (
    <ol aria-label='Atividade' className='relative grid gap-4 border-l pl-5'>
      {items.map((event) => (
        <li key={event.id} data-testid='document-event' className='relative'>
          <span
            aria-hidden='true'
            className={`-left-[25px] absolute top-1.5 size-2.5 rounded-full ring-4 ring-background ${DOT_TONE[event.type] ?? 'bg-muted-foreground/60'}`}
          />
          <p className='text-sm'>{describeDocumentEvent(event)}</p>
          <time
            dateTime={event.createdAt}
            className='text-muted-foreground text-xs'
          >
            {formatDocumentDateTime(event.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  )
}

/** "Versões": every sent version, newest first. */
export function DocumentVersions({
  workspaceId,
  documentId,
  currentVersionId,
}: {
  workspaceId: string
  documentId: string
  currentVersionId: string | null
}) {
  const versions = useDocumentVersions(workspaceId, documentId)
  if (versions.isLoading) {
    return (
      <div className='grid gap-2' aria-busy='true'>
        {[0, 1].map((key) => (
          <Skeleton key={key} className='h-12 w-full' />
        ))}
      </div>
    )
  }
  if (versions.error) {
    return (
      <p className='text-muted-foreground text-sm'>
        Não foi possível carregar as versões.
      </p>
    )
  }
  const items = [...(versions.data ?? [])].sort((a, b) => b.number - a.number)
  if (items.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        Nenhuma versão ainda. Cada envio congela uma versão do documento.
      </p>
    )
  }
  return (
    <ul aria-label='Versões' className='grid gap-2'>
      {items.map((version) => (
        <li
          key={version.id}
          data-testid='document-version'
          className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3'
        >
          <span className='font-medium text-sm'>Versão {version.number}</span>
          {version.id === currentVersionId ? (
            <span className='rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary'>
              Atual
            </span>
          ) : null}
          <span className='text-muted-foreground text-xs'>
            {formatDocumentDateTime(version.createdAt)}
            {version.createdBy ? ` · ${version.createdBy.name}` : ''}
          </span>
          <code
            title={`SHA-256 ${version.sha256}`}
            className='ml-auto truncate text-[11px] text-muted-foreground'
          >
            {version.sha256.slice(0, 12)}
          </code>
        </li>
      ))}
    </ul>
  )
}

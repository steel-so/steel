import { cn } from '@/lib/utils'
import type {
  DocumentKindDTO,
  DocumentStatusDTO,
} from '@/src/schemas/document.schema'
import type { DocumentRecipientDTO } from '@/types/document'
import {
  DOCUMENT_STATUS_TONE,
  kindLabel,
  RECIPIENT_STATUS_LABELS,
  RECIPIENT_STATUS_TONE,
  statusLabel,
} from './documents-tone'

const PILL =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-[11px]'

/** "Proposta", "Contrato"… */
export function DocumentKindChip({
  kind,
  className,
}: {
  kind: DocumentKindDTO
  className?: string
}) {
  return (
    <span
      data-kind={kind}
      className={cn(PILL, 'border-border bg-background', className)}
    >
      {kindLabel(kind)}
    </span>
  )
}

/** "Rascunho", "Enviado", "Aceito"… */
export function DocumentStatusChip({
  status,
  className,
}: {
  status: DocumentStatusDTO
  className?: string
}) {
  return (
    <span
      data-status={status}
      className={cn(PILL, DOCUMENT_STATUS_TONE[status], className)}
    >
      <span aria-hidden='true' className='size-1.5 rounded-full bg-current' />
      {statusLabel(status)}
    </span>
  )
}

/** "Não abriu", "Abriu", "Aceitou", "Recusou". */
export function RecipientStatusChip({
  status,
  className,
}: {
  status: DocumentRecipientDTO['status']
  className?: string
}) {
  return (
    <span
      data-status={status}
      className={cn(PILL, RECIPIENT_STATUS_TONE[status], className)}
    >
      {RECIPIENT_STATUS_LABELS[status]}
    </span>
  )
}

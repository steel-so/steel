'use client'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  isQualityBlockReason,
  QUALITY_BLOCK_PREFIX,
} from '@/src/lib/whatsapp/quality-block'

/**
 * Why a bulk WhatsApp send (broadcast, CRM campaign, newsletter) is on hold:
 * the number or template quality gate stopped it. Renders nothing for any
 * other reason. Same alert as the AI campaign notice.
 */
export function QualityBlockNotice({
  reason,
  className,
}: {
  reason: string | null | undefined
  className?: string
}) {
  if (!reason || !isQualityBlockReason(reason)) return null
  const body = reason.slice(QUALITY_BLOCK_PREFIX.length).trim()
  return (
    <Alert variant='destructive' className={className}>
      <AlertTitle>Envios bloqueados pela qualidade do WhatsApp</AlertTitle>
      <AlertDescription>
        {body.charAt(0).toUpperCase() + body.slice(1)}
      </AlertDescription>
    </Alert>
  )
}

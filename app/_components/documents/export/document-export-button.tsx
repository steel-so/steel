'use client'

import { Loading03Icon, Pdf01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { useDocumentPdfExport } from '@/src/hooks/use-document-exports'

/**
 * "Exportar PDF" (owned by the documents PDF slice): asks the worker for a
 * PDF, waits for it and downloads it.
 */
export interface DocumentExportButtonProps {
  workspaceId: string
  documentId: string
  /** Without a sent version the draft is exported. */
  hasVersion: boolean
  variant?: 'default' | 'outline' | 'ghost'
}

export function DocumentExportButton({
  workspaceId,
  documentId,
  hasVersion,
  variant = 'outline',
}: DocumentExportButtonProps) {
  const { exportPdf, isBusy } = useDocumentPdfExport(workspaceId, documentId)
  const label = isBusy ? 'Gerando PDF…' : 'Exportar PDF'

  return (
    <Button
      type='button'
      variant={variant}
      disabled={isBusy}
      aria-busy={isBusy}
      title={
        hasVersion
          ? 'Baixar a versão enviada em PDF'
          : 'Baixar o rascunho em PDF'
      }
      onClick={() => void exportPdf({ draft: !hasVersion })}
    >
      <SteelIcon
        icon={isBusy ? Loading03Icon : Pdf01Icon}
        strokeWidth={2}
        className={isBusy ? 'animate-spin' : undefined}
        aria-hidden
      />
      <span aria-live='polite'>{label}</span>
    </Button>
  )
}

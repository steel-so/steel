'use client'

import { useMemo, useState } from 'react'
import {
  DeviceSwitcher,
  type PreviewDevice,
} from '@/app/_components/canvas/preview/device-switcher'
import {
  type PreviewTheme,
  ThemeSwitcher,
} from '@/app/_components/canvas/preview/theme-switcher'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  DOCUMENT_VARIABLES,
  type DocumentRuntime,
  type DocumentVariableValues,
  DocumentView,
} from '@/src/lib/canvas-document'
import { DocumentRuntimeProvider } from '@/src/lib/canvas-document/runtime-context'
import type {
  DocumentFieldValuesDTO,
  DocumentPricingSelectionDTO,
  DocumentSettingsDTO,
} from '@/src/schemas/document.schema'

/** Merge tags with the samples the editor shows. */
export const SAMPLE_VARIABLES = Object.fromEntries(
  DOCUMENT_VARIABLES.map((variable) => [variable.key, variable.sample]),
) as DocumentVariableValues

const DEVICES: readonly PreviewDevice[] = ['base', 'mobile']

const PREVIEW_MESSAGE =
  'Na pré-visualização nada é enviado. Envie o documento para testar o aceite.'

/**
 * Runtime of the preview: fields and the pricing selection work locally;
 * accept, decline, submit and download only explain they are disabled.
 */
export function usePreviewRuntime(canAccept = true): DocumentRuntime {
  const [fieldValues, setFieldValues] = useState<DocumentFieldValuesDTO>({})
  const [selection, setPicked] = useState<DocumentPricingSelectionDTO>({})
  return useMemo<DocumentRuntime>(
    () => ({
      versionId: 'preview',
      status: 'open',
      canAccept,
      canDownload: false,
      fieldValues,
      fieldErrors: {},
      selection,
      setFieldValue: (fieldId, value) =>
        setFieldValues((current) => ({ ...current, [fieldId]: value })),
      setSelection: (itemId, value) =>
        setPicked((current) => ({ ...current, [itemId]: value })),
      accept: async () => ({ ok: false, message: PREVIEW_MESSAGE }),
      decline: async () => ({ ok: false, message: PREVIEW_MESSAGE }),
      submitFields: async () => ({ ok: false, message: PREVIEW_MESSAGE }),
      downloadPdf: async () => ({ ok: false, message: PREVIEW_MESSAGE }),
    }),
    [canAccept, fieldValues, selection],
  )
}

function PreviewBody({
  content,
  theme,
  settings,
  validUntil,
}: {
  content: CanvasDocument
  theme: Record<string, unknown>
  settings: DocumentSettingsDTO
  validUntil: string | null
}) {
  const runtime = usePreviewRuntime()
  const context = useMemo(
    () => ({
      mode: 'public' as const,
      settings,
      variables: SAMPLE_VARIABLES,
      validUntil,
    }),
    [settings, validUntil],
  )
  return (
    <DocumentRuntimeProvider runtime={runtime}>
      <DocumentView content={content} theme={theme} context={context} />
    </DocumentRuntimeProvider>
  )
}

/**
 * "Pré-visualizar": the draft as the reader sees it (desktop or phone
 * width), with sample values in the merge tags. Fields and the pricing
 * table respond; accepting is only possible on the sent link.
 */
export function DocumentPreviewDialog({
  open,
  onOpenChange,
  content,
  theme,
  settings,
  validUntil,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  content: CanvasDocument | null
  theme: Record<string, unknown>
  settings: DocumentSettingsDTO
  validUntil: string | null
  title: string
}) {
  const [device, setDevice] = useState<PreviewDevice>('base')
  const [theme, setTheme] = useState<PreviewTheme>('light')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl'>
        <div className='flex shrink-0 items-center gap-3 border-b py-2 pr-14 pl-4'>
          <div className='min-w-0 flex-1'>
            <DialogTitle className='truncate'>{title}</DialogTitle>
            <DialogDescription className='truncate text-xs'>
              Pré-visualização com dados de exemplo
            </DialogDescription>
          </div>
          <DeviceSwitcher
            value={device}
            onChange={setDevice}
            devices={DEVICES}
          />
          <ThemeSwitcher value={theme} onChange={setTheme} />
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto bg-muted/40'>
          <div
            data-testid='document-preview'
            data-theme={theme === 'dark' ? 'dark' : undefined}
            style={{ colorScheme: theme }}
            className={cn(
              'mx-auto min-h-full bg-background text-foreground',
              theme === 'dark' && 'dark',
              device === 'mobile' ? 'max-w-[390px] border-x' : 'w-full',
            )}
          >
            {content ? (
              <PreviewBody
                content={content}
                theme={theme}
                settings={settings}
                validUntil={validUntil}
              />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

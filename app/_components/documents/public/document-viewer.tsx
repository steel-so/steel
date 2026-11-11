'use client'

import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Download01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  type DocumentRenderContext,
  type DocumentRuntime,
  DocumentView,
  documentSections,
  validateDocumentContent,
} from '@/src/lib/canvas-document'
import { DocumentRuntimeProvider } from '@/src/lib/canvas-document/runtime-context'
import { startDocumentTracker } from '@/src/lib/canvas-document/tracker'
import type { DocumentPublicDTO } from '@/types/document'
import { formatDocumentDate } from '../documents-tone'
import { DocumentToc } from './document-toc'
import { IdentificationGate } from './identification-gate'
import { type PublicReader, usePublicDocumentRuntime } from './public-runtime'

/**
 * Client side of the public link `/d/<token>` (owned by the documents UI
 * slice): runtime provider (accept, decline, fields, pricing selection,
 * download), the tracker and `DocumentView`.
 * The page (`app/(public)/d/[token]/page.tsx`) renders it.
 */
export interface DocumentViewerProps {
  data: DocumentPublicDTO
}

const READER_KEY = (token: string) => `steel.document.reader.${token}`

function readStoredReader(token: string): PublicReader | null {
  try {
    const raw = window.localStorage.getItem(READER_KEY(token))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PublicReader>
    return typeof parsed.name === 'string' && typeof parsed.email === 'string'
      ? { name: parsed.name, email: parsed.email }
      : null
  } catch {
    return null
  }
}

function storeReader(token: string, reader: PublicReader) {
  try {
    window.localStorage.setItem(READER_KEY(token), JSON.stringify(reader))
  } catch {
    // Storage blocked: the gate shows again on the next visit.
  }
}

function Unavailable({ message }: { message: string }) {
  return (
    <main className='flex min-h-dvh flex-col items-center justify-center gap-2 px-6 text-center'>
      <h1 className='font-semibold text-lg'>Documento indisponível</h1>
      <p className='max-w-md text-muted-foreground text-sm'>{message}</p>
    </main>
  )
}

function StatusBanner({
  runtime,
  validUntil,
}: {
  runtime: DocumentRuntime
  validUntil: string | null
}) {
  if (runtime.status === 'accepted') {
    return (
      <div
        role='status'
        data-testid='document-banner-accepted'
        className='flex items-start gap-2 border-b bg-primary/10 px-4 py-3 text-primary text-sm'
      >
        <SteelIcon icon={CheckmarkCircle02Icon} className='mt-0.5 size-4' />
        <span>
          Aceito
          {runtime.acceptedByName ? ` por ${runtime.acceptedByName}` : ''}
          {runtime.acceptedAt
            ? ` em ${formatDocumentDate(runtime.acceptedAt)}`
            : ''}
          . Obrigado!
        </span>
      </div>
    )
  }
  if (runtime.status === 'declined') {
    return (
      <div
        role='status'
        data-testid='document-banner-declined'
        className='flex items-start gap-2 border-b bg-destructive/10 px-4 py-3 text-destructive text-sm'
      >
        <SteelIcon icon={CancelCircleIcon} className='mt-0.5 size-4' />
        <span>Este documento foi recusado.</span>
      </div>
    )
  }
  if (runtime.status === 'expired') {
    return (
      <div
        role='status'
        data-testid='document-banner-expired'
        className='flex items-start gap-2 border-b bg-muted px-4 py-3 text-muted-foreground text-sm'
      >
        <SteelIcon icon={Alert02Icon} className='mt-0.5 size-4' />
        <span>
          {validUntil
            ? `A validade deste documento terminou em ${formatDocumentDate(validUntil)}.`
            : 'A validade deste documento terminou.'}{' '}
          Fale com quem enviou para receber uma versão atualizada.
        </span>
      </div>
    )
  }
  return null
}

function DownloadButton({ runtime }: { runtime: DocumentRuntime }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!runtime.canDownload) return null

  async function download() {
    setBusy(true)
    setError(null)
    const result = await runtime.downloadPdf()
    setBusy(false)
    if (!result.ok) setError(result.message)
  }

  return (
    <div className='relative flex shrink-0 flex-col items-end'>
      <Button
        size='sm'
        variant='outline'
        disabled={busy}
        onClick={() => void download()}
        aria-label={busy ? 'Gerando PDF' : 'Baixar PDF'}
      >
        <SteelIcon icon={Download01Icon} data-icon='inline-start' />
        <span className='hidden sm:inline'>
          {busy ? 'Gerando PDF…' : 'Baixar PDF'}
        </span>
        <span className='sm:hidden'>{busy ? '…' : 'PDF'}</span>
      </Button>
      {error ? (
        <p
          role='alert'
          className='absolute top-full right-0 mt-1 w-64 rounded-md border bg-background p-2 text-destructive text-xs shadow-md'
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ViewerBody({
  data,
  content,
  reader,
}: {
  data: DocumentPublicDTO
  content: CanvasDocument
  reader: PublicReader | null
}) {
  const [now] = useState(() => Date.now())
  const runtime = usePublicDocumentRuntime({ data, content, reader, now })
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const { document, version, brand, token } = data
  const sections = useMemo(() => documentSections(content), [content])
  const context = useMemo<DocumentRenderContext>(
    () => ({
      mode: 'public',
      settings: document.settings,
      variables: data.variables,
      validUntil: document.validUntil,
      brand: { name: brand.name, logoUrl: brand.logoUrl },
      paymentEnabled: data.paymentEnabled,
    }),
    [document, data.variables, brand, data.paymentEnabled],
  )

  // Reading analytics: one tracker per opened version.
  useEffect(() => {
    if (!root) return
    return startDocumentTracker({ token, versionId: version.id, root })
  }, [root, token, version.id])

  return (
    <div className='min-h-dvh bg-muted/30'>
      <header className='sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80'>
        <div className='mx-auto flex h-14 max-w-5xl items-center gap-3 px-4'>
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className='h-7 w-auto max-w-24 shrink-0 object-contain'
            />
          ) : (
            <span className='max-w-28 shrink-0 truncate font-semibold text-sm'>
              {brand.name}
            </span>
          )}
          <span
            aria-hidden='true'
            className='hidden h-5 w-px shrink-0 bg-border sm:block'
          />
          <h1 className='min-w-0 flex-1 truncate font-medium text-sm'>
            {document.title}
          </h1>
          <DownloadButton runtime={runtime} />
        </div>
      </header>
      <StatusBanner runtime={runtime} validUntil={document.validUntil} />
      <DocumentRuntimeProvider runtime={runtime}>
        <main
          ref={setRoot}
          data-testid='document-viewer'
          className='mx-auto w-full max-w-5xl pb-24'
        >
          <DocumentView
            content={content}
            theme={document.theme}
            context={context}
          />
        </main>
      </DocumentRuntimeProvider>
      {document.settings.showToc ? (
        <DocumentToc root={root} sections={sections} />
      ) : null}
    </div>
  )
}

export function DocumentViewer({ data }: DocumentViewerProps) {
  const opened = useMemo(
    () => validateDocumentContent(data.version.content),
    [data.version.content],
  )
  // The generic link of a document that asks who is reading.
  const gated = data.document.settings.requireIdentification && !data.recipient
  const [reader, setReader] = useState<PublicReader | null>(null)
  const [checked, setChecked] = useState(!gated)

  useEffect(() => {
    if (!gated) return
    setReader(readStoredReader(data.token))
    setChecked(true)
  }, [gated, data.token])

  if (!opened.ok) {
    return (
      <Unavailable message='Não foi possível abrir este documento. Peça um novo link para quem o compartilhou.' />
    )
  }
  if (!checked) return <div className='min-h-dvh bg-muted/30' />
  if (gated && !reader) {
    return (
      <IdentificationGate
        token={data.token}
        title={data.document.title}
        brandName={data.brand.name}
        onIdentified={(next) => {
          storeReader(data.token, next)
          setReader(next)
        }}
      />
    )
  }
  return <ViewerBody data={data} content={opened.value} reader={reader} />
}

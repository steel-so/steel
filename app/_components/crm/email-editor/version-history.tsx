'use client'

import { WorkHistoryIcon } from '@hugeicons-pro/core-stroke-rounded'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  DESKTOP_WIDTH,
  EmailPreviewFrame,
} from '@/app/_components/crm/email-builder/email-preview-frame'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmEmailTemplateVersion,
  useCrmEmailTemplateVersions,
  useRestoreCrmEmailTemplateVersion,
  useSaveCrmEmailTemplateVersion,
} from '@/src/hooks/use-crm-email-editor'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import type {
  CrmEmailTemplateVersionDTO,
  CrmEmailTemplateVersionReasonDTO,
} from '@/types/crm-email-editor'
import { toProductData, useEmailEditorData } from './editor-data'
import { useRenderedEmailOnce } from './use-email-render'

export const VERSION_REASON_LABEL: Record<
  CrmEmailTemplateVersionReasonDTO,
  string
> = {
  SAVE: 'Versão salva',
  TEST_SEND: 'Envio de teste',
  CAMPAIGN: 'Usada em campanha',
  RESTORE: 'Restaurada',
}

/** "há 5 minutos" — relative, so it never depends on the viewer's zone;
 * the exact time (São Paulo, the workspace default) goes in the tooltip. */
function when(iso: string): { relative: string; exact: string } {
  const date = new Date(iso)
  return {
    relative: formatDistanceToNow(date, { addSuffix: true, locale: ptBR }),
    exact: date.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }),
  }
}

function VersionRow({
  version,
  selected,
  onSelect,
}: {
  version: CrmEmailTemplateVersionDTO
  selected: boolean
  onSelect: () => void
}) {
  const time = when(version.createdAt)
  return (
    <li>
      <button
        type='button'
        onClick={onSelect}
        aria-pressed={selected}
        data-testid={`version-${version.id}`}
        className={cn(
          'flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          selected && 'bg-primary/10 hover:bg-primary/10',
        )}
      >
        <span className='flex items-center gap-2'>
          <span className='truncate text-sm font-medium'>
            {version.label || VERSION_REASON_LABEL[version.reason]}
          </span>
        </span>
        <span className='truncate text-[11px] text-muted-foreground'>
          {version.label ? `${VERSION_REASON_LABEL[version.reason]} · ` : ''}
          <span title={time.exact}>{time.relative}</span>
          {version.createdBy ? ` · ${version.createdBy.name}` : ''}
        </span>
      </button>
    </li>
  )
}

function VersionPreview({
  versionId,
  onRestore,
  restoring,
}: {
  versionId: string
  onRestore: (version: CrmEmailTemplateVersionDTO) => void
  restoring: boolean
}) {
  const { workspaceId, templateId, brand, products } = useEmailEditorData()
  const detail = useCrmEmailTemplateVersion(workspaceId, templateId, versionId)
  const doc = useMemo(
    () => (detail.data ? openEmailDocument(detail.data.document) : null),
    [detail.data],
  )
  const productData = useMemo(() => toProductData(products), [products])
  const rendered = useRenderedEmailOnce(
    doc,
    detail.data?.subject ?? '',
    brand,
    productData,
  )

  if (detail.isError) {
    return (
      <p className='p-6 text-center text-sm text-muted-foreground'>
        Não foi possível carregar esta versão.
      </p>
    )
  }
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-2.5'>
        <p className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
          Assunto:{' '}
          <span className='font-medium text-foreground'>
            {detail.data?.subject ?? '…'}
          </span>
        </p>
        <Button
          type='button'
          size='sm'
          disabled={!detail.data || restoring}
          onClick={() => detail.data && onRestore(detail.data)}
          data-testid='version-restore'
        >
          {restoring ? 'Restaurando…' : 'Restaurar esta versão'}
        </Button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto bg-muted/40 p-4'>
        {rendered ? (
          <EmailPreviewFrame
            html={rendered.html}
            width={DESKTOP_WIDTH}
            zoom={1}
            dark={false}
            selectedId={null}
            onSelect={() => {}}
          />
        ) : (
          <Skeleton className='mx-auto h-[50vh] w-full max-w-[600px]' />
        )}
      </div>
    </div>
  )
}

function HistoryBody() {
  const { workspaceId, templateId, flushDocument, flushMeta, applyTemplate } =
    useEmailEditorData()
  const versions = useCrmEmailTemplateVersions(workspaceId, templateId)
  const save = useSaveCrmEmailTemplateVersion(workspaceId, templateId)
  const restore = useRestoreCrmEmailTemplateVersion(workspaceId, templateId)
  const [label, setLabel] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] =
    useState<CrmEmailTemplateVersionDTO | null>(null)

  const list = versions.data ?? []
  useEffect(() => {
    if (!selected && list.length > 0) setSelected(list[0].id)
  }, [selected, list])

  const saveVersion = async (event: FormEvent) => {
    event.preventDefault()
    // The version records what is stored: send pending edits first.
    if (!(await flushDocument()) || !(await flushMeta())) return
    try {
      const created = await save.mutateAsync({
        label: label.trim() || undefined,
      })
      setLabel('')
      if (created) {
        setSelected(created.id)
        notify.success('Versão salva')
      } else {
        notify.info('Nada mudou desde a última versão')
      }
    } catch (error) {
      notify.error(error)
    }
  }

  const confirmRestore = async () => {
    if (!confirming) return
    try {
      const restored = await restore.mutateAsync(confirming.id)
      applyTemplate(restored.template)
      setSelected(restored.version.id)
      notify.success('Versão restaurada — a anterior continua no histórico')
    } catch (error) {
      notify.error(error)
    } finally {
      setConfirming(null)
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col md:flex-row'>
      <div className='flex max-h-[40vh] shrink-0 flex-col border-b md:max-h-none md:w-72 md:border-r md:border-b-0'>
        <form onSubmit={saveVersion} className='flex gap-2 border-b p-3'>
          <Input
            aria-label='Nome da versão (opcional)'
            placeholder='Nome da versão (opcional)'
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            className='h-8 min-w-0 text-xs'
          />
          <Button
            type='submit'
            size='sm'
            disabled={save.isPending}
            data-testid='version-save'
          >
            {save.isPending ? 'Salvando…' : 'Salvar versão'}
          </Button>
        </form>
        <div className='min-h-0 flex-1 overflow-y-auto p-2'>
          {versions.isLoading ? (
            <div className='flex flex-col gap-2 p-1'>
              <Skeleton className='h-10 w-full' />
              <Skeleton className='h-10 w-full' />
            </div>
          ) : null}
          {versions.isError ? (
            <p className='p-4 text-center text-sm text-muted-foreground'>
              Não foi possível carregar o histórico.
            </p>
          ) : null}
          {!versions.isLoading && !versions.isError && list.length === 0 ? (
            <p className='p-4 text-center text-xs text-muted-foreground'>
              Nenhuma versão ainda. Salve uma versão, envie um teste ou use o
              template numa campanha para começar o histórico.
            </p>
          ) : null}
          <ul className='flex flex-col gap-0.5'>
            {list.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                selected={version.id === selected}
                onSelect={() => setSelected(version.id)}
              />
            ))}
          </ul>
        </div>
        <p className='border-t px-3 py-2 text-[11px] text-muted-foreground'>
          Ficam as 50 versões mais recentes.
        </p>
      </div>
      {selected ? (
        <VersionPreview
          key={selected}
          versionId={selected}
          restoring={restore.isPending}
          onRestore={setConfirming}
        />
      ) : (
        <div className='hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex'>
          Escolha uma versão para ver a prévia.
        </div>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar esta versão?</AlertDialogTitle>
            <AlertDialogDescription>
              O e-mail e o assunto voltam a ser os desta versão. O conteúdo
              atual não se perde: ele já está no histórico e a restauração vira
              uma nova versão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRestore}
              data-testid='version-confirm-restore'
            >
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Top-bar "Histórico": versions of the template with preview and restore. */
export function VersionHistoryButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => setOpen(true)}
        data-testid='version-history-trigger'
      >
        <SteelIcon icon={WorkHistoryIcon} strokeWidth={2} />
        Histórico
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className='flex w-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl'>
          <SheetHeader className='border-b px-4 py-3'>
            <SheetTitle>Histórico de versões</SheetTitle>
            <SheetDescription>
              Versões salvas, enviadas em teste ou usadas em campanhas.
            </SheetDescription>
          </SheetHeader>
          {open ? <HistoryBody /> : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

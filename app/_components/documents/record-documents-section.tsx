'use client'

import { Add01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type DocumentListFilters,
  useDocuments,
} from '@/src/hooks/use-documents'
import type { DocumentKindDTO } from '@/src/schemas/document.schema'
import { DocumentStatusChip } from './document-chips'
import { formatDocumentMoney, kindLabel } from './documents-tone'
import { NewDocumentDialog, type NewDocumentLinks } from './new-document-dialog'

const LIMIT = 10

/**
 * "Documentos" on a CRM record (opportunity, company, person, lead): the
 * documents linked to it and "Novo documento" already linked (a proposal
 * when it starts from an opportunity).
 */
export function RecordDocumentsSection({
  workspaceId,
  slug,
  link,
  listBy,
  defaultKind,
  defaultTitle,
}: {
  workspaceId: string
  slug: string
  /** Records a new document starts linked to (the record and its own
   * company/person, when known). */
  link: NewDocumentLinks
  /** Which link is this record: the list shows documents linked to it. */
  listBy: keyof NewDocumentLinks
  defaultKind?: DocumentKindDTO
  defaultTitle?: string
}) {
  const canView = useCan('documents', 'VIEW')
  const canCreate = useCan('documents', 'CREATE')
  const [creating, setCreating] = useState(false)
  // The dialog (and the router it uses) mounts on first use and stays, so
  // the AI import it opens survives the dialog closing.
  const [dialogMounted, setDialogMounted] = useState(false)
  const recordId = link[listBy] ?? undefined
  const list = useDocuments(
    workspaceId,
    { [listBy]: recordId, pageSize: LIMIT } as DocumentListFilters,
    { enabled: canView && Boolean(recordId) },
  )
  if (!canView) return null

  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0

  return (
    <section aria-label='Documentos' className='grid gap-2'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='font-medium text-sm'>Documentos</h3>
        {canCreate ? (
          <Button
            type='button'
            size='xs'
            variant='outline'
            onClick={() => {
              setDialogMounted(true)
              setCreating(true)
            }}
          >
            <SteelIcon icon={Add01Icon} data-icon='inline-start' />
            Novo documento
          </Button>
        ) : null}
      </div>
      {list.isLoading ? (
        <Skeleton className='h-14 w-full rounded-lg' />
      ) : list.error ? (
        <p className='text-muted-foreground text-xs'>
          Não foi possível carregar os documentos.
        </p>
      ) : items.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Nenhum documento vinculado ainda.
        </p>
      ) : (
        <ul className='grid gap-1.5'>
          {items.map((doc) => (
            <li key={doc.id}>
              <Link
                href={`/${slug}/crm/documents/${doc.id}`}
                data-testid={`record-document-${doc.id}`}
                className='flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50'
              >
                <span className='min-w-0 flex-1'>
                  <span className='block truncate font-medium text-sm'>
                    {doc.title}
                  </span>
                  <span className='block truncate text-muted-foreground text-xs'>
                    {kindLabel(doc.kind)}
                    {doc.totalValue !== null
                      ? ` · ${formatDocumentMoney(doc.totalValue)}`
                      : ''}
                  </span>
                </span>
                <DocumentStatusChip status={doc.status} />
              </Link>
            </li>
          ))}
          {total > items.length ? (
            <li>
              <Link
                href={`/${slug}/crm/documents`}
                className='text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline'
              >
                Ver todos os {total} documentos
              </Link>
            </li>
          ) : null}
        </ul>
      )}
      {dialogMounted ? (
        <NewDocumentDialog
          workspaceId={workspaceId}
          slug={slug}
          open={creating}
          onOpenChange={setCreating}
          links={link}
          defaultKind={defaultKind}
          defaultTitle={defaultTitle}
        />
      ) : null}
    </section>
  )
}

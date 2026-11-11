'use client'

import {
  Archive02Icon,
  ArchiveArrowUpIcon,
  BookmarkAdd01Icon,
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  SentIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { DocumentAnalyticsPanel } from '@/app/_components/documents/analytics/document-analytics-panel'
import { DocumentExportButton } from '@/app/_components/documents/export/document-export-button'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import { ApiError } from '@/src/hooks/_fetch'
import {
  useDeleteDocument,
  useDocument,
  useDuplicateDocument,
  useUpdateDocument,
} from '@/src/hooks/use-documents'
import type { DocumentDTO } from '@/types/document'
import { CopyLinkButton } from './copy-link-button'
import { DocumentActivity, DocumentVersions } from './document-activity'
import { DocumentKindChip, DocumentStatusChip } from './document-chips'
import { DocumentOverview } from './document-overview'
import {
  formatDocumentDate,
  formatDocumentDateTime,
  formatDocumentMoney,
} from './documents-tone'
import { NewDocumentDialog } from './new-document-dialog'
import { SendDocumentDialog } from './send-document-dialog'

type Tab = 'overview' | 'analytics' | 'activity' | 'versions'

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='min-w-0'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='truncate font-medium text-sm'>{children}</dd>
    </div>
  )
}

function DocumentHeader({
  document,
  slug,
  onSend,
  onUseTemplate,
}: {
  document: DocumentDTO
  slug: string
  onSend: () => void
  onUseTemplate: () => void
}) {
  const router = useRouter()
  const canEdit = useCan('documents', 'EDIT')
  const canCreate = useCan('documents', 'CREATE')
  const canDelete = useCan('documents', 'DELETE')
  const update = useUpdateDocument(document.workspaceId, document.id)
  const duplicate = useDuplicateDocument(document.workspaceId)
  const remove = useDeleteDocument(document.workspaceId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const base = `/${slug}/crm/documents`
  const archived = document.status === 'ARCHIVED'
  const updateVersion = Boolean(
    document.currentVersion && document.hasUnsentChanges,
  )

  async function copyAs(asTemplate: boolean) {
    try {
      const copy = await duplicate.mutateAsync({
        documentId: document.id,
        asTemplate,
      })
      notify.success(
        asTemplate ? 'Modelo criado a partir do documento.' : 'Cópia criada.',
      )
      router.push(asTemplate ? `${base}/${copy.id}` : `${base}/${copy.id}/edit`)
    } catch (error) {
      notify.error(error, 'Não foi possível copiar o documento')
    }
  }

  async function toggleArchive() {
    try {
      await update.mutateAsync({ status: archived ? 'DRAFT' : 'ARCHIVED' })
      notify.success(archived ? 'Documento reaberto.' : 'Documento arquivado.')
    } catch (error) {
      notify.error(error, 'Não foi possível alterar o documento')
    }
  }

  async function removeDocument() {
    setConfirmDelete(false)
    try {
      await remove.mutateAsync(document.id)
      notify.success(`“${document.title}” excluído.`)
      router.push(document.isTemplate ? `${base}?tab=modelos` : base)
    } catch (error) {
      notify.error(error, 'Não foi possível excluir o documento')
    }
  }

  return (
    <header className='grid gap-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='grid min-w-0 gap-1.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <DocumentKindChip kind={document.kind} />
            {document.isTemplate ? (
              <span className='rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary'>
                Modelo
              </span>
            ) : (
              <DocumentStatusChip status={document.status} />
            )}
          </div>
          <h1 className='break-words font-semibold text-xl'>
            {document.title}
          </h1>
          {document.description ? (
            <p className='text-muted-foreground text-sm'>
              {document.description}
            </p>
          ) : null}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {canEdit ? (
            <Button
              variant='outline'
              size='sm'
              nativeButton={false}
              render={<Link href={`${base}/${document.id}/edit`} />}
            >
              <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
              Editar
            </Button>
          ) : null}
          {document.isTemplate ? (
            canCreate ? (
              <Button size='sm' onClick={onUseTemplate}>
                Usar modelo
              </Button>
            ) : null
          ) : (
            <>
              {document.currentVersion ? (
                <CopyLinkButton url={document.publicUrl} />
              ) : null}
              <DocumentExportButton
                workspaceId={document.workspaceId}
                documentId={document.id}
                hasVersion={Boolean(document.currentVersion)}
                variant='outline'
              />
              {canEdit && !archived ? (
                <Button
                  size='sm'
                  onClick={onSend}
                  data-testid='document-page-send'
                >
                  <SteelIcon icon={SentIcon} data-icon='inline-start' />
                  {updateVersion ? 'Atualizar versão' : 'Enviar'}
                </Button>
              ) : null}
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label='Mais ações'
              className='flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
            >
              <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-52'>
              {canCreate ? (
                <DropdownMenuItem onClick={() => void copyAs(false)}>
                  <SteelIcon icon={Copy01Icon} />
                  Duplicar
                </DropdownMenuItem>
              ) : null}
              {canCreate && !document.isTemplate ? (
                <DropdownMenuItem onClick={() => void copyAs(true)}>
                  <SteelIcon icon={BookmarkAdd01Icon} />
                  Salvar como modelo
                </DropdownMenuItem>
              ) : null}
              {canEdit && !document.isTemplate ? (
                <DropdownMenuItem onClick={() => void toggleArchive()}>
                  <SteelIcon
                    icon={archived ? ArchiveArrowUpIcon : Archive02Icon}
                  />
                  {archived ? 'Desarquivar' : 'Arquivar'}
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant='destructive'
                    onClick={() => setConfirmDelete(true)}
                  >
                    <SteelIcon icon={Delete02Icon} />
                    Excluir
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <dl className='grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-4'>
        <Meta label='Responsável'>{document.owner?.name ?? '—'}</Meta>
        <Meta label='Valor'>{formatDocumentMoney(document.totalValue)}</Meta>
        <Meta label='Válido até'>
          {document.validUntil ? formatDocumentDate(document.validUntil) : '—'}
        </Meta>
        <Meta label={document.sentAt ? 'Enviado em' : 'Atualizado em'}>
          {formatDocumentDateTime(document.sentAt ?? document.updatedAt)}
        </Meta>
      </dl>

      {updateVersion ? (
        <p
          role='status'
          className='rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground text-sm'
        >
          Há alterações no rascunho que o leitor ainda não vê. Use{' '}
          <strong className='font-medium text-foreground'>
            Atualizar versão
          </strong>{' '}
          para enviá-las.
        </p>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{document.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {document.isTemplate
                ? 'Documentos já criados a partir deste modelo continuam existindo.'
                : 'O link público para de funcionar e o documento sai da lista.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void removeDocument()}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  )
}

function TemplateOverview({ document }: { document: DocumentDTO }) {
  return (
    <section className='grid gap-2 rounded-xl border bg-card p-4 text-sm'>
      <h2 className='font-medium'>Sobre este modelo</h2>
      <p className='text-muted-foreground'>
        Documentos criados a partir dele começam com o mesmo conteúdo, tema e
        configurações. Em Analytics você vê a leitura somada de todos eles.
      </p>
      <p className='text-muted-foreground'>
        Atualizado em {formatDocumentDateTime(document.updatedAt)}.
      </p>
    </section>
  )
}

/**
 * Page of a document (`/crm/documents/[id]`): header with title, kind,
 * status, owner, value and validity, the actions (Editar, Enviar or
 * Atualizar versão, Copiar link, Exportar PDF, Duplicar, Salvar como
 * modelo, Arquivar, Excluir) and the tabs Visão geral, Analytics,
 * Atividade and Versões. Templates show only Visão geral and Analytics.
 */
export function DocumentPage({
  workspaceId,
  slug,
  documentId,
}: {
  workspaceId: string
  slug: string
  documentId: string
}) {
  const query = useDocument(workspaceId, documentId)
  const [tab, setTab] = useState<Tab>('overview')
  const [sending, setSending] = useState(false)
  const [usingTemplate, setUsingTemplate] = useState(false)
  const document = query.data

  if (query.error) {
    const missing =
      query.error instanceof ApiError &&
      (query.error.status === 404 || query.error.status === 403)
    return (
      <div className='mx-auto grid w-full max-w-md gap-3 px-4 py-16 text-center'>
        <p className='text-muted-foreground text-sm'>
          {missing
            ? 'Este documento não existe mais ou você não tem acesso a ele.'
            : 'Não foi possível carregar o documento.'}
        </p>
        <div className='flex justify-center gap-2'>
          {missing ? null : (
            <Button
              size='sm'
              variant='outline'
              onClick={() => void query.refetch()}
            >
              Tentar de novo
            </Button>
          )}
          <Button
            size='sm'
            variant='ghost'
            nativeButton={false}
            render={<Link href={`/${slug}/crm/documents`} />}
          >
            Voltar para a lista
          </Button>
        </div>
      </div>
    )
  }

  if (!document) {
    return (
      <div
        className='mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 sm:px-6'
        aria-busy='true'
      >
        <Skeleton className='h-8 w-1/2' />
        <Skeleton className='h-20 w-full rounded-xl' />
        <Skeleton className='h-64 w-full rounded-xl' />
      </div>
    )
  }

  return (
    <div className='mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6'>
      <DocumentHeader
        document={document}
        slug={slug}
        onSend={() => setSending(true)}
        onUseTemplate={() => setUsingTemplate(true)}
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className='gap-4'
      >
        <TabsList
          variant='line'
          className='w-full justify-start overflow-x-auto'
        >
          <TabsTrigger value='overview' className='flex-none'>
            Visão geral
          </TabsTrigger>
          <TabsTrigger value='analytics' className='flex-none'>
            Analytics
          </TabsTrigger>
          {document.isTemplate ? null : (
            <>
              <TabsTrigger value='activity' className='flex-none'>
                Atividade
              </TabsTrigger>
              <TabsTrigger value='versions' className='flex-none'>
                Versões
              </TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value='overview'>
          {document.isTemplate ? (
            <TemplateOverview document={document} />
          ) : (
            <DocumentOverview
              document={document}
              onSend={() => setSending(true)}
            />
          )}
        </TabsContent>
        <TabsContent value='analytics'>
          <DocumentAnalyticsPanel
            workspaceId={workspaceId}
            documentId={document.id}
            isTemplate={document.isTemplate}
          />
        </TabsContent>
        {document.isTemplate ? null : (
          <>
            <TabsContent value='activity'>
              <DocumentActivity
                workspaceId={workspaceId}
                documentId={document.id}
              />
            </TabsContent>
            <TabsContent value='versions'>
              <DocumentVersions
                workspaceId={workspaceId}
                documentId={document.id}
                currentVersionId={document.currentVersion?.id ?? null}
              />
            </TabsContent>
          </>
        )}
      </Tabs>

      {document.isTemplate ? (
        <NewDocumentDialog
          workspaceId={workspaceId}
          slug={slug}
          open={usingTemplate}
          onOpenChange={setUsingTemplate}
          defaultKind={document.kind}
          defaultTitle={document.title}
          templateId={document.id}
        />
      ) : (
        <SendDocumentDialog
          workspaceId={workspaceId}
          document={document}
          open={sending}
          onOpenChange={setSending}
        />
      )}
    </div>
  )
}

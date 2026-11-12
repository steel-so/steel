'use client'

import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  DocumentValidationIcon,
  Files01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Search01Icon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import {
  type DocumentListFilters,
  useDeleteDocument,
  useDocuments,
  useDuplicateDocument,
} from '@/src/hooks/use-documents'
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  type DocumentKindDTO,
  type DocumentStatusDTO,
} from '@/src/schemas/document.schema'
import type { DocumentListItemDTO } from '@/types/document'
import { DocumentKindChip, DocumentStatusChip } from './document-chips'
import {
  formatDocumentMoney,
  formatDocumentRelative,
  kindLabel,
  statusLabel,
} from './documents-tone'
import { NewDocumentDialog } from './new-document-dialog'
import { OptionSelect } from './option-select'

export type DocumentsTab = 'documents' | 'templates'

const LOOKUP_KINDS: LookupKind[] = ['users']
const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300

const KIND_OPTIONS = DOCUMENT_KINDS.map((kind) => ({
  value: kind,
  label: kindLabel(kind),
}))

const TABS = [
  { value: 'documents', label: 'Documentos', icon: DocumentValidationIcon },
  { value: 'templates', label: 'Modelos', icon: Files01Icon },
] as const

const STATUS_OPTIONS = DOCUMENT_STATUSES.map((status) => ({
  value: status,
  label: statusLabel(status),
}))

/** Client of the row: company, else person, else lead. */
function clientOf(doc: DocumentListItemDTO): string | null {
  return doc.company?.name ?? doc.person?.name ?? doc.lead?.name ?? null
}

function RowActions({
  doc,
  slug,
  onDuplicate,
  onDelete,
}: {
  doc: DocumentListItemDTO
  slug: string
  onDuplicate: (doc: DocumentListItemDTO) => void
  onDelete: (doc: DocumentListItemDTO) => void
}) {
  const canEdit = useCan('documents', 'EDIT')
  const canCreate = useCan('documents', 'CREATE')
  const canDelete = useCan('documents', 'DELETE')
  const href = `/${slug}/crm/documents/${doc.id}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Ações de ${doc.title}`}
        className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
      >
        <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-48'>
        <DropdownMenuItem render={<Link href={href} />}>
          <SteelIcon icon={ViewIcon} />
          Abrir
        </DropdownMenuItem>
        {canEdit ? (
          <DropdownMenuItem render={<Link href={`${href}/edit`} />}>
            <SteelIcon icon={PencilEdit02Icon} />
            Editar
          </DropdownMenuItem>
        ) : null}
        {canCreate ? (
          <DropdownMenuItem onClick={() => onDuplicate(doc)}>
            <SteelIcon icon={Copy01Icon} />
            Duplicar
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              onClick={() => onDelete(doc)}
            >
              <SteelIcon icon={Delete02Icon} />
              Excluir
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DocumentsTable({
  items,
  slug,
  templates,
  now,
  onDuplicate,
  onDelete,
  onUseTemplate,
}: {
  items: DocumentListItemDTO[]
  slug: string
  templates: boolean
  now: number
  onDuplicate: (doc: DocumentListItemDTO) => void
  onDelete: (doc: DocumentListItemDTO) => void
  onUseTemplate: (doc: DocumentListItemDTO) => void
}) {
  const canCreate = useCan('documents', 'CREATE')
  const head =
    'px-3 py-2 text-left font-medium text-muted-foreground text-xs whitespace-nowrap'
  return (
    <div className='overflow-hidden rounded-xl border'>
      <table className='w-full table-fixed text-sm'>
        <thead className='border-b bg-muted/40'>
          <tr>
            <th className={cn(head, 'w-auto')}>Título</th>
            <th className={cn(head, 'hidden w-28 md:table-cell')}>Tipo</th>
            {templates ? null : (
              <>
                <th className={cn(head, 'w-28')}>Status</th>
                <th className={cn(head, 'hidden w-44 lg:table-cell')}>
                  Cliente / oportunidade
                </th>
                <th
                  className={cn(head, 'hidden w-28 text-right md:table-cell')}
                >
                  Valor
                </th>
                <th
                  className={cn(head, 'hidden w-20 text-right xl:table-cell')}
                >
                  Leituras
                </th>
                <th className={cn(head, 'hidden w-32 xl:table-cell')}>
                  Última leitura
                </th>
              </>
            )}
            <th className={cn(head, 'hidden w-32 sm:table-cell')}>
              Atualizado
            </th>
            <th className={cn(head, templates ? 'w-36' : 'w-12')}>
              <span className='sr-only'>Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((doc) => {
            const client = clientOf(doc)
            return (
              <tr
                key={doc.id}
                data-testid={`document-row-${doc.id}`}
                className='border-b last:border-b-0 hover:bg-muted/30'
              >
                <td className='px-3 py-2.5'>
                  <Link
                    href={`/${slug}/crm/documents/${doc.id}`}
                    className='block truncate font-medium hover:underline'
                  >
                    {doc.title}
                  </Link>
                  <span className='block truncate text-muted-foreground text-xs md:hidden'>
                    {kindLabel(doc.kind)}
                    {client ? ` · ${client}` : ''}
                  </span>
                </td>
                <td className='hidden px-3 py-2.5 md:table-cell'>
                  <DocumentKindChip kind={doc.kind} />
                </td>
                {templates ? null : (
                  <>
                    <td className='px-3 py-2.5'>
                      <DocumentStatusChip status={doc.status} />
                    </td>
                    <td className='hidden px-3 py-2.5 lg:table-cell'>
                      <span className='block truncate'>{client ?? '—'}</span>
                      {doc.opportunity ? (
                        <span className='block truncate text-muted-foreground text-xs'>
                          {doc.opportunity.name}
                        </span>
                      ) : null}
                    </td>
                    <td className='hidden px-3 py-2.5 text-right tabular-nums md:table-cell'>
                      {formatDocumentMoney(doc.totalValue)}
                    </td>
                    <td className='hidden px-3 py-2.5 text-right tabular-nums xl:table-cell'>
                      {doc.viewCount}
                    </td>
                    <td className='hidden truncate px-3 py-2.5 text-muted-foreground xl:table-cell'>
                      {doc.lastViewedAt
                        ? formatDocumentRelative(doc.lastViewedAt, now)
                        : 'Nunca'}
                    </td>
                  </>
                )}
                <td className='hidden truncate px-3 py-2.5 text-muted-foreground sm:table-cell'>
                  {formatDocumentRelative(doc.updatedAt, now)}
                </td>
                <td className='px-2 py-1.5'>
                  <div className='flex items-center justify-end gap-1'>
                    {templates && canCreate ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => onUseTemplate(doc)}
                      >
                        Usar
                      </Button>
                    ) : null}
                    <RowActions
                      doc={doc}
                      slug={slug}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * CRM › Documentos: tabs Documentos | Modelos, filters (tipo, status,
 * responsável, busca), the table with reading data and the "Novo
 * documento" dialog (em branco, modelos, galeria, PDF e IA).
 */
export function DocumentsList({
  workspaceId,
  slug,
  initialTab = 'documents',
}: {
  workspaceId: string
  slug: string
  initialTab?: DocumentsTab
}) {
  const id = useId()
  const router = useRouter()
  const canCreate = useCan('documents', 'CREATE')
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const [tab, setTab] = useState<DocumentsTab>(initialTab)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [templateToUse, setTemplateToUse] =
    useState<DocumentListItemDTO | null>(null)
  const [removing, setRemoving] = useState<DocumentListItemDTO | null>(null)
  const [now] = useState(() => Date.now())
  const duplicate = useDuplicateDocument(workspaceId)
  const remove = useDeleteDocument(workspaceId)
  const templates = tab === 'templates'

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // Any filter change goes back to the first page.
  useEffect(() => {
    setPage(1)
  }, [q, kind, status, ownerId, tab])

  const filters = useMemo<DocumentListFilters>(
    () => ({
      isTemplate: templates,
      q: q || undefined,
      kind: (kind || undefined) as DocumentKindDTO | undefined,
      status: templates
        ? undefined
        : ((status || undefined) as DocumentStatusDTO | undefined),
      ownerId: ownerId || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [templates, q, kind, status, ownerId, page],
  )
  const list = useDocuments(workspaceId, filters)
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageSummary = `${total === 1 ? '1 item' : `${total} itens`} · página ${page} de ${pages}`
  const filtered = Boolean(q || kind || (!templates && status) || ownerId)

  function clearFilters() {
    setSearch('')
    setQ('')
    setKind('')
    setStatus('')
    setOwnerId('')
  }

  async function duplicateDoc(doc: DocumentListItemDTO) {
    try {
      const copy = await duplicate.mutateAsync({ documentId: doc.id })
      notify.success(`“${copy.title}” criado.`)
      router.push(`/${slug}/crm/documents/${copy.id}/edit`)
    } catch (error) {
      notify.error(error, 'Não foi possível duplicar o documento')
    }
  }

  async function confirmRemove() {
    if (!removing) return
    const doc = removing
    setRemoving(null)
    try {
      await remove.mutateAsync(doc.id)
      notify.success(`“${doc.title}” excluído.`)
    } catch (error) {
      notify.error(error, 'Não foi possível excluir o documento')
    }
  }

  return (
    <div className='mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 sm:px-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='font-semibold text-xl'>Documentos</h1>
          <p className='text-muted-foreground text-sm'>
            Propostas, contratos e orçamentos com link rastreado, aceite e
            análise de leitura.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)} data-testid='new-document'>
            <SteelIcon icon={Add01Icon} data-icon='inline-start' />
            {templates ? 'Novo modelo' : 'Novo documento'}
          </Button>
        ) : null}
      </div>

      <div
        role='tablist'
        aria-label='Documentos e modelos'
        className='flex gap-1 border-b'
      >
        {TABS.map(({ value, label, icon }) => (
          <button
            key={value}
            type='button'
            role='tab'
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              tab === value
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <SteelIcon icon={icon} className='size-4' />
            {label}
          </button>
        ))}
      </div>

      <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_12rem]'>
        <div className='relative sm:col-span-2 lg:col-span-1'>
          <SteelIcon
            icon={Search01Icon}
            className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground'
          />
          <Input
            id={`${id}-search`}
            type='search'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={templates ? 'Buscar modelos…' : 'Buscar documentos…'}
            aria-label='Buscar'
            className='pl-8'
          />
        </div>
        <OptionSelect
          value={kind}
          options={KIND_OPTIONS}
          onChange={setKind}
          emptyLabel='Todos os tipos'
          ariaLabel='Tipo'
        />
        {templates ? (
          <div className='hidden lg:block' />
        ) : (
          <OptionSelect
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
            emptyLabel='Todos os status'
            ariaLabel='Status'
          />
        )}
        <OptionSelect
          value={ownerId}
          options={lookups.options.users}
          onChange={setOwnerId}
          emptyLabel='Todos os responsáveis'
          ariaLabel='Responsável'
        />
      </div>

      {list.isLoading ? (
        <div className='grid gap-2' aria-busy='true'>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className='h-12 w-full rounded-lg' />
          ))}
        </div>
      ) : list.error ? (
        <div className='rounded-xl border p-8 text-center'>
          <p className='text-muted-foreground text-sm'>
            Não foi possível carregar os documentos.
          </p>
          <Button
            className='mt-3'
            size='sm'
            variant='outline'
            onClick={() => void list.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <div className='rounded-xl border border-dashed p-8 text-center'>
            <p className='text-muted-foreground text-sm'>
              Nada encontrado com esses filtros.
            </p>
            <Button
              className='mt-3'
              size='sm'
              variant='outline'
              onClick={clearFilters}
            >
              Limpar filtros
            </Button>
          </div>
        ) : (
          <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center'>
            <span className='flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'>
              <SteelIcon
                icon={templates ? Files01Icon : DocumentValidationIcon}
                className='size-6'
              />
            </span>
            <h2 className='font-medium text-base'>
              {templates
                ? 'Nenhum modelo ainda'
                : 'Crie seu primeiro documento'}
            </h2>
            <p className='max-w-md text-muted-foreground text-sm'>
              {templates
                ? 'Modelos aceleram propostas e contratos repetidos. Crie um do zero ou use “Salvar como modelo” em qualquer documento.'
                : 'Monte uma proposta, contrato ou orçamento no editor, envie um link rastreado e saiba quando o cliente lê e aceita. Também dá para importar um PDF ou pedir para a IA.'}
            </p>
            {canCreate ? (
              <Button onClick={() => setCreating(true)}>
                <SteelIcon icon={Add01Icon} data-icon='inline-start' />
                {templates ? 'Novo modelo' : 'Novo documento'}
              </Button>
            ) : null}
          </div>
        )
      ) : (
        <>
          <DocumentsTable
            items={items}
            slug={slug}
            templates={templates}
            now={now}
            onDuplicate={(doc) => void duplicateDoc(doc)}
            onDelete={setRemoving}
            onUseTemplate={setTemplateToUse}
          />
          {pages > 1 ? (
            <nav
              aria-label='Paginação'
              className='flex items-center justify-between gap-3 text-muted-foreground text-sm'
            >
              <span>{pageSummary}</span>
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Anterior
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={page >= pages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Próxima
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}

      <NewDocumentDialog
        workspaceId={workspaceId}
        slug={slug}
        open={creating}
        onOpenChange={setCreating}
        isTemplate={templates}
      />
      <NewDocumentDialog
        workspaceId={workspaceId}
        slug={slug}
        open={templateToUse !== null}
        onOpenChange={(open) => !open && setTemplateToUse(null)}
        defaultKind={templateToUse?.kind}
        defaultTitle={templateToUse?.title}
        templateId={templateToUse?.id}
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{removing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.isTemplate
                ? 'Documentos já criados a partir deste modelo continuam existindo.'
                : 'O link público para de funcionar e o documento sai da lista.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void confirmRemove()}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

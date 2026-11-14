'use client'

import {
  Add01Icon,
  Archive01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  BookOpenTextIcon,
  Delete02Icon,
  File02Icon,
  MoreHorizontalIcon,
  RestoreBinIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useArchiveSdKbArticle,
  useCreateSdKbArticle,
  useDeleteSdKbArticle,
  useMoveSdKbArticle,
  useRestoreSdKbArticle,
  useSdKbArticles,
} from '@/src/hooks/use-sd-knowledge'
import type { SdKbArticleSummaryDTO } from '@/types/sd-kb-article'
import { SD_KB_STATUS_DOT } from './sd-kb-status-badge'
import {
  buildSdKbTree,
  type SdKbTreeNode,
  sdKbAncestorIds,
} from './sd-kb-utils'

/**
 * Árvore de artigos (port do `WikiSidebarTree` do Nexo) com as melhorias da
 * KB: expandir/recolher, status (rascunho) no item, criar subartigo, subir/
 * descer entre os irmãos e a lixeira com restaurar/excluir.
 */
interface SdKbTreeProps {
  workspaceId: string
  workspaceSlug: string
  canEdit: boolean
  canCreate: boolean
  canDelete: boolean
}

export function SdKbTree(props: SdKbTreeProps) {
  const { workspaceId, workspaceSlug } = props
  const [showArchived, setShowArchived] = useState(false)
  const { data: articles, isLoading } = useSdKbArticles(workspaceId)
  const tree = useMemo(() => buildSdKbTree(articles ?? []), [articles])
  const pathname = usePathname()
  const currentId = pathname.split('/knowledge/')[1]?.split('/')[0]
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Abre a árvore até o artigo aberto.
  useEffect(() => {
    if (!currentId || !articles) return
    const ancestors = sdKbAncestorIds(articles, currentId)
    if (ancestors.length === 0) return
    setExpanded((prev) => new Set([...prev, ...ancestors]))
  }, [currentId, articles])

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <nav aria-label='Artigos da base de conhecimento' className='space-y-2'>
      <Link
        href={`/${workspaceSlug}/servicedesk/knowledge`}
        className={cn(
          'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-muted',
          !currentId && 'bg-muted font-medium',
        )}
      >
        <SteelIcon icon={BookOpenTextIcon} strokeWidth={2} />
        Início da base
      </Link>

      {isLoading ? (
        <div className='space-y-1.5 px-2.5' data-testid='sd-kb-tree-loading'>
          <Skeleton className='h-6 w-full' />
          <Skeleton className='h-6 w-4/5' />
          <Skeleton className='h-6 w-3/5' />
        </div>
      ) : tree.length === 0 ? (
        <Muted className='px-2.5'>Nenhum artigo ainda.</Muted>
      ) : (
        <ul className='space-y-0.5'>
          {tree.map((node, index) => (
            <SdKbTreeItem
              key={node.id}
              {...props}
              node={node}
              depth={0}
              siblings={tree}
              index={index}
              currentId={currentId}
              expanded={expanded}
              onToggle={toggle}
            />
          ))}
        </ul>
      )}

      {props.canEdit && (
        <div className='border-t pt-2'>
          <button
            type='button'
            onClick={() => setShowArchived((v) => !v)}
            className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-muted-foreground text-xs hover:bg-muted'
            aria-expanded={showArchived}
          >
            <SteelIcon icon={Archive01Icon} size={14} strokeWidth={2} />
            Arquivados
          </button>
          {showArchived && <SdKbArchivedList {...props} />}
        </div>
      )}
    </nav>
  )
}

function SdKbTreeItem({
  node,
  depth,
  siblings,
  index,
  currentId,
  expanded,
  onToggle,
  workspaceId,
  workspaceSlug,
  canEdit,
  canCreate,
}: SdKbTreeProps & {
  node: SdKbTreeNode
  depth: number
  siblings: SdKbTreeNode[]
  index: number
  currentId: string | undefined
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const router = useRouter()
  const href = `/${workspaceSlug}/servicedesk/knowledge/${node.id}`
  const isActive = currentId === node.id
  const isOpen = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const archive = useArchiveSdKbArticle(workspaceId)
  const move = useMoveSdKbArticle(workspaceId)
  const create = useCreateSdKbArticle(workspaceId)

  function reorder(delta: -1 | 1) {
    move.mutate(
      { articleId: node.id, parentId: node.parentId, position: index + delta },
      { onError: notify.error },
    )
  }

  function createChild() {
    create.mutate(
      { parentId: node.id },
      {
        onSuccess: (article) => {
          if (!isOpen) onToggle(node.id)
          router.push(`/${workspaceSlug}/servicedesk/knowledge/${article.id}`)
        },
        onError: notify.error,
      },
    )
  }

  function archiveArticle() {
    archive.mutate(node.id, {
      onSuccess: () => {
        notify.success('Artigo arquivado')
        if (isActive) router.push(`/${workspaceSlug}/servicedesk/knowledge`)
      },
      onError: notify.error,
    })
  }

  return (
    <li>
      <div
        className={cn(
          'group flex items-center rounded-md pr-1 hover:bg-muted',
          isActive && 'bg-muted',
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          type='button'
          aria-label={isOpen ? 'Recolher' : 'Expandir'}
          onClick={() => onToggle(node.id)}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background',
            !hasChildren && 'invisible',
          )}
        >
          <SteelIcon
            icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
            size={12}
            strokeWidth={2}
          />
        </button>
        <Link
          href={href}
          aria-current={isActive ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 text-sm',
            isActive && 'font-medium',
          )}
        >
          {node.icon ? (
            <span className='w-4 shrink-0 text-center text-sm'>
              {node.icon}
            </span>
          ) : (
            <SteelIcon icon={File02Icon} strokeWidth={2} className='shrink-0' />
          )}
          <span title={node.title || 'Sem título'} className='truncate'>
            {node.title || 'Sem título'}
          </span>
          {node.status === 'DRAFT' && (
            <span
              title='Rascunho'
              className={cn(
                'ml-auto size-1.5 shrink-0 rounded-full',
                SD_KB_STATUS_DOT[node.status],
              )}
            />
          )}
        </Link>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Ações de ${node.title || 'Sem título'}`}
                  className='shrink-0 opacity-0 group-hover:opacity-100 data-popup-open:opacity-100'
                >
                  <SteelIcon icon={MoreHorizontalIcon} strokeWidth={2} />
                </Button>
              }
            />
            <DropdownMenuContent align='end'>
              {canCreate && (
                <DropdownMenuItem onClick={createChild}>
                  <SteelIcon icon={Add01Icon} strokeWidth={2} />
                  Novo subartigo
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={index === 0}
                onClick={() => reorder(-1)}
              >
                <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} />
                Mover para cima
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === siblings.length - 1}
                onClick={() => reorder(1)}
              >
                <SteelIcon icon={ArrowDown01Icon} strokeWidth={2} />
                Mover para baixo
              </DropdownMenuItem>
              {node.parentId && (
                <DropdownMenuItem
                  onClick={() =>
                    move.mutate(
                      { articleId: node.id, parentId: null, position: 0 },
                      { onError: notify.error },
                    )
                  }
                >
                  <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} />
                  Mover para a raiz
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={archiveArticle}>
                <SteelIcon icon={Archive01Icon} strokeWidth={2} />
                Arquivar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {hasChildren && isOpen && (
        <ul className='space-y-0.5'>
          {node.children.map((child, childIndex) => (
            <SdKbTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              siblings={node.children}
              index={childIndex}
              currentId={currentId}
              expanded={expanded}
              onToggle={onToggle}
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              canEdit={canEdit}
              canCreate={canCreate}
              canDelete={false}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function SdKbArchivedList({ workspaceId, canDelete }: SdKbTreeProps) {
  const { data, isLoading } = useSdKbArticles(workspaceId, true)
  const restore = useRestoreSdKbArticle(workspaceId)
  const remove = useDeleteSdKbArticle(workspaceId)

  if (isLoading) return <Skeleton className='mx-2.5 mt-1 h-6' />
  if (!data?.length) {
    return <Muted className='px-2.5 py-1 text-xs'>Nada arquivado.</Muted>
  }

  return (
    <ul className='mt-1 space-y-0.5' aria-label='Artigos arquivados'>
      {data.map((article: SdKbArticleSummaryDTO) => (
        <li
          key={article.id}
          className='flex items-center gap-1 rounded-md px-2.5 py-1 text-muted-foreground text-sm'
        >
          <span className='min-w-0 flex-1 truncate'>
            {article.title || 'Sem título'}
          </span>
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={`Restaurar ${article.title || 'Sem título'}`}
            onClick={() =>
              restore.mutate(article.id, {
                onSuccess: () => notify.success('Artigo restaurado'),
                onError: notify.error,
              })
            }
          >
            <SteelIcon icon={RestoreBinIcon} strokeWidth={2} />
          </Button>
          {canDelete && (
            <Button
              variant='ghost'
              size='icon-xs'
              aria-label={`Excluir ${article.title || 'Sem título'} definitivamente`}
              onClick={() => {
                if (
                  window.confirm(
                    'Excluir definitivamente este artigo e os subartigos? Esta ação não pode ser desfeita.',
                  )
                ) {
                  remove.mutate(article.id, {
                    onSuccess: () => notify.success('Artigo excluído'),
                    onError: notify.error,
                  })
                }
              }}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

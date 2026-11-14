'use client'

import {
  BrainIcon,
  Delete02Icon,
  PencilEdit02Icon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SteelAiNotice } from '@/app/_components/steel-ai/steel-ai-notice'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useAiMemories,
  useCreateAiMemory,
  useDeleteAiMemory,
  useUpdateAiMemory,
} from '@/src/hooks/use-ai-memory'
import { MEMORY_MAX_CHARS } from '@/src/lib/ai/context/memory-guard'
import type { AiMemoryDTO, AiMemoryScopeDTO } from '@/types/ai-memory'

/** Dates in the workspace's default zone (never the browser's). */
const DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
})

export function formatMemoryDate(iso: string): string {
  return DATE.format(new Date(iso))
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

function MemoryItem({
  memory,
  slug,
  workspaceId,
}: {
  memory: AiMemoryDTO
  slug: string
  workspaceId: string
}) {
  const update = useUpdateAiMemory(workspaceId)
  const remove = useDeleteAiMemory(workspaceId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(memory.content)

  async function save() {
    const content = draft.trim()
    if (!content) return
    try {
      await update.mutateAsync({ id: memory.id, content })
      setEditing(false)
    } catch (error) {
      notify.error(errorMessage(error, 'Não foi possível salvar.'))
    }
  }

  async function destroy() {
    try {
      await remove.mutateAsync(memory.id)
      notify.success('Memória apagada')
    } catch (error) {
      notify.error(errorMessage(error, 'Não foi possível apagar.'))
    }
  }

  return (
    <li className='space-y-1.5 px-4 py-3'>
      {editing ? (
        <form
          className='space-y-2'
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <Textarea
            aria-label='Editar memória'
            value={draft}
            rows={2}
            maxLength={MEMORY_MAX_CHARS}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(memory.content)
                setEditing(false)
              }
            }}
          />
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => {
                setDraft(memory.content)
                setEditing(false)
              }}
            >
              Cancelar
            </Button>
            <Button
              type='submit'
              size='sm'
              disabled={update.isPending || !draft.trim()}
            >
              Salvar
            </Button>
          </div>
        </form>
      ) : (
        <div className='flex items-start gap-2'>
          <p className='min-w-0 flex-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]'>
            {memory.content}
          </p>
          {memory.canEdit ? (
            <div className='-mt-1 flex shrink-0 items-center'>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Editar memória'
                onClick={() => setEditing(true)}
              >
                <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Apagar memória'
                disabled={remove.isPending}
                onClick={destroy}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
          ) : null}
        </div>
      )}
      <p className='flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs'>
        <Badge variant={memory.source === 'AUTO' ? 'secondary' : 'outline'}>
          {memory.source === 'AUTO' ? 'Automática' : 'Manual'}
        </Badge>
        <span>{formatMemoryDate(memory.updatedAt)}</span>
        {memory.lastUsedAt ? (
          <span>· usada em {formatMemoryDate(memory.lastUsedAt)}</span>
        ) : null}
        {memory.sourceConversationId ? (
          <Link
            href={`/${slug}/ai/${memory.sourceConversationId}`}
            className='font-medium text-primary underline-offset-2 hover:underline'
          >
            Ver conversa
          </Link>
        ) : null}
      </p>
    </li>
  )
}

function AddMemory({
  workspaceId,
  scope,
}: {
  workspaceId: string
  scope: AiMemoryScopeDTO
}) {
  const create = useCreateAiMemory(workspaceId)
  const [content, setContent] = useState('')
  const label =
    scope === 'WORKSPACE' ? 'Novo fato do workspace' : 'Novo fato pessoal'

  async function add() {
    const text = content.trim()
    if (!text) return
    try {
      await create.mutateAsync({ scope, content: text })
      setContent('')
    } catch (error) {
      notify.error(errorMessage(error, 'Não foi possível salvar.'))
    }
  }

  return (
    <form
      className='flex flex-col gap-2 border-border/70 border-t px-4 py-3 sm:flex-row'
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
    >
      <Textarea
        aria-label={label}
        value={content}
        rows={1}
        maxLength={MEMORY_MAX_CHARS}
        placeholder={
          scope === 'WORKSPACE'
            ? 'Ex.: O suporte atende das 8h às 18h, de segunda a sexta.'
            : 'Ex.: Prefiro respostas curtas, em tópicos.'
        }
        onChange={(event) => setContent(event.target.value)}
        className='field-sizing-content min-h-9 resize-none'
      />
      <Button
        type='submit'
        size='sm'
        variant='outline'
        className='shrink-0 sm:self-start'
        disabled={create.isPending || !content.trim()}
      >
        Adicionar
      </Button>
    </form>
  )
}

function MemorySection({
  title,
  description,
  scope,
  items,
  canAdd,
  emptyText,
  slug,
  workspaceId,
}: {
  title: string
  description: string
  scope: AiMemoryScopeDTO
  items: AiMemoryDTO[]
  canAdd: boolean
  emptyText: string
  slug: string
  workspaceId: string
}) {
  const id = `memory-${scope.toLowerCase()}`
  return (
    <section aria-labelledby={id} className='space-y-2'>
      <div className='space-y-0.5'>
        <h2 id={id} className='font-medium text-sm'>
          {title}{' '}
          <span className='font-normal text-muted-foreground'>
            ({items.length})
          </span>
        </h2>
        <p className='text-muted-foreground text-xs'>{description}</p>
      </div>
      <div className='overflow-hidden rounded-xl border border-border/80 bg-card'>
        {items.length === 0 ? (
          <p className='px-4 py-4 text-muted-foreground text-sm'>{emptyText}</p>
        ) : (
          <ul className='divide-y divide-border/70'>
            {items.map((memory) => (
              <MemoryItem
                key={memory.id}
                memory={memory}
                slug={slug}
                workspaceId={workspaceId}
              />
            ))}
          </ul>
        )}
        {canAdd ? <AddMemory workspaceId={workspaceId} scope={scope} /> : null}
      </div>
    </section>
  )
}

/** `/ai/memory` — what Steel AI remembers, to review, edit and delete. */
export function SteelAiMemoryPage({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  // Debounced so typing does not fire a request per key.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250)
    return () => clearTimeout(timer)
  }, [query])
  const memories = useAiMemories(workspaceId, search)
  const data = memories.data
  const enabled = data?.memoryEnabled ?? true
  const searching = search.trim().length > 0

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar title='Memória' />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-6 px-4 pt-2 pb-8 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <h1 className='font-semibold text-lg'>Memória</h1>
            <p className='max-w-prose text-muted-foreground text-sm'>
              Fatos que o Steel AI guarda para as próximas conversas — ele salva
              sozinho o que parece útil, e você revisa, corrige ou apaga aqui.
              Senhas, documentos e dados pessoais sensíveis nunca são guardados.
            </p>
          </header>

          {data && !enabled ? (
            <SteelAiNotice tone='info' icon={BrainIcon}>
              A memória está desligada neste workspace: o Steel AI não salva nem
              usa estes fatos.
              {data.canManageWorkspace
                ? ' Ative em Ajustes > Steel IA.'
                : ' Um administrador pode ativá-la em Ajustes > Steel IA.'}{' '}
              Você ainda pode revisar e apagar o que já foi guardado.
            </SteelAiNotice>
          ) : null}

          <InputGroup data-tour='memory-search'>
            <InputGroupAddon>
              <SteelIcon icon={Search01Icon} strokeWidth={2} />
            </InputGroupAddon>
            <InputGroupInput
              type='search'
              aria-label='Buscar na memória'
              placeholder='Buscar na memória'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>

          {memories.isLoading ? (
            <div className='space-y-2' aria-hidden>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className='h-20 rounded-xl' />
              ))}
            </div>
          ) : memories.isError || !data ? (
            <p className='text-destructive text-sm'>
              Não foi possível carregar a memória.
            </p>
          ) : (
            <>
              <div data-tour='memory-workspace'>
                <MemorySection
                  title='Workspace'
                  description='Vale para todos do workspace. Só administradores editam.'
                  scope='WORKSPACE'
                  items={data.workspace}
                  canAdd={enabled && data.canManageWorkspace && !searching}
                  emptyText={
                    searching
                      ? 'Nada encontrado.'
                      : 'Nenhum fato do workspace ainda.'
                  }
                  slug={slug}
                  workspaceId={workspaceId}
                />
              </div>
              <div data-tour='memory-personal'>
                <MemorySection
                  title='Pessoal'
                  description='Só você e o Steel AI, nas suas conversas.'
                  scope='PERSONAL'
                  items={data.personal}
                  canAdd={enabled && !searching}
                  emptyText={
                    searching
                      ? 'Nada encontrado.'
                      : 'Nenhum fato pessoal ainda. Conte ao Steel AI suas preferências e ele lembra.'
                  }
                  slug={slug}
                  workspaceId={workspaceId}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

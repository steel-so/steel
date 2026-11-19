'use client'

import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { SimpleSelect } from '@/app/_components/crm/simple-select'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateCrmSegment,
  useCrmSegmentOptions,
  useCrmSegmentPreview,
  useCrmSegments,
  useDeleteCrmSegment,
  useDuplicateCrmSegment,
  useUpdateCrmSegment,
} from '@/src/hooks/use-crm-segments'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import { useDebouncedValue } from '@/src/hooks/use-global-search'
import {
  allSegmentConditions,
  CRM_SEGMENT_TARGETS,
  type CrmSegmentDefinition,
  type CrmSegmentDTO,
  type CrmSegmentTarget,
  EMPTY_SEGMENT_DEFINITION,
  PreviewCrmSegmentSchema,
} from '@/src/schemas/crm-segment.schema'
import { SegmentBuilder } from './segment-builder'
import {
  pruneDefinition,
  TARGET_LABEL,
  TARGET_SINGULAR,
} from './segment-labels'

const LOOKUP_KINDS: LookupKind[] = ['users', 'companies']

type Draft = {
  id: string | null
  name: string
  description: string
  target: CrmSegmentTarget
  definition: CrmSegmentDefinition
}

const NEW_DRAFT: Draft = {
  id: null,
  name: '',
  description: '',
  target: 'PERSON',
  definition: EMPTY_SEGMENT_DEFINITION,
}

const TARGET_ITEMS = CRM_SEGMENT_TARGETS.map((target) => ({
  value: target,
  label: TARGET_LABEL[target],
}))

function ruleCount(segment: CrmSegmentDTO): number {
  return allSegmentConditions(segment.definition).length
}

function Preview({
  workspaceId,
  target,
  definition,
}: {
  workspaceId: string
  target: CrmSegmentTarget
  definition: CrmSegmentDefinition
}) {
  const input = useMemo(() => ({ target, definition }), [target, definition])
  const debounced = useDebouncedValue(input, 500)
  const parsed = PreviewCrmSegmentSchema.safeParse(debounced)
  const preview = useCrmSegmentPreview(
    workspaceId,
    debounced.target,
    debounced.definition,
    parsed.success,
  )

  if (!parsed.success) {
    return (
      <p className='text-muted-foreground text-sm'>
        {parsed.error.issues[0]?.message ??
          'Complete as regras para ver os contatos.'}
      </p>
    )
  }
  if (preview.isError) {
    return (
      <div role='alert' className='flex flex-col items-start gap-2 text-sm'>
        <span>Não foi possível contar os contatos.</span>
        <Button size='sm' variant='outline' onClick={() => preview.refetch()}>
          Tentar de novo
        </Button>
      </div>
    )
  }
  if (!preview.data) return <Skeleton className='h-40 w-full' />

  const { total, sample } = preview.data
  return (
    <div className='flex flex-col gap-3'>
      <p>
        <span className='font-semibold text-3xl tabular-nums'>{total}</span>{' '}
        <span className='text-muted-foreground text-sm'>
          {total === 1
            ? TARGET_SINGULAR[target]
            : TARGET_LABEL[target].toLowerCase()}{' '}
          no segmento
        </span>
      </p>
      {sample.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Nenhum contato cumpre estas regras.
        </p>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {sample.map((contact) => (
            <li key={contact.id} className='flex flex-col px-3 py-2 text-sm'>
              <span className='truncate font-medium'>{contact.name}</span>
              <span className='truncate text-muted-foreground text-xs'>
                {[contact.email, contact.phone].filter(Boolean).join(' · ') ||
                  'Sem e-mail nem telefone'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > sample.length ? (
        <p className='text-muted-foreground text-xs'>
          Mostrando {sample.length} de {total}. O público é recalculado a cada
          envio.
        </p>
      ) : null}
    </div>
  )
}

function SegmentEditor({
  workspaceId,
  initial,
  onClose,
}: {
  workspaceId: string
  initial: Draft
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft>(initial)
  const options = useCrmSegmentOptions(workspaceId)
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const create = useCreateCrmSegment(workspaceId)
  const update = useUpdateCrmSegment(workspaceId)

  const builderLookups = useMemo(
    () => ({
      users: lookups.options.users,
      companies: lookups.options.companies,
      options: options.data,
    }),
    [lookups.options.users, lookups.options.companies, options.data],
  )

  const parsed = PreviewCrmSegmentSchema.safeParse({
    target: draft.target,
    definition: draft.definition,
  })
  const nameError =
    draft.name.trim() === '' ? 'Informe o nome do segmento' : null
  const saving = create.isPending || update.isPending
  const canSave = parsed.success && !nameError && !saving

  function save() {
    if (!parsed.success || nameError) return
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      target: draft.target,
      definition: parsed.data.definition,
    }
    const done = () => {
      notify.success('Segmento salvo')
      onClose()
    }
    if (draft.id) {
      update.mutate(
        { id: draft.id, ...body },
        { onSuccess: done, onError: notify.error },
      )
    } else {
      create.mutate(body, { onSuccess: done, onError: notify.error })
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='font-semibold text-lg'>
          {draft.id ? 'Editar segmento' : 'Novo segmento'}
        </h2>
        <div className='flex gap-2'>
          <Button variant='ghost' onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? 'Salvando…' : 'Salvar segmento'}
          </Button>
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]'>
        <div className='flex min-w-0 flex-col gap-5'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='segment-name'>Nome</Label>
              <Input
                id='segment-name'
                value={draft.name}
                maxLength={80}
                placeholder='Ex.: Clientes que compraram em 2026'
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label>Quem entra no segmento</Label>
              <SimpleSelect
                ariaLabel='Tipo de contato'
                value={draft.target}
                items={TARGET_ITEMS}
                onChange={(next) => {
                  const target = next as CrmSegmentTarget
                  const definition = pruneDefinition(draft.definition, target)
                  if (
                    allSegmentConditions(definition).length <
                    allSegmentConditions(draft.definition).length
                  ) {
                    notify.info(
                      'Algumas regras não valem para este tipo e foram removidas',
                    )
                  }
                  setDraft({ ...draft, target, definition })
                }}
              />
            </div>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='segment-description'>Descrição (opcional)</Label>
            <Textarea
              id='segment-description'
              rows={2}
              maxLength={300}
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </div>

          <SegmentBuilder
            target={draft.target}
            value={draft.definition}
            lookups={builderLookups}
            onChange={(definition) => setDraft({ ...draft, definition })}
          />
        </div>

        <aside
          aria-label='Prévia do segmento'
          className='h-fit rounded-xl border bg-muted/30 p-4 lg:sticky lg:top-4'
        >
          <h3 className='mb-3 font-medium text-sm'>Prévia ao vivo</h3>
          <Preview
            workspaceId={workspaceId}
            target={draft.target}
            definition={draft.definition}
          />
        </aside>
      </div>
    </div>
  )
}

function SegmentCard({
  segment,
  onEdit,
  onDuplicate,
  onDelete,
  busy,
}: {
  segment: CrmSegmentDTO
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  busy: boolean
}) {
  const rules = ruleCount(segment)
  return (
    <li className='flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4'>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <button
            type='button'
            onClick={onEdit}
            className='truncate font-medium hover:underline'
          >
            {segment.name}
          </button>
          <Badge variant='outline'>{TARGET_LABEL[segment.target]}</Badge>
          {!segment.valid ? (
            <Badge variant='destructive'>Revisar regras</Badge>
          ) : null}
        </div>
        <p className='truncate text-muted-foreground text-xs'>
          {segment.description ||
            (rules === 0
              ? 'Sem regras: todos os contatos'
              : `${rules} regra${rules === 1 ? '' : 's'}`)}
        </p>
      </div>
      <div className='flex items-center gap-1'>
        <Button variant='outline' size='sm' onClick={onEdit}>
          <SteelIcon icon={PencilEdit02Icon} className='size-4' />
          Editar
        </Button>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={`Duplicar ${segment.name}`}
          disabled={busy}
          onClick={onDuplicate}
        >
          <SteelIcon icon={Copy01Icon} className='size-4' />
        </Button>
        <ConfirmAction
          trigger={
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={`Excluir ${segment.name}`}
              disabled={busy}
            >
              <SteelIcon icon={Delete02Icon} className='size-4' />
            </Button>
          }
          title='Excluir este segmento?'
          description='Campanhas que o usam deixam de enviar para ele. Não dá para desfazer.'
          onConfirm={onDelete}
        />
      </div>
    </li>
  )
}

export function CrmSegmentsView({ workspaceId }: { workspaceId: string }) {
  const list = useCrmSegments(workspaceId)
  const duplicate = useDuplicateCrmSegment(workspaceId)
  const remove = useDeleteCrmSegment(workspaceId)
  const [editing, setEditing] = useState<Draft | null>(null)

  if (editing) {
    return (
      <div className='h-full overflow-y-auto p-4 md:p-6'>
        <SegmentEditor
          key={editing.id ?? 'new'}
          workspaceId={workspaceId}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      </div>
    )
  }

  const segments = list.data ?? []

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 md:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h2 className='font-semibold text-lg'>Segmentação</h2>
          <p className='text-muted-foreground text-sm'>
            Públicos que se atualizam sozinhos, a partir de regras. Use em
            campanhas e e-mails.
          </p>
        </div>
        <Button onClick={() => setEditing(NEW_DRAFT)}>
          <SteelIcon icon={Add01Icon} className='size-4' />
          Novo segmento
        </Button>
      </div>

      {list.isLoading ? (
        <div className='flex flex-col gap-2'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : list.isError ? (
        <div
          role='alert'
          className='flex flex-col items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm'
        >
          <span>Não foi possível carregar os segmentos.</span>
          <Button size='sm' variant='outline' onClick={() => list.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : segments.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center'>
          <p className='font-medium'>Nenhum segmento ainda</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Crie um segmento para falar só com quem importa: por exemplo, leads
            qualificados que abriram e-mails no último mês.
          </p>
          <Button onClick={() => setEditing(NEW_DRAFT)}>
            <SteelIcon icon={Add01Icon} className='size-4' />
            Criar o primeiro segmento
          </Button>
        </div>
      ) : (
        <ul className='flex flex-col gap-2'>
          {segments.map((segment) => (
            <SegmentCard
              key={segment.id}
              segment={segment}
              busy={duplicate.isPending || remove.isPending}
              onEdit={() =>
                setEditing({
                  id: segment.id,
                  name: segment.name,
                  description: segment.description ?? '',
                  target: segment.target,
                  definition: segment.definition,
                })
              }
              onDuplicate={() =>
                duplicate.mutate(segment.id, {
                  onSuccess: () => notify.success('Segmento duplicado'),
                  onError: notify.error,
                })
              }
              onDelete={() =>
                remove.mutate(segment.id, {
                  onSuccess: () => notify.success('Segmento excluído'),
                  onError: notify.error,
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

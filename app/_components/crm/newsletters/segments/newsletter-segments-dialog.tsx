'use client'

import {
  Add01Icon,
  Delete02Icon,
  FilterIcon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCreateCrmNewsletterSegment,
  useCrmNewsletterSegmentOptions,
  useCrmNewsletterSegments,
  useDeleteCrmNewsletterSegment,
  useUpdateCrmNewsletterSegment,
} from '@/src/hooks/use-crm-newsletter-segments'
import {
  CRM_NEWSLETTER_SEGMENTS_PER_NEWSLETTER,
  type CrmNewsletterSegmentDTO,
  type NewsletterSegment,
  NewsletterSegmentSchema,
} from '@/src/schemas/crm-newsletter-segment.schema'
import { SegmentBuilder } from './segment-builder'
import {
  describeSegment,
  EMPTY_SEGMENT,
  segmentCompanyIds,
} from './segment-labels'

/**
 * "Segmentos" of the newsletter page (slice nl2-segments): saved audience
 * segments, reusable in the "Público" of every issue.
 */

type Editing = {
  id: string | null
  name: string
  definition: NewsletterSegment
}

function SegmentEditor({
  workspaceId,
  newsletterId,
  editing,
  onChange,
  onDone,
}: {
  workspaceId: string
  newsletterId: string
  editing: Editing
  onChange: (editing: Editing) => void
  onDone: () => void
}) {
  const nameId = useId()
  const create = useCreateCrmNewsletterSegment(workspaceId, newsletterId)
  const update = useUpdateCrmNewsletterSegment(workspaceId, newsletterId)
  const parsed = NewsletterSegmentSchema.safeParse(editing.definition)
  const hasConditions =
    editing.definition.conditions.length > 0 ||
    editing.definition.groups.length > 0
  const canSave =
    editing.name.trim().length > 0 && parsed.success && hasConditions
  const pending = create.isPending || update.isPending

  function submit() {
    if (!canSave || !parsed.success) return
    const handlers = {
      onSuccess: () => {
        notify.success('Segmento salvo')
        onDone()
      },
      onError: (error: Error) => notify.error(error),
    }
    if (editing.id) {
      update.mutate(
        {
          segmentId: editing.id,
          name: editing.name.trim(),
          definition: parsed.data,
        },
        handlers,
      )
    } else {
      create.mutate(
        { name: editing.name.trim(), definition: parsed.data },
        handlers,
      )
    }
  }

  return (
    <div className='grid min-w-0 gap-4'>
      <div className='grid gap-1.5'>
        <Label htmlFor={nameId}>Nome</Label>
        <Input
          id={nameId}
          value={editing.name}
          maxLength={80}
          placeholder='Ex.: Clientes engajados'
          onChange={(event) =>
            onChange({ ...editing, name: event.target.value })
          }
        />
      </div>
      <div className='grid gap-1.5'>
        <span className='font-medium text-sm'>Condições</span>
        <SegmentBuilder
          workspaceId={workspaceId}
          newsletterId={newsletterId}
          value={editing.definition}
          onChange={(definition) => onChange({ ...editing, definition })}
        />
        {!hasConditions ? (
          <p className='text-muted-foreground text-xs'>
            Adicione ao menos uma condição.
          </p>
        ) : !parsed.success ? (
          <p className='text-destructive text-xs' role='alert'>
            Complete as condições: {parsed.error.issues[0]?.message}
          </p>
        ) : null}
      </div>
      <DialogFooter className='gap-2'>
        <Button variant='ghost' onClick={onDone}>
          Voltar
        </Button>
        <Button
          onClick={submit}
          disabled={!canSave || pending}
          data-testid='segment-save'
        >
          {pending ? 'Salvando…' : 'Salvar segmento'}
        </Button>
      </DialogFooter>
    </div>
  )
}

function SegmentList({
  workspaceId,
  newsletterId,
  segments,
  onEdit,
}: {
  workspaceId: string
  newsletterId: string
  segments: CrmNewsletterSegmentDTO[]
  onEdit: (segment: CrmNewsletterSegmentDTO) => void
}) {
  const remove = useDeleteCrmNewsletterSegment(workspaceId, newsletterId)
  const [confirming, setConfirming] = useState<string | null>(null)
  const options = useCrmNewsletterSegmentOptions(
    workspaceId,
    newsletterId,
    '',
    segments.flatMap((segment) => segmentCompanyIds(segment.definition)),
  )

  if (segments.length === 0) {
    return (
      <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Nenhum segmento salvo. Crie um para enviar edições só para parte dos
        assinantes.
      </p>
    )
  }
  return (
    <ul className='grid gap-2'>
      {segments.map((segment) => (
        <li
          key={segment.id}
          className='flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start'
        >
          <div className='min-w-0 flex-1'>
            <p className='truncate font-medium text-sm'>{segment.name}</p>
            <p className='text-muted-foreground text-xs'>
              {segment.valid
                ? describeSegment(segment.definition, options.data)
                : 'As condições deste segmento não são mais válidas. Edite para corrigir.'}
            </p>
          </div>
          <div className='flex shrink-0 gap-1'>
            {confirming === segment.id ? (
              <>
                <Button
                  size='sm'
                  variant='destructive'
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(segment.id, {
                      onSuccess: () => {
                        notify.success('Segmento excluído')
                        setConfirming(null)
                      },
                      onError: (error) => notify.error(error),
                    })
                  }
                >
                  Excluir
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => setConfirming(null)}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  aria-label={`Editar ${segment.name}`}
                  onClick={() => onEdit(segment)}
                >
                  <SteelIcon icon={PencilEdit02Icon} />
                </Button>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  aria-label={`Excluir ${segment.name}`}
                  onClick={() => setConfirming(segment.id)}
                >
                  <SteelIcon icon={Delete02Icon} />
                </Button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Header button of the newsletter page + the management dialog. */
export function NewsletterSegmentsButton({
  workspaceId,
  newsletterId,
}: {
  workspaceId: string
  newsletterId: string
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const segments = useCrmNewsletterSegments(workspaceId, newsletterId)
  const list = segments.data ?? []
  const full = list.length >= CRM_NEWSLETTER_SEGMENTS_PER_NEWSLETTER

  return (
    <>
      <Button
        size='sm'
        variant='outline'
        onClick={() => setOpen(true)}
        data-testid='newsletter-segments'
      >
        <SteelIcon icon={FilterIcon} strokeWidth={2} />
        Segmentos
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setEditing(null)
        }}
      >
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? editing.id
                  ? 'Editar segmento'
                  : 'Novo segmento'
                : 'Segmentos'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Edições que já usam este segmento guardaram uma cópia das condições e não mudam.'
                : 'Públicos salvos para escolher na hora de enviar uma edição.'}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <SegmentEditor
              workspaceId={workspaceId}
              newsletterId={newsletterId}
              editing={editing}
              onChange={setEditing}
              onDone={() => setEditing(null)}
            />
          ) : segments.isLoading ? (
            <Skeleton className='h-24 w-full' />
          ) : (
            <div className='grid gap-4'>
              <SegmentList
                workspaceId={workspaceId}
                newsletterId={newsletterId}
                segments={list}
                onEdit={(segment) =>
                  setEditing({
                    id: segment.id,
                    name: segment.name,
                    definition: segment.definition,
                  })
                }
              />
              <DialogFooter>
                <Button
                  disabled={full}
                  title={
                    full
                      ? `Limite de ${CRM_NEWSLETTER_SEGMENTS_PER_NEWSLETTER} segmentos por newsletter`
                      : undefined
                  }
                  onClick={() =>
                    setEditing({
                      id: null,
                      name: '',
                      definition: EMPTY_SEGMENT,
                    })
                  }
                >
                  <SteelIcon icon={Add01Icon} strokeWidth={2} />
                  Novo segmento
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

'use client'

import {
  Delete02Icon,
  PencilEdit01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { ColorSwatchPicker } from '@/app/_components/ui/color-swatch-picker'
import { WIKI_LABEL_TONE } from '@/app/_components/wiki/wiki-label-colors'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateWikiLabel,
  useDeleteWikiLabel,
  useUpdateWikiLabel,
  useUpdateWikiSettings,
  useWikiLabels,
  useWikiSettings,
} from '@/src/hooks/use-wiki-page'
import {
  WIKI_LABEL_COLORS,
  type WikiLabelColor,
} from '@/src/schemas/wiki-label.schema'
import type { WikiLabelDTO } from '@/types/wiki-label'
import { useIsWorkspaceAdmin } from '../workspace/workspace-permissions'

const COLOR_OPTIONS = WIKI_LABEL_COLORS.map((value) => ({
  value,
  bg: WIKI_LABEL_TONE[value].dot,
}))

export function WikiSettingsSection({ workspaceId }: { workspaceId: string }) {
  const isAdmin = useIsWorkspaceAdmin() === true

  return (
    <div className='space-y-6'>
      <WikiToggleCard workspaceId={workspaceId} canEdit={isAdmin} />
      <WikiLabelsCard workspaceId={workspaceId} canEdit={isAdmin} />
    </div>
  )
}

export function WikiToggleCard({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const router = useRouter()
  const { data, isPending } = useWikiSettings(workspaceId)
  const update = useUpdateWikiSettings(workspaceId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wiki do workspace</CardTitle>
        <CardDescription>
          Páginas colaborativas em tempo real para a equipe documentar
          processos, decisões e conhecimento. Ao ativar, o botão Wiki aparece no
          menu lateral para todos os membros.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex items-center justify-between gap-4'>
        <Label htmlFor='wiki-enabled' className='flex flex-col items-start'>
          <span>Ativar Wiki</span>
          {!canEdit && (
            <Muted className='text-xs font-normal'>
              Só proprietários e administradores podem alterar.
            </Muted>
          )}
        </Label>
        {isPending ? (
          <Skeleton className='h-5 w-9 rounded-full' />
        ) : (
          <Switch
            id='wiki-enabled'
            checked={data?.enabled ?? false}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(enabled) =>
              update.mutate(
                { enabled },
                {
                  onSuccess: () => {
                    notify.success(enabled ? 'Wiki ativada' : 'Wiki desativada')
                    // The rail entry is rendered by the workspace layout.
                    router.refresh()
                  },
                  onError: notify.error,
                },
              )
            }
          />
        )}
      </CardContent>
    </Card>
  )
}

export function WikiLabelsCard({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const { data: labels, isPending, isError } = useWikiLabels(workspaceId)
  const [deleting, setDeleting] = useState<WikiLabelDTO | null>(null)
  const remove = useDeleteWikiLabel(workspaceId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Etiquetas</CardTitle>
        <CardDescription>
          Organize as páginas da Wiki por assunto. Qualquer membro aplica as
          etiquetas em uma página; criar, editar e excluir fica com
          proprietários e administradores.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {canEdit && <WikiLabelCreateForm workspaceId={workspaceId} />}
        {isPending ? (
          <div className='space-y-2'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        ) : isError ? (
          <Muted>Não foi possível carregar as etiquetas.</Muted>
        ) : labels.length === 0 ? (
          <Muted>Nenhuma etiqueta ainda.</Muted>
        ) : (
          <ul className='divide-y divide-border rounded-md border border-border'>
            {labels.map((label) => (
              <WikiLabelRow
                key={label.id}
                label={label}
                workspaceId={workspaceId}
                canEdit={canEdit}
                onDelete={() => setDeleting(label)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir a etiqueta “{deleting?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.pageCount
                ? `Ela sai das ${deleting.pageCount} página(s) que a usam. As páginas continuam na Wiki.`
                : 'Nenhuma página usa esta etiqueta.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return
                remove.mutate(deleting.id, {
                  onSuccess: () => {
                    notify.success('Etiqueta excluída')
                    setDeleting(null)
                  },
                  onError: notify.error,
                })
              }}
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function ColorTrigger({ color }: { color: WikiLabelColor }) {
  return (
    <Button
      type='button'
      variant='outline'
      size='icon'
      aria-label={`Cor: ${WIKI_LABEL_TONE[color].label}`}
    >
      <span
        className={cn('size-3.5 rounded-full', WIKI_LABEL_TONE[color].dot)}
      />
    </Button>
  )
}

function WikiLabelCreateForm({ workspaceId }: { workspaceId: string }) {
  const create = useCreateWikiLabel(workspaceId)
  const [name, setName] = useState('')
  const [color, setColor] = useState<WikiLabelColor>('blue')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          notify.success('Etiqueta criada')
          setName('')
        },
        onError: notify.error,
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='flex items-center gap-2'>
      <ColorSwatchPicker
        colors={COLOR_OPTIONS}
        value={color}
        onChange={setColor}
        trigger={<ColorTrigger color={color} />}
      />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder='Nova etiqueta'
        aria-label='Nome da nova etiqueta'
        maxLength={40}
        className='flex-1'
      />
      <Button type='submit' disabled={!name.trim() || create.isPending}>
        Criar
      </Button>
    </form>
  )
}

function WikiLabelRow({
  label,
  workspaceId,
  canEdit,
  onDelete,
}: {
  label: WikiLabelDTO
  workspaceId: string
  canEdit: boolean
  onDelete: () => void
}) {
  const update = useUpdateWikiLabel(workspaceId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(label.name)

  function save(data: { name?: string; color?: WikiLabelColor }) {
    update.mutate(
      { labelId: label.id, ...data },
      { onSuccess: () => setEditing(false), onError: notify.error },
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === label.name) {
      setName(label.name)
      setEditing(false)
      return
    }
    save({ name: trimmed })
  }

  return (
    <li className='flex items-center gap-3 px-3 py-2'>
      {canEdit ? (
        <ColorSwatchPicker
          colors={COLOR_OPTIONS}
          value={label.color}
          onChange={(color) => save({ color })}
          trigger={<ColorTrigger color={label.color} />}
        />
      ) : (
        <span
          className={cn(
            'size-3.5 shrink-0 rounded-full',
            WIKI_LABEL_TONE[label.color].dot,
          )}
        />
      )}
      {editing ? (
        <form onSubmit={handleSubmit} className='flex flex-1 gap-2'>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={handleSubmit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setName(label.name)
                setEditing(false)
              }
            }}
            aria-label='Nome da etiqueta'
            maxLength={40}
          />
        </form>
      ) : (
        <span className='flex-1 truncate text-sm'>{label.name}</span>
      )}
      <Muted className='shrink-0 text-xs'>
        {label.pageCount === 1 ? '1 página' : `${label.pageCount} páginas`}
      </Muted>
      {canEdit && !editing && (
        <div className='flex shrink-0 items-center'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={`Renomear ${label.name}`}
            onClick={() => setEditing(true)}
          >
            <SteelIcon icon={PencilEdit01Icon} strokeWidth={2} />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={`Excluir ${label.name}`}
            onClick={onDelete}
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      )}
    </li>
  )
}

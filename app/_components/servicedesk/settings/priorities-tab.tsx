'use client'

import {
  PencilEdit02Icon,
  PlusSignIcon,
  SparklesIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  type SdConfigResource,
  useSaveSdPriorityMatrix,
  useSdConfigList,
  useSdConfigMutations,
  useSdPriorityMatrix,
} from '@/src/hooks/use-sd-config'
import type {
  CreateSdScaleItemDTO,
  UpdateSdScaleItemDTO,
} from '@/src/schemas/sd-priority.schema'
import type { SdPriorityMatrixCellDTO, SdScaleItemDTO } from '@/types/sd-config'
import {
  ColorDot,
  ColorInput,
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  NumberInput,
  SettingsSection,
  SimpleSelect,
  useSdSettingsContext,
} from './sd-settings-kit'

interface ScaleSpec {
  resource: Extract<
    SdConfigResource,
    'impacts' | 'urgencies' | 'priorities' | 'severities'
  >
  title: string
  singular: string
  /** Placeholder for the add field: the noun's gender decides "Novo"/"Nova". */
  newLabel: string
  description: string
  hasColor: boolean
  hasDescription: boolean
  hasDefault: boolean
}

const SCALES: ScaleSpec[] = [
  {
    resource: 'impacts',
    title: 'Impacto',
    singular: 'impacto',
    newLabel: 'Novo impacto',
    description: 'Quanto do negócio é afetado. Nível maior = mais impacto.',
    hasColor: false,
    hasDescription: true,
    hasDefault: false,
  },
  {
    resource: 'urgencies',
    title: 'Urgência',
    singular: 'urgência',
    newLabel: 'Nova urgência',
    description: 'Quão rápido precisa de solução. Nível maior = mais urgente.',
    hasColor: false,
    hasDescription: true,
    hasDefault: false,
  },
  {
    resource: 'priorities',
    title: 'Prioridade',
    singular: 'prioridade',
    newLabel: 'Nova prioridade',
    description:
      'Derivada da matriz ou escolhida manualmente. Nível maior = mais prioritário.',
    hasColor: true,
    hasDescription: false,
    hasDefault: true,
  },
  {
    resource: 'severities',
    title: 'Severidade',
    singular: 'severidade',
    newLabel: 'Nova severidade',
    description: 'Gravidade técnica, independente da prioridade.',
    hasColor: true,
    hasDescription: true,
    hasDefault: false,
  },
]

export function SdPrioritiesTab() {
  return (
    <div className='flex flex-col gap-5'>
      <div className='grid gap-5 lg:grid-cols-2'>
        {SCALES.map((spec) => (
          <ScaleEditor key={spec.resource} spec={spec} />
        ))}
      </div>
      <MatrixEditor />
    </div>
  )
}

function ScaleEditor({ spec }: { spec: ScaleSpec }) {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const { data, isLoading } = useSdConfigList<SdScaleItemDTO>(
    workspaceId,
    spec.resource,
  )
  const mutations = useSdConfigMutations<
    SdScaleItemDTO,
    CreateSdScaleItemDTO,
    UpdateSdScaleItemDTO
  >(workspaceId, spec.resource)
  const items = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.level - b.level),
    [data],
  )
  const nextLevel = (items.at(-1)?.level ?? 0) + 1
  const [name, setName] = useState('')
  const [level, setLevel] = useState<number | null>(null)
  const [color, setColor] = useState<string>('#6366f1')
  const [editing, setEditing] = useState<SdScaleItemDTO | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await mutations.create.mutateAsync({
        name: name.trim(),
        level: level ?? nextLevel,
        isDefault: false,
        ...(spec.hasColor ? { color } : {}),
      })
      setName('')
      setLevel(null)
    } catch (err) {
      notify.error(err)
    }
  }

  async function makeDefault(item: SdScaleItemDTO) {
    try {
      await mutations.update.mutateAsync({
        id: item.id,
        data: { isDefault: true },
      })
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection title={spec.title} description={spec.description}>
      {!isLoading && items.length === 0 ? (
        <EmptyState>Nenhum item cadastrado.</EmptyState>
      ) : (
        <ul className='flex flex-col gap-1.5'>
          {items.map((item) => (
            <li
              key={item.id}
              className='flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2'
            >
              <Badge variant='outline' className='tabular-nums'>
                {item.level}
              </Badge>
              {spec.hasColor ? <ColorDot color={item.color} /> : null}
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-sm font-medium'>
                  {item.name}
                </span>
                {spec.hasDescription && item.description ? (
                  <span className='truncate text-xs text-muted-foreground'>
                    {item.description}
                  </span>
                ) : null}
              </div>
              {spec.hasDefault ? (
                <label className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                  <input
                    type='radio'
                    name={`${spec.resource}-default`}
                    checked={item.isDefault}
                    disabled={!canEdit}
                    onChange={() => makeDefault(item)}
                    className='accent-primary'
                  />
                  padrão
                </label>
              ) : null}
              {canEdit ? (
                <>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    aria-label={`Editar ${item.name}`}
                    onClick={() => setEditing(item)}
                  >
                    <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  </Button>
                  <ConfirmDeleteButton
                    title={`Excluir ${spec.singular}`}
                    description={`"${item.name}" será excluído(a). Células da matriz e metas de SLA ligadas saem junto; chamados ficam sem o valor.`}
                    pending={mutations.remove.isPending}
                    onConfirm={() =>
                      mutations.remove.mutate(item.id, {
                        onError: (err) => notify.error(err),
                      })
                    }
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form
          onSubmit={handleAdd}
          className='flex flex-wrap items-center gap-2'
        >
          <Input
            placeholder={spec.newLabel}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className='min-w-40 flex-1'
          />
          <div className='w-24'>
            <NumberInput
              value={level ?? nextLevel}
              min={1}
              max={100}
              onCommit={setLevel}
            />
          </div>
          {spec.hasColor ? (
            <input
              type='color'
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label='Cor'
              className='h-9 w-9 cursor-pointer rounded-md border border-border bg-transparent'
            />
          ) : null}
          <Button
            type='submit'
            size='sm'
            className='h-9'
            disabled={!name.trim() || mutations.create.isPending}
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Adicionar
          </Button>
        </form>
      ) : null}

      {editing ? (
        <ScaleDialog
          spec={spec}
          item={editing}
          saving={mutations.update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              await mutations.update.mutateAsync({ id: editing.id, data })
              notify.success('Item salvo')
              setEditing(null)
            } catch (err) {
              notify.error(err)
            }
          }}
        />
      ) : null}
    </SettingsSection>
  )
}

function ScaleDialog({
  spec,
  item,
  saving,
  onClose,
  onSave,
}: {
  spec: ScaleSpec
  item: SdScaleItemDTO
  saving: boolean
  onClose: () => void
  onSave: (data: UpdateSdScaleItemDTO) => void
}) {
  const [name, setName] = useState(item.name)
  const [level, setLevel] = useState(item.level)
  const [description, setDescription] = useState(item.description ?? '')
  const [color, setColor] = useState(item.color)

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Editar {spec.singular}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-[1fr_7rem] gap-3'>
            <FieldBlock label='Nome'>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </FieldBlock>
            <FieldBlock label='Nível'>
              <NumberInput
                value={level}
                min={1}
                max={100}
                onCommit={(v) => setLevel(v ?? item.level)}
              />
            </FieldBlock>
          </div>
          {spec.hasDescription ? (
            <FieldBlock label='Descrição'>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FieldBlock>
          ) : null}
          {spec.hasColor ? (
            <FieldBlock label='Cor'>
              <ColorInput value={color} onChange={setColor} />
            </FieldBlock>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' size='sm' onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size='sm'
            disabled={!name.trim() || saving}
            onClick={() =>
              onSave({
                name: name.trim(),
                level,
                ...(spec.hasDescription
                  ? { description: description.trim() || null }
                  : {}),
                ...(spec.hasColor ? { color } : {}),
              })
            }
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const cellKey = (impactId: string, urgencyId: string) =>
  `${impactId}:${urgencyId}`

function MatrixEditor() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const impactsQuery = useSdConfigList<SdScaleItemDTO>(workspaceId, 'impacts')
  const urgenciesQuery = useSdConfigList<SdScaleItemDTO>(
    workspaceId,
    'urgencies',
  )
  const prioritiesQuery = useSdConfigList<SdScaleItemDTO>(
    workspaceId,
    'priorities',
  )
  const matrixQuery = useSdPriorityMatrix(workspaceId)
  const save = useSaveSdPriorityMatrix(workspaceId)

  const impacts = useMemo(
    () => [...(impactsQuery.data ?? [])].sort((a, b) => b.level - a.level),
    [impactsQuery.data],
  )
  const urgencies = useMemo(
    () => [...(urgenciesQuery.data ?? [])].sort((a, b) => a.level - b.level),
    [urgenciesQuery.data],
  )
  const priorities = useMemo(
    () => [...(prioritiesQuery.data ?? [])].sort((a, b) => a.level - b.level),
    [prioritiesQuery.data],
  )
  const priorityById = useMemo(
    () => new Map(priorities.map((p) => [p.id, p])),
    [priorities],
  )

  const loaded = useMemo(() => {
    const out: Record<string, string> = {}
    for (const c of matrixQuery.data ?? []) {
      out[cellKey(c.impactId, c.urgencyId)] = c.priorityId
    }
    return out
  }, [matrixQuery.data])

  const [grid, setGrid] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    setGrid(loaded)
    setDirty(false)
  }, [loaded])

  function setCell(
    impactId: string,
    urgencyId: string,
    priorityId: string | null,
  ) {
    const next = { ...grid }
    if (priorityId) next[cellKey(impactId, urgencyId)] = priorityId
    else delete next[cellKey(impactId, urgencyId)]
    setGrid(next)
    setDirty(true)
  }

  /**
   * Regra de rank: impacto e urgência viram posições 0..n-1 (por nível
   * crescente); a soma é distribuída proporcionalmente sobre as prioridades
   * ordenadas — o canto baixo/baixo recebe a menor e o alto/alto a maior.
   */
  function fillItil() {
    if (priorities.length === 0) return
    const impactAsc = [...impacts].reverse()
    const maxSum = impactAsc.length - 1 + (urgencies.length - 1)
    const next: Record<string, string> = {}
    impactAsc.forEach((impact, i) => {
      urgencies.forEach((urgency, u) => {
        const ratio = maxSum === 0 ? 1 : (i + u) / maxSum
        const index = Math.round(ratio * (priorities.length - 1))
        next[cellKey(impact.id, urgency.id)] = priorities[index].id
      })
    })
    setGrid(next)
    setDirty(true)
  }

  async function handleSave() {
    const cells: SdPriorityMatrixCellDTO[] = Object.entries(grid).map(
      ([key, priorityId]) => {
        const [impactId, urgencyId] = key.split(':')
        return { impactId, urgencyId, priorityId }
      },
    )
    try {
      await save.mutateAsync(cells)
      setDirty(false)
      notify.success('Matriz salva')
    } catch (err) {
      notify.error(err)
    }
  }

  const priorityOptions = priorities.map((p) => ({
    value: p.id,
    label: p.name,
  }))

  return (
    <SettingsSection
      title='Matriz impacto × urgência'
      description='Define a prioridade automática na abertura do chamado. Células vazias = sem prioridade automática (usa a padrão).'
      actions={
        canEdit ? (
          <Button
            variant='outline'
            size='xs'
            onClick={fillItil}
            disabled={priorities.length === 0}
            title='Distribui as prioridades pela soma das posições de impacto e urgência (baixo/baixo → menor, alto/alto → maior).'
          >
            <SteelIcon icon={SparklesIcon} strokeWidth={2} />
            Preencher padrão ITIL
          </Button>
        ) : null
      }
    >
      {impacts.length === 0 || urgencies.length === 0 ? (
        <EmptyState>
          Cadastre impactos e urgências para montar a matriz.
        </EmptyState>
      ) : (
        <>
          <div className='overflow-x-auto rounded-lg border border-border'>
            <table className='w-full border-collapse text-xs'>
              <thead>
                <tr className='bg-muted/50'>
                  <th className='px-3 py-2 text-left font-medium'>
                    Impacto \ Urgência
                  </th>
                  {urgencies.map((u) => (
                    <th key={u.id} className='px-2 py-2 font-medium'>
                      {u.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {impacts.map((impact) => (
                  <tr key={impact.id} className='border-t border-border'>
                    <th className='px-3 py-2 text-left font-medium whitespace-nowrap'>
                      {impact.name}
                    </th>
                    {urgencies.map((urgency) => {
                      const priorityId = grid[cellKey(impact.id, urgency.id)]
                      const priority = priorityId
                        ? priorityById.get(priorityId)
                        : undefined
                      return (
                        <td
                          key={urgency.id}
                          className={cn('p-1.5')}
                          style={{
                            backgroundColor: priority?.color
                              ? `${priority.color}22`
                              : undefined,
                          }}
                        >
                          <SimpleSelect
                            value={priorityId ?? null}
                            onChange={(value) =>
                              setCell(impact.id, urgency.id, value)
                            }
                            options={priorityOptions}
                            allowEmpty
                            emptyLabel='—'
                            disabled={!canEdit}
                            className='min-w-32 bg-background'
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='flex flex-wrap items-center gap-3'>
              {priorities.map((p) => (
                <span
                  key={p.id}
                  className='flex items-center gap-1.5 text-xs text-muted-foreground'
                >
                  <ColorDot color={p.color} />
                  {p.name}
                </span>
              ))}
            </div>
            {canEdit ? (
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={!dirty}
                  onClick={() => {
                    setGrid(loaded)
                    setDirty(false)
                  }}
                >
                  Descartar
                </Button>
                <Button
                  size='sm'
                  disabled={!dirty || save.isPending}
                  onClick={handleSave}
                >
                  {save.isPending ? 'Salvando...' : 'Salvar matriz'}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </SettingsSection>
  )
}

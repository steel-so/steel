'use client'

import {
  Building03Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  UserAdd01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSdAgents,
  useSdConfigList,
  useSdConfigMutations,
  useSdDepartmentMembers,
} from '@/src/hooks/use-sd-config'
import type {
  CreateSdDepartmentDTO,
  UpdateSdDepartmentDTO,
} from '@/src/schemas/sd-department.schema'
import type {
  SdBusinessCalendarDTO,
  SdDepartmentDTO,
  SdDepartmentMemberDTO,
} from '@/types/sd-config'
import {
  ColorDot,
  ColorInput,
  ConfirmDeleteButton,
  EmptyState,
  FieldBlock,
  SettingsSection,
  SimpleSelect,
  SortableList,
  useSdSettingsContext,
} from './sd-settings-kit'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

type DialogState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'edit'; department: SdDepartmentDTO }
  | null

export function SdDepartmentsTab() {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const { data, isLoading } = useSdConfigList<SdDepartmentDTO>(
    workspaceId,
    'departments',
    { includeInactive: true },
  )
  const mutations = useSdConfigMutations<
    SdDepartmentDTO,
    CreateSdDepartmentDTO,
    UpdateSdDepartmentDTO
  >(workspaceId, 'departments')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)

  const departments = data ?? []
  const roots = useMemo(
    () => departments.filter((d) => !d.parentId),
    [departments],
  )
  const selected = departments.find((d) => d.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId && departments.length > 0) setSelectedId(departments[0].id)
  }, [departments, selectedId])

  function reorder(orderedIds: string[]) {
    mutations.reorder.mutate(
      { orderedIds },
      { onError: (err) => notify.error(err) },
    )
  }

  async function toggleActive(department: SdDepartmentDTO, active: boolean) {
    try {
      await mutations.update.mutateAsync({
        id: department.id,
        data: { active },
      })
    } catch (err) {
      notify.error(err)
    }
  }

  function renderRow(
    department: SdDepartmentDTO,
    handle: React.ReactNode,
    isChild: boolean,
  ) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border bg-background px-3 py-2',
          selectedId === department.id
            ? 'border-primary/60 ring-1 ring-primary/30'
            : 'border-border',
          !department.active && 'opacity-60',
          isChild && 'ml-6',
        )}
      >
        {handle}
        <ColorDot color={department.color} />
        <button
          type='button'
          onClick={() => setSelectedId(department.id)}
          className='flex min-w-0 flex-1 flex-col text-left'
        >
          <span className='truncate text-sm font-medium'>
            {department.name}
          </span>
          <span className='truncate text-xs text-muted-foreground'>
            {department.members.length}{' '}
            {department.members.length === 1 ? 'membro' : 'membros'}
            {department.members.some((m) => m.isLead) ? ' · com líder' : ''}
          </span>
        </button>
        {canEdit && !isChild ? (
          <Button
            type='button'
            variant='ghost'
            size='icon-xs'
            aria-label={`Novo sub-departamento em ${department.name}`}
            onClick={() =>
              setDialog({ mode: 'create', parentId: department.id })
            }
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          </Button>
        ) : null}
        <Switch
          checked={department.active}
          disabled={!canEdit}
          onCheckedChange={(value) => toggleActive(department, value)}
          aria-label={department.active ? 'Desativar' : 'Ativar'}
        />
        {canEdit ? (
          <>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label={`Editar ${department.name}`}
              onClick={() => setDialog({ mode: 'edit', department })}
            >
              <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
            </Button>
            <ConfirmDeleteButton
              title='Excluir departamento'
              description={`"${department.name}"${isChild ? '' : ' e seus sub-departamentos'} deixam de atender. Os membros perdem o vínculo com o time.`}
              pending={mutations.remove.isPending}
              onConfirm={() =>
                mutations.remove.mutate(department.id, {
                  onSuccess: () => {
                    if (selectedId === department.id) setSelectedId(null)
                  },
                  onError: (err) => notify.error(err),
                })
              }
            />
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className='grid grid-cols-1 gap-5 lg:grid-cols-5'>
      <SettingsSection
        className='lg:col-span-3'
        title='Estrutura'
        description='Departamentos e sub-departamentos (dois níveis). Arraste para reordenar.'
        actions={
          canEdit ? (
            <Button
              size='sm'
              onClick={() => setDialog({ mode: 'create', parentId: null })}
            >
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Novo departamento
            </Button>
          ) : null
        }
      >
        {!isLoading && roots.length === 0 ? (
          <EmptyState>Nenhum departamento cadastrado.</EmptyState>
        ) : (
          <SortableList
            items={roots}
            disabled={!canEdit}
            onReorder={reorder}
            renderItem={(root, handle) => {
              const children = departments.filter((d) => d.parentId === root.id)
              return (
                <div className='flex flex-col gap-1.5'>
                  {renderRow(root, handle, false)}
                  {children.length > 0 ? (
                    <SortableList
                      items={children}
                      disabled={!canEdit}
                      onReorder={reorder}
                      renderItem={(child, childHandle) =>
                        renderRow(child, childHandle, true)
                      }
                    />
                  ) : null}
                </div>
              )
            }}
          />
        )}
      </SettingsSection>

      <div className='lg:col-span-2'>
        {selected ? (
          <MembersPanel department={selected} />
        ) : (
          <SettingsSection title='Membros'>
            <EmptyState>
              Selecione um departamento para ver os membros.
            </EmptyState>
          </SettingsSection>
        )}
      </div>

      {dialog ? (
        <DepartmentDialog
          state={dialog}
          roots={roots}
          saving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setDialog(null)}
          onSave={async (values) => {
            try {
              if (dialog.mode === 'create') {
                const created = await mutations.create.mutateAsync({
                  ...values,
                  active: true,
                })
                setSelectedId(created.id)
                notify.success('Departamento criado')
              } else {
                await mutations.update.mutateAsync({
                  id: dialog.department.id,
                  data: values,
                })
                notify.success('Departamento salvo')
              }
              setDialog(null)
            } catch (err) {
              notify.error(err)
            }
          }}
        />
      ) : null}
    </div>
  )
}

function MembersPanel({ department }: { department: SdDepartmentDTO }) {
  const { workspaceId, canEdit } = useSdSettingsContext()
  const members = useSdDepartmentMembers(workspaceId)
  const agents = useSdAgents(workspaceId, {
    includeRequesters: true,
    enabled: canEdit,
  })
  const [userId, setUserId] = useState<string | null>(null)
  const [isLead, setIsLead] = useState(false)

  const memberIds = new Set(department.members.map((m) => m.userId))
  const candidates = (agents.data ?? []).filter((a) => !memberIds.has(a.id))

  async function add() {
    if (!userId) return
    try {
      await members.add.mutateAsync({
        departmentId: department.id,
        userId,
        isLead,
      })
      setUserId(null)
      setIsLead(false)
    } catch (err) {
      notify.error(err)
    }
  }

  async function setLead(member: SdDepartmentMemberDTO, lead: boolean) {
    try {
      await members.setLead.mutateAsync({
        departmentId: department.id,
        userId: member.userId,
        isLead: lead,
      })
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <SettingsSection
      title={`Membros · ${department.name}`}
      description='Quem está em um departamento vira agente. O líder recebe os escalonamentos hierárquicos.'
    >
      {canEdit ? (
        <div className='flex flex-col gap-2 rounded-lg border border-dashed border-border p-3'>
          <SimpleSelect
            value={userId}
            onChange={setUserId}
            placeholder={
              agents.isLoading ? 'Carregando membros...' : 'Escolha um membro'
            }
            options={candidates.map((a) => ({
              value: a.id,
              label: `${a.name} · ${a.email}`,
            }))}
          />
          <div className='flex items-center justify-between gap-2'>
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Checkbox
                checked={isLead}
                onCheckedChange={(value) => setIsLead(value === true)}
                aria-label='Adicionar como líder'
              />
              Adicionar como líder
            </div>
            <Button
              size='sm'
              disabled={!userId || members.add.isPending}
              onClick={add}
            >
              <SteelIcon icon={UserAdd01Icon} strokeWidth={2} />
              Adicionar membro
            </Button>
          </div>
        </div>
      ) : null}

      {department.members.length === 0 ? (
        <EmptyState>Nenhum membro neste departamento.</EmptyState>
      ) : (
        <ul className='flex flex-col gap-1.5'>
          {department.members.map((member) => (
            <li
              key={member.userId}
              className='flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2'
            >
              <Avatar size='sm'>
                {member.image ? (
                  <AvatarImage src={member.image} alt={member.name} />
                ) : null}
                <AvatarFallback>{initials(member.name)}</AvatarFallback>
              </Avatar>
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='flex items-center gap-1.5 truncate text-sm font-medium'>
                  {member.name}
                  {member.isLead ? (
                    <Badge variant='secondary'>Líder</Badge>
                  ) : null}
                </span>
                <span className='truncate text-xs text-muted-foreground'>
                  {member.email}
                </span>
              </div>
              <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                Líder
                <Switch
                  size='sm'
                  checked={member.isLead}
                  disabled={!canEdit || members.setLead.isPending}
                  onCheckedChange={(value) => setLead(member, value)}
                  aria-label={`Líder: ${member.name}`}
                />
              </div>
              {canEdit ? (
                <ConfirmDeleteButton
                  title='Remover membro'
                  label='Remover'
                  description={`${member.name} deixa de atender por "${department.name}".`}
                  pending={members.remove.isPending}
                  onConfirm={() =>
                    members.remove.mutate(
                      { departmentId: department.id, userId: member.userId },
                      { onError: (err) => notify.error(err) },
                    )
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}

interface DepartmentValues {
  name: string
  description: string | null
  email: string | null
  color: string | null
  parentId: string | null
  calendarId: string | null
}

function DepartmentDialog({
  state,
  roots,
  saving,
  onClose,
  onSave,
}: {
  state: NonNullable<DialogState>
  roots: SdDepartmentDTO[]
  saving: boolean
  onClose: () => void
  onSave: (values: DepartmentValues) => void
}) {
  const { workspaceId } = useSdSettingsContext()
  const calendars = useSdConfigList<SdBusinessCalendarDTO>(
    workspaceId,
    'calendars',
  )
  const initial = state.mode === 'edit' ? state.department : null
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [color, setColor] = useState<string | null>(initial?.color ?? null)
  const [parentId, setParentId] = useState<string | null>(
    state.mode === 'edit' ? state.department.parentId : state.parentId,
  )
  const [calendarId, setCalendarId] = useState<string | null>(
    initial?.calendarId ?? null,
  )

  const parentOptions = roots
    .filter((r) => r.id !== initial?.id)
    .map((r) => ({ value: r.id, label: r.name }))

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <SteelIcon icon={Building03Icon} strokeWidth={2} />
            {state.mode === 'edit'
              ? 'Editar departamento'
              : 'Novo departamento'}
          </DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <FieldBlock label='Nome'>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </FieldBlock>
          <FieldBlock label='Descrição'>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </FieldBlock>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <FieldBlock label='E-mail do time'>
              <Input
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder='suporte@empresa.com.br'
              />
            </FieldBlock>
            <FieldBlock
              label='Departamento pai'
              hint='Vazio = departamento raiz.'
            >
              <SimpleSelect
                value={parentId}
                onChange={setParentId}
                options={parentOptions}
                allowEmpty
                emptyLabel='Nenhum (raiz)'
              />
            </FieldBlock>
          </div>
          <FieldBlock
            label='Calendário de expediente'
            hint='Usado no OLA quando o chamado está com este time.'
          >
            <SimpleSelect
              value={calendarId}
              onChange={setCalendarId}
              options={(calendars.data ?? []).map((c) => ({
                value: c.id,
                label:
                  c.isDefault && c.name.trim().toLowerCase() !== 'padrão'
                    ? `${c.name} (padrão)`
                    : c.name,
              }))}
              allowEmpty
              emptyLabel='Padrão da workspace'
            />
          </FieldBlock>
          <FieldBlock label='Cor'>
            <ColorInput value={color} onChange={setColor} />
          </FieldBlock>
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
                description: description.trim() || null,
                email: email.trim() || null,
                color,
                parentId,
                calendarId,
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

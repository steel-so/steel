'use client'

import {
  Delete02Icon,
  Edit02Icon,
  Search01Icon,
  UserGroup03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useWhatsAppAssignableMembers } from '@/src/hooks/use-whatsapp-conversations'
import {
  useCreateWhatsAppTeam,
  useDeleteWhatsAppTeam,
  useUpdateWhatsAppTeam,
  useWhatsAppTeams,
} from '@/src/hooks/use-whatsapp-teams'
import type {
  WhatsAppTeamDTO,
  WhatsAppTeamMemberDTO,
  WhatsAppTeamRoleDTO,
} from '@/types/whatsapp-team'

type MemberChoice = WhatsAppTeamRoleDTO | 'NONE'

const ROLE_LABEL: Record<MemberChoice, string> = {
  NONE: 'Fora da equipe',
  AGENT: 'Agente',
  LEADER: 'Líder',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function TeamDialog({
  workspaceId,
  team,
  open,
  onOpenChange,
}: {
  workspaceId: string
  /** `null` = new team. */
  team: WhatsAppTeamDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const members = useWhatsAppAssignableMembers(workspaceId)
  const createTeam = useCreateWhatsAppTeam(workspaceId)
  const updateTeam = useUpdateWhatsAppTeam(workspaceId)
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [search, setSearch] = useState('')
  const [roles, setRoles] = useState<Record<string, WhatsAppTeamRoleDTO>>(() =>
    Object.fromEntries(
      (team?.members ?? []).map((member) => [member.userId, member.role]),
    ),
  )
  const isPending = createTeam.isPending || updateTeam.isPending

  const visibleMembers = (members.data ?? []).filter((member) => {
    const term = search.trim().toLowerCase()
    if (!term) return true
    return (
      member.name.toLowerCase().includes(term) ||
      member.email.toLowerCase().includes(term)
    )
  })
  const selected = Object.keys(roles).length

  function setRole(userId: string, choice: MemberChoice) {
    setRoles((current) => {
      const next = { ...current }
      if (choice === 'NONE') delete next[userId]
      else next[userId] = choice
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      members: Object.entries(roles).map(([userId, role]) => ({
        userId,
        role,
      })),
    }
    const options = {
      onSuccess: () => {
        notify.success(team ? 'Equipe atualizada' : 'Equipe criada')
        onOpenChange(false)
      },
      onError: (error: Error) =>
        notify.error(error, 'Não foi possível salvar a equipe'),
    }
    if (team) {
      updateTeam.mutate(
        {
          teamId: team.id,
          ...payload,
          description: description.trim() || null,
        },
        options,
      )
    } else {
      createTeam.mutate(payload, options)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>{team ? 'Editar equipe' : 'Nova equipe'}</DialogTitle>
          <DialogDescription>
            Líderes veem as conversas dos agentes e da fila da equipe e podem
            atribuí-las. Agentes atendem as conversas da fila da equipe.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='team-name'>Nome</Label>
            <Input
              id='team-name'
              required
              maxLength={80}
              placeholder='Ex.: Comercial'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='team-description'>Descrição (opcional)</Label>
            <Textarea
              id='team-description'
              rows={2}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between gap-2'>
              <Label htmlFor='team-member-search'>Membros</Label>
              <span className='text-muted-foreground text-xs'>
                {selected === 1 ? '1 na equipe' : `${selected} na equipe`}
              </span>
            </div>
            <div className='relative'>
              <SteelIcon
                icon={Search01Icon}
                size={16}
                className='-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground'
              />
              <Input
                id='team-member-search'
                aria-label='Buscar membro'
                placeholder='Buscar membro'
                className='pl-8'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className='max-h-64 divide-y overflow-y-auto rounded-md border'>
              {members.isLoading ? (
                <div className='space-y-2 p-3'>
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                </div>
              ) : visibleMembers.length === 0 ? (
                <p className='p-3 text-center text-muted-foreground text-sm'>
                  Nenhum membro encontrado
                </p>
              ) : (
                visibleMembers.map((member) => {
                  const choice: MemberChoice = roles[member.id] ?? 'NONE'
                  return (
                    <div
                      key={member.id}
                      className='flex items-center gap-2.5 px-3 py-2'
                    >
                      <Avatar className='size-7'>
                        <AvatarImage src={member.image ?? undefined} />
                        <AvatarFallback className='text-[10px]'>
                          {initials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm'>{member.name}</p>
                        <p className='truncate text-muted-foreground text-xs'>
                          {member.email}
                        </p>
                      </div>
                      <Select
                        value={choice}
                        onValueChange={(value) =>
                          setRole(member.id, (value ?? 'NONE') as MemberChoice)
                        }
                      >
                        <SelectTrigger
                          size='sm'
                          className='w-36 shrink-0'
                          aria-label={`Papel de ${member.name} na equipe`}
                        >
                          <SelectValue>{ROLE_LABEL[choice]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            <SelectItem value='NONE'>
                              {ROLE_LABEL.NONE}
                            </SelectItem>
                            <SelectItem value='AGENT'>
                              {ROLE_LABEL.AGENT}
                            </SelectItem>
                            <SelectItem value='LEADER'>
                              {ROLE_LABEL.LEADER}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  )
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={isPending || !name.trim()}>
              {isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MemberChips({
  label,
  members,
}: {
  label: string
  members: WhatsAppTeamMemberDTO[]
}) {
  return (
    <div className='space-y-1.5'>
      <p className='font-medium text-muted-foreground text-xs'>
        {label} ({members.length})
      </p>
      {members.length === 0 ? (
        <p className='text-muted-foreground text-xs'>Ninguém ainda</p>
      ) : (
        <div className='flex flex-wrap gap-1.5'>
          {members.map((member) => (
            <span
              key={member.userId}
              className='inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs'
            >
              <Avatar className='size-5'>
                <AvatarImage src={member.image ?? undefined} />
                <AvatarFallback className='text-[9px]'>
                  {initials(member.name)}
                </AvatarFallback>
              </Avatar>
              <span className='truncate'>{member.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function WhatsappTeamsPage({ workspaceId }: { workspaceId: string }) {
  const teams = useWhatsAppTeams(workspaceId)
  const deleteTeam = useDeleteWhatsAppTeam(workspaceId)
  const canManage = useIsPrivileged()
  // `undefined` = closed; `null` = creating; a team = editing it.
  const [editing, setEditing] = useState<WhatsAppTeamDTO | null | undefined>(
    undefined,
  )
  const [deleting, setDeleting] = useState<WhatsAppTeamDTO | null>(null)

  const sorted = teams.data ?? []

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='font-medium text-sm'>Equipes de atendimento</h3>
          <p className='max-w-2xl text-muted-foreground text-xs'>
            Cada pessoa vê as conversas atribuídas a ela e a fila da sua equipe.
            Líderes também acompanham as conversas dos agentes. O dono do
            workspace vê tudo, assim como administradores que não estão em
            nenhuma equipe.
          </p>
        </div>
        {canManage ? (
          <Button size='sm' onClick={() => setEditing(null)}>
            Nova equipe
          </Button>
        ) : null}
      </div>

      {teams.isLoading ? (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          <Skeleton className='h-40 w-full' />
          <Skeleton className='h-40 w-full' />
        </div>
      ) : sorted.length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center'>
          <SteelIcon
            icon={UserGroup03Icon}
            size={28}
            className='text-muted-foreground'
          />
          <p className='font-medium text-sm'>Nenhuma equipe ainda</p>
          <p className='max-w-sm text-muted-foreground text-xs'>
            Sem equipes, quem não é dono nem administrador vê só as próprias
            conversas e a fila geral.
          </p>
          {canManage ? (
            <Button
              size='sm'
              variant='outline'
              className='mt-1'
              onClick={() => setEditing(null)}
            >
              Criar a primeira equipe
            </Button>
          ) : null}
        </div>
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {sorted.map((team) => {
            const leaders = team.members.filter((m) => m.role === 'LEADER')
            const agents = team.members.filter((m) => m.role === 'AGENT')
            return (
              <div
                key={team.id}
                className='flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4'
              >
                <div className='flex items-start justify-between gap-2'>
                  <div className='min-w-0'>
                    <p className='truncate font-medium text-sm'>{team.name}</p>
                    {team.description ? (
                      <p className='line-clamp-2 text-muted-foreground text-xs'>
                        {team.description}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant='secondary' className='shrink-0'>
                    {team.members.length === 1
                      ? '1 membro'
                      : `${team.members.length} membros`}
                  </Badge>
                </div>
                <MemberChips label='Líderes' members={leaders} />
                <MemberChips label='Agentes' members={agents} />
                {canManage ? (
                  <div className='mt-auto flex justify-end gap-1 border-t pt-2'>
                    <Button
                      size='xs'
                      variant='ghost'
                      onClick={() => setEditing(team)}
                    >
                      <SteelIcon icon={Edit02Icon} size={14} />
                      Editar
                    </Button>
                    <Button
                      size='xs'
                      variant='ghost'
                      className='text-destructive'
                      onClick={() => setDeleting(team)}
                    >
                      <SteelIcon icon={Delete02Icon} size={14} />
                      Excluir
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {editing !== undefined ? (
        <TeamDialog
          // Remount per team so the form starts from its current values.
          key={editing?.id ?? 'new'}
          workspaceId={workspaceId}
          team={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined)
          }}
        />
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir a equipe {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              As conversas da equipe continuam com os mesmos responsáveis; as
              que estão na fila dela voltam para a fila geral.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTeam.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={deleteTeam.isPending}
              onClick={() => {
                if (!deleting) return
                deleteTeam.mutate(deleting.id, {
                  onSuccess: () => {
                    notify.success('Equipe excluída')
                    setDeleting(null)
                  },
                  onError: (error) =>
                    notify.error(error, 'Não foi possível excluir a equipe'),
                })
              }}
            >
              {deleteTeam.isPending ? 'Excluindo...' : 'Excluir equipe'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

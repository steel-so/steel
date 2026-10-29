'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSdAgents } from '@/src/hooks/use-sd-config'
import { FieldBlock, ToggleRow } from '../../settings/sd-settings-kit'
import { SdUserAvatar } from '../sd-ticket-badges'

/** Checklist de especialistas (agentes), com busca e teto de seleção. */
export function SpecialistPicker({
  workspaceId,
  excludeIds,
  selected,
  max,
  onChange,
}: {
  workspaceId: string
  excludeIds: string[]
  selected: string[]
  max: number
  onChange: (ids: string[]) => void
}) {
  const agents = useSdAgents(workspaceId)
  const [query, setQuery] = useState('')
  const options = useMemo(() => {
    const skip = new Set(excludeIds)
    const q = query.trim().toLowerCase()
    return (agents.data ?? []).filter(
      (a) =>
        a.isAgent &&
        !skip.has(a.id) &&
        (q === '' ||
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q)),
    )
  }, [agents.data, excludeIds, query])

  function toggle(id: string, checked: boolean) {
    if (!checked) return onChange(selected.filter((s) => s !== id))
    if (selected.length >= max) return
    onChange([...selected, id])
  }

  return (
    <div className='flex flex-col gap-2'>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder='Buscar por nome ou e-mail…'
        aria-label='Buscar especialista'
      />
      <ul className='flex max-h-56 flex-col overflow-y-auto rounded-md border border-border'>
        {options.length === 0 ? (
          <li className='px-3 py-4 text-center text-muted-foreground text-sm'>
            {agents.isLoading
              ? 'Carregando…'
              : 'Nenhum agente disponível para convidar.'}
          </li>
        ) : (
          options.map((agent) => {
            const checked = selected.includes(agent.id)
            const blocked = !checked && selected.length >= max
            return (
              <li key={agent.id}>
                <label
                  htmlFor={`swarm-pick-${agent.id}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50',
                    blocked && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Checkbox
                    id={`swarm-pick-${agent.id}`}
                    checked={checked}
                    disabled={blocked}
                    onCheckedChange={(value) => toggle(agent.id, value)}
                  />
                  <SdUserAvatar user={agent} className='size-6' />
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate'>{agent.name}</span>
                    <span className='truncate text-muted-foreground text-xs'>
                      {agent.email}
                    </span>
                  </span>
                </label>
              </li>
            )
          })
        )}
      </ul>
      <p className='text-muted-foreground text-xs'>
        {selected.length} de {max} selecionados.
      </p>
    </div>
  )
}

export function SdSwarmStartDialog({
  workspaceId,
  open,
  maxMembers,
  slackAvailable,
  pending,
  onOpenChange,
  onSubmit,
}: {
  workspaceId: string
  open: boolean
  maxMembers: number
  slackAvailable: boolean
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: {
    reason: string
    userIds: string[]
    openSlackChannel: boolean
  }) => void
}) {
  const [reason, setReason] = useState('')
  const [userIds, setUserIds] = useState<string[]>([])
  const [slack, setSlack] = useState(false)

  useEffect(() => {
    if (!open) return
    setReason('')
    setUserIds([])
    setSlack(false)
  }, [open])

  const valid = reason.trim().length >= 3 && userIds.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Chamar especialistas</DialogTitle>
          <DialogDescription>
            Os convidados entram direto no chamado, sem passar pelos níveis de
            escalonamento.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <FieldBlock label='O que precisa ser resolvido'>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder='Ex.: Queda intermitente do link, preciso de rede e de segurança.'
            />
          </FieldBlock>
          <div className='flex flex-col gap-1.5'>
            <Label>Especialistas</Label>
            <SpecialistPicker
              workspaceId={workspaceId}
              excludeIds={[]}
              selected={userIds}
              max={maxMembers}
              onChange={setUserIds}
            />
          </div>
          {slackAvailable ? (
            <ToggleRow
              label='Abrir um canal temporário no Slack'
              description='Canal privado com os especialistas, arquivado ao encerrar.'
              checked={slack}
              onCheckedChange={setSlack}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSubmit({
                reason: reason.trim(),
                userIds,
                openSlackChannel: slack,
              })
            }
          >
            Chamar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SdSwarmInviteDialog({
  workspaceId,
  open,
  memberIds,
  maxMembers,
  pending,
  onOpenChange,
  onSubmit,
}: {
  workspaceId: string
  open: boolean
  /** Já no swarming (convidados, entraram ou recusaram). */
  memberIds: string[]
  maxMembers: number
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (userIds: string[]) => void
}) {
  const [userIds, setUserIds] = useState<string[]>([])

  useEffect(() => {
    if (open) setUserIds([])
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Convidar mais especialistas</DialogTitle>
        </DialogHeader>
        <SpecialistPicker
          workspaceId={workspaceId}
          excludeIds={memberIds}
          selected={userIds}
          max={Math.max(maxMembers - memberIds.length, 0)}
          onChange={setUserIds}
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={userIds.length === 0 || pending}
            onClick={() => onSubmit(userIds)}
          >
            Convidar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SdSwarmCloseDialog({
  open,
  hasSlack,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  hasSlack: boolean
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (outcome: string) => void
}) {
  const [outcome, setOutcome] = useState('')

  useEffect(() => {
    if (open) setOutcome('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Encerrar swarming</DialogTitle>
          <DialogDescription>
            {hasSlack
              ? 'O canal do Slack recebe o resumo e é arquivado.'
              : 'O resumo fica no histórico do chamado.'}
          </DialogDescription>
        </DialogHeader>
        <FieldBlock label='O que foi decidido (opcional)'>
          <Textarea
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            rows={4}
            maxLength={2000}
          />
        </FieldBlock>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={pending} onClick={() => onSubmit(outcome)}>
            Encerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

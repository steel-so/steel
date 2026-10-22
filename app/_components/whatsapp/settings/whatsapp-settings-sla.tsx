'use client'

import { Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { useWhatsAppAssignableMembers } from '@/src/hooks/use-whatsapp-conversations'
import {
  useCreateWhatsAppSlaPolicy,
  useDeleteWhatsAppSlaPolicy,
  useUpdateWhatsAppSlaPolicy,
  useWhatsAppSlaPolicies,
} from '@/src/hooks/use-whatsapp-sla'
import { useWhatsAppTeams } from '@/src/hooks/use-whatsapp-teams'
import type { WhatsAppAssignableMemberDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppSlaPolicyDTO } from '@/types/whatsapp-sla'

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='min-w-0'>
        <Label htmlFor={id} className='font-medium text-sm'>
          {label}
        </Label>
        {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
      </div>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  )
}

function toMinutes(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/** One policy (the workspace default or a team override): form + save. */
function SlaPolicyEditor({
  workspaceId,
  policy,
  members,
}: {
  workspaceId: string
  policy: WhatsAppSlaPolicyDTO
  members: WhatsAppAssignableMemberDTO[]
}) {
  const update = useUpdateWhatsAppSlaPolicy(workspaceId)
  const remove = useDeleteWhatsAppSlaPolicy(workspaceId)
  const key = policy.id

  const [enabled, setEnabled] = useState(policy.enabled)
  const [firstResponse, setFirstResponse] = useState(
    String(policy.firstResponseMinutes),
  )
  const [trackResolution, setTrackResolution] = useState(
    policy.resolutionMinutes !== null,
  )
  const [resolution, setResolution] = useState(
    String(policy.resolutionMinutes ?? 480),
  )
  const [warnAt, setWarnAt] = useState(String(policy.warnAtPercent))
  const [businessHoursOnly, setBusinessHoursOnly] = useState(
    policy.businessHoursOnly,
  )
  const [countAi, setCountAi] = useState(policy.countAiAsResponse)
  const [notifyAssignee, setNotifyAssignee] = useState(policy.notifyAssignee)
  const [notifyLeaders, setNotifyLeaders] = useState(policy.notifyTeamLeaders)
  const [notifySupervisors, setNotifySupervisors] = useState(
    policy.notifySupervisors,
  )
  const [supervisorIds, setSupervisorIds] = useState<Set<string>>(
    new Set(policy.supervisorIds),
  )
  const [notifyInApp, setNotifyInApp] = useState(policy.notifyInApp)
  const [notifyEmail, setNotifyEmail] = useState(policy.notifyEmail)

  // Re-sync when the server copy changes (after a save).
  useEffect(() => {
    setEnabled(policy.enabled)
    setFirstResponse(String(policy.firstResponseMinutes))
    setTrackResolution(policy.resolutionMinutes !== null)
    if (policy.resolutionMinutes !== null) {
      setResolution(String(policy.resolutionMinutes))
    }
    setWarnAt(String(policy.warnAtPercent))
    setBusinessHoursOnly(policy.businessHoursOnly)
    setCountAi(policy.countAiAsResponse)
    setNotifyAssignee(policy.notifyAssignee)
    setNotifyLeaders(policy.notifyTeamLeaders)
    setNotifySupervisors(policy.notifySupervisors)
    setSupervisorIds(new Set(policy.supervisorIds))
    setNotifyInApp(policy.notifyInApp)
    setNotifyEmail(policy.notifyEmail)
  }, [policy])

  function toggleSupervisor(id: string) {
    setSupervisorIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const first = toMinutes(firstResponse)
    const resolutionValue = trackResolution ? toMinutes(resolution) : null
    const warn = toMinutes(warnAt)
    if (first === null || first < 1) {
      notify.error('Informe o prazo da primeira resposta em minutos')
      return
    }
    if (trackResolution && (resolutionValue === null || resolutionValue < 1)) {
      notify.error('Informe o prazo de resolução em minutos')
      return
    }
    if (resolutionValue !== null && resolutionValue < first) {
      notify.error(
        'O prazo de resolução não pode ser menor que o da primeira resposta',
      )
      return
    }
    if (warn === null || warn < 10 || warn > 99) {
      notify.error('O aviso deve ficar entre 10% e 99% do prazo')
      return
    }
    update.mutate(
      {
        id: policy.id,
        enabled,
        firstResponseMinutes: first,
        resolutionMinutes: resolutionValue,
        warnAtPercent: warn,
        businessHoursOnly,
        countAiAsResponse: countAi,
        notifyAssignee,
        notifyTeamLeaders: notifyLeaders,
        notifySupervisors,
        supervisorIds: Array.from(supervisorIds),
        notifyInApp,
        notifyEmail,
      },
      {
        onSuccess: () => notify.success('Política de SLA salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  function handleRemove() {
    remove.mutate(policy.id, {
      onSuccess: () => notify.success('Política removida'),
      onError: (error) => notify.error(error, 'Não foi possível remover'),
    })
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4 rounded-md border p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='font-medium text-sm'>
            {policy.teamId
              ? `Equipe ${policy.teamName ?? ''}`.trim()
              : 'Política padrão do workspace'}
          </p>
          <p className='text-muted-foreground text-xs'>
            {policy.teamId
              ? 'Vale no lugar da política padrão para as conversas desta equipe.'
              : 'Vale para todas as conversas sem uma política própria da equipe.'}
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <Badge variant={enabled ? 'secondary' : 'outline'}>
            {enabled ? 'Ativa' : 'Desligada'}
          </Badge>
          <Switch
            aria-label='Ativar esta política de SLA'
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='space-y-1.5'>
          <Label htmlFor={`sla-first-${key}`}>Primeira resposta (min)</Label>
          <Input
            id={`sla-first-${key}`}
            type='number'
            min={1}
            required
            value={firstResponse}
            onChange={(event) => setFirstResponse(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor={`sla-resolution-${key}`}>Resolução (min)</Label>
          <Input
            id={`sla-resolution-${key}`}
            type='number'
            min={1}
            disabled={!trackResolution}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor={`sla-warn-${key}`}>Avisar em (% do prazo)</Label>
          <Input
            id={`sla-warn-${key}`}
            type='number'
            min={10}
            max={99}
            required
            value={warnAt}
            onChange={(event) => setWarnAt(event.target.value)}
          />
        </div>
      </div>

      <div className='space-y-3'>
        <SwitchRow
          id={`sla-track-resolution-${key}`}
          label='Medir também a resolução'
          hint='Tempo até o fechamento da conversa. Desligado, só a primeira resposta conta.'
          checked={trackResolution}
          onChange={setTrackResolution}
        />
        <SwitchRow
          id={`sla-business-${key}`}
          label='Contar só o horário de atendimento'
          hint='O relógio para fora do horário configurado em Atendimento. Sem horário de atendimento ligado, o relógio corre o tempo todo.'
          checked={businessHoursOnly}
          onChange={setBusinessHoursOnly}
        />
        <SwitchRow
          id={`sla-ai-${key}`}
          label='Resposta da IA conta como primeira resposta'
          hint='Desligado, só a resposta de uma pessoa encerra o prazo.'
          checked={countAi}
          onChange={setCountAi}
        />
      </div>

      <fieldset className='space-y-3 border-t pt-4'>
        <legend className='font-medium text-sm'>Quem é avisado</legend>
        <SwitchRow
          id={`sla-assignee-${key}`}
          label='Responsável pela conversa'
          checked={notifyAssignee}
          onChange={setNotifyAssignee}
        />
        <SwitchRow
          id={`sla-leaders-${key}`}
          label='Líderes da equipe da conversa'
          checked={notifyLeaders}
          onChange={setNotifyLeaders}
        />
        <SwitchRow
          id={`sla-supervisors-${key}`}
          label='Supervisores'
          hint='Sem ninguém escolhido, avisa todos os administradores.'
          checked={notifySupervisors}
          onChange={setNotifySupervisors}
        />
        {notifySupervisors ? (
          <div className='flex flex-wrap gap-1.5'>
            {members.map((member) => (
              <Button
                key={member.id}
                type='button'
                size='xs'
                variant={supervisorIds.has(member.id) ? 'default' : 'outline'}
                aria-pressed={supervisorIds.has(member.id)}
                onClick={() => toggleSupervisor(member.id)}
              >
                {member.name}
              </Button>
            ))}
          </div>
        ) : null}
        <SwitchRow
          id={`sla-inapp-${key}`}
          label='Avisar no Steel'
          checked={notifyInApp}
          onChange={setNotifyInApp}
        />
        <SwitchRow
          id={`sla-email-${key}`}
          label='Avisar por e-mail'
          checked={notifyEmail}
          onChange={setNotifyEmail}
        />
      </fieldset>

      <div className='flex items-center justify-between gap-2'>
        <Button type='submit' disabled={update.isPending}>
          {update.isPending ? 'Salvando...' : 'Salvar política'}
        </Button>
        <Button
          type='button'
          variant='ghost'
          disabled={remove.isPending}
          onClick={handleRemove}
        >
          <SteelIcon icon={Delete02Icon} size={14} />
          Remover
        </Button>
      </div>
    </form>
  )
}

/**
 * SLA do atendimento (OWNER/ADMIN): prazos de primeira resposta e de
 * resolução, avisos e exceções por equipe. Desligado por padrão.
 */
export function WhatsappSettingsSla({ workspaceId }: { workspaceId: string }) {
  const isAdmin = useIsPrivileged()
  const policies = useWhatsAppSlaPolicies(workspaceId, isAdmin)
  const teams = useWhatsAppTeams(workspaceId)
  const members = useWhatsAppAssignableMembers(workspaceId)
  const create = useCreateWhatsAppSlaPolicy(workspaceId)
  const [teamToAdd, setTeamToAdd] = useState<string>('')

  if (!isAdmin) return null

  const list = policies.data ?? []
  const defaultPolicy = list.find((policy) => !policy.teamId)
  const overrides = list.filter((policy) => policy.teamId)
  const freeTeams = (teams.data ?? []).filter(
    (team) => !overrides.some((policy) => policy.teamId === team.id),
  )

  function createPolicy(teamId: string | null) {
    create.mutate(
      { teamId },
      {
        onSuccess: () => {
          setTeamToAdd('')
          notify.success('Política criada. Ajuste os prazos e ative.')
        },
        onError: (error) => notify.error(error, 'Não foi possível criar'),
      },
    )
  }

  return (
    <div className='max-w-2xl space-y-4'>
      <div>
        <p className='font-medium text-sm'>SLA do atendimento</p>
        <p className='text-muted-foreground text-xs'>
          Prazo para a primeira resposta e para resolver a conversa. Quando o
          prazo se aproxima ou estoura, os responsáveis são avisados uma única
          vez e a conversa mostra o tempo restante. Nada é medido até você
          ativar uma política. O relógio de cada atendimento começa na mensagem
          do contato e termina ao fechar a conversa; não pausa enquanto se
          espera o cliente.
        </p>
      </div>

      {defaultPolicy ? (
        <SlaPolicyEditor
          workspaceId={workspaceId}
          policy={defaultPolicy}
          members={members.data ?? []}
        />
      ) : (
        <Button
          type='button'
          disabled={create.isPending || policies.isLoading}
          onClick={() => createPolicy(null)}
        >
          Criar política padrão
        </Button>
      )}

      {overrides.map((policy) => (
        <SlaPolicyEditor
          key={policy.id}
          workspaceId={workspaceId}
          policy={policy}
          members={members.data ?? []}
        />
      ))}

      {defaultPolicy && freeTeams.length > 0 ? (
        <div className='flex items-end gap-2'>
          <div className='min-w-0 flex-1 space-y-1.5'>
            <Label>Exceção para uma equipe</Label>
            <Select
              value={teamToAdd}
              onValueChange={(value) => setTeamToAdd(value ?? '')}
            >
              <SelectTrigger className='w-full' aria-label='Equipe'>
                <SelectValue placeholder='Escolha uma equipe'>
                  {freeTeams.find((team) => team.id === teamToAdd)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {freeTeams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            type='button'
            variant='outline'
            disabled={!teamToAdd || create.isPending}
            onClick={() => createPolicy(teamToAdd)}
          >
            Adicionar
          </Button>
        </div>
      ) : null}
    </div>
  )
}

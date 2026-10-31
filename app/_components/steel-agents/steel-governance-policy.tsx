'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { useSteelAgentCatalog } from '@/src/hooks/use-steel-agents'
import { useUpdateSteelAgentPolicy } from '@/src/hooks/use-steel-governance'
import type {
  SteelAgentPolicyDTO,
  SteelAutoRuleModeDTO,
  SteelGovernanceRoleDTO,
} from '@/types/steel-governance'
import { ROLE_LABEL } from './steel-governance-labels'

const CREATOR_ROLES: SteelGovernanceRoleDTO[] = ['MEMBER', 'VIEWER']
const AUTO_ROLES = ['ADMIN', 'MEMBER', 'VIEWER'] as const

const MODE_LABEL: Record<SteelAutoRuleModeDTO, string> = {
  ALL: 'Todas as ferramentas',
  LIST: 'Só as escolhidas',
  NONE: 'Nenhuma (tudo pede aprovação)',
}

/**
 * A8: who may create agents and which tools each role may run in AUTO mode.
 * OWNER is never restricted; with a switch off the old behaviour stays.
 */
export function SteelGovernancePolicy({
  workspaceId,
  policy,
}: {
  workspaceId: string
  policy: SteelAgentPolicyDTO
}) {
  const [draft, setDraft] = useState<SteelAgentPolicyDTO>(policy)
  const catalog = useSteelAgentCatalog(workspaceId)
  const save = useUpdateSteelAgentPolicy(workspaceId)
  const writeTools = (catalog.data?.tools ?? []).filter(
    (t) => t.kind !== 'READ' && t.kind !== 'DELETE',
  )

  function setRule(
    role: (typeof AUTO_ROLES)[number],
    mode: SteelAutoRuleModeDTO,
    tools?: string[],
  ) {
    setDraft((prev) => ({
      ...prev,
      autoRules: {
        ...prev.autoRules,
        [role]: {
          mode,
          tools: mode === 'LIST' ? (tools ?? prev.autoRules[role].tools) : [],
        },
      },
    }))
  }

  async function submit() {
    try {
      await save.mutateAsync(draft)
      notify.success('Permissões salvas.')
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='space-y-6'>
      <section className='space-y-3 rounded-xl border border-border/80 bg-card p-4'>
        <div className='flex items-start gap-3'>
          <Switch
            id='restrict-creators'
            checked={draft.restrictCreators}
            onCheckedChange={(next) =>
              setDraft((prev) => ({ ...prev, restrictCreators: next }))
            }
          />
          <div className='space-y-0.5'>
            <label htmlFor='restrict-creators' className='font-medium text-sm'>
              Definir quem pode criar agentes
            </label>
            <p className='text-muted-foreground text-xs'>
              Desligado, vale a matriz de permissões (só administradores).
              Ligado, administradores sempre podem e você libera os demais
              perfis abaixo. Quem cria só edita os próprios agentes.
            </p>
          </div>
        </div>
        {draft.restrictCreators ? (
          <ul className='space-y-2 pl-1'>
            {CREATOR_ROLES.map((role) => {
              const id = `creator-${role}`
              return (
                <li key={role} className='flex items-center gap-2'>
                  <Checkbox
                    id={id}
                    checked={draft.creatorRoles.includes(role)}
                    onCheckedChange={(next) =>
                      setDraft((prev) => ({
                        ...prev,
                        creatorRoles:
                          next === true
                            ? [...prev.creatorRoles, role]
                            : prev.creatorRoles.filter((r) => r !== role),
                      }))
                    }
                  />
                  <label htmlFor={id} className='text-sm'>
                    {ROLE_LABEL[role]}
                  </label>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className='space-y-3 rounded-xl border border-border/80 bg-card p-4'>
        <div className='flex items-start gap-3'>
          <Switch
            id='restrict-auto'
            checked={draft.restrictAuto}
            onCheckedChange={(next) =>
              setDraft((prev) => ({ ...prev, restrictAuto: next }))
            }
          />
          <div className='space-y-0.5'>
            <label htmlFor='restrict-auto' className='font-medium text-sm'>
              Limitar o modo automático por perfil
            </label>
            <p className='text-muted-foreground text-xs'>
              Define, por perfil, quais escritas um agente pode executar sem
              aprovação. Vale para quem configura e para o perfil do responsável
              do agente na hora de rodar. O proprietário não tem limite.
              Exclusões sempre pedem aprovação.
            </p>
          </div>
        </div>
        {draft.restrictAuto ? (
          <div className='space-y-4'>
            {AUTO_ROLES.map((role) => {
              const rule = draft.autoRules[role]
              return (
                <fieldset key={role} className='space-y-2'>
                  <legend className='font-medium text-sm'>
                    {ROLE_LABEL[role]}
                  </legend>
                  <div className='flex flex-wrap gap-x-4 gap-y-1.5'>
                    {(['ALL', 'LIST', 'NONE'] as const).map((mode) => (
                      <label
                        key={mode}
                        className='flex items-center gap-1.5 text-sm'
                      >
                        <input
                          type='radio'
                          name={`auto-${role}`}
                          checked={rule.mode === mode}
                          onChange={() => setRule(role, mode)}
                        />
                        {MODE_LABEL[mode]}
                      </label>
                    ))}
                  </div>
                  {rule.mode === 'LIST' ? (
                    <ul className='max-h-56 divide-y divide-border overflow-y-auto rounded-lg border'>
                      {writeTools.map((tool) => {
                        const id = `auto-${role}-${tool.name}`
                        const checked = rule.tools.includes(tool.name)
                        return (
                          <li
                            key={tool.name}
                            className='flex items-center gap-2 px-3 py-1.5'
                          >
                            <Checkbox
                              id={id}
                              checked={checked}
                              onCheckedChange={(next) =>
                                setRule(
                                  role,
                                  'LIST',
                                  next === true
                                    ? [...rule.tools, tool.name]
                                    : rule.tools.filter((t) => t !== tool.name),
                                )
                              }
                            />
                            <label htmlFor={id} className='text-sm'>
                              {tool.label}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </fieldset>
              )
            })}
          </div>
        ) : null}
      </section>

      <div className='flex justify-end'>
        <Button onClick={submit} disabled={save.isPending}>
          Salvar permissões
        </Button>
      </div>
    </div>
  )
}

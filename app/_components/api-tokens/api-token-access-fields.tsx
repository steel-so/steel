'use client'

import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ApiScope } from '@/src/lib/api/session'
import { MCP_MODULE_LABELS } from '@/src/lib/mcp/consent-notice'
import type {
  ApiModuleDTO,
  ApiTokenWorkspaceOptionDTO,
} from '@/types/api-token'

/**
 * What a personal API token may do (ADR 0035): workspace, modules, access
 * level and validity. Shared by "Criar token" (Configurações › Segurança) and the
 * CLI confirmation page `/device`.
 */

export const API_MODULE_DESCRIPTIONS: Record<ApiModuleDTO, string> = {
  SERVICE_DESK: 'Chamados, catálogo e base de conhecimento.',
  CRM: 'Leads, negócios, funis e empresas.',
  COMMUNICATION: 'Templates, mensagens e disparos do WhatsApp.',
}

export const API_TOKEN_EXPIRY_OPTIONS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 180, label: '180 dias' },
  { days: 365, label: '1 ano' },
] as const

export type ApiTokenAccessLevel = 'read' | 'write'

export interface ApiTokenAccessValue {
  workspaceId: string | null
  modules: ApiModuleDTO[]
  access: ApiTokenAccessLevel
  expiresInDays: number
}

export function initialAccessValue(
  workspaces: readonly ApiTokenWorkspaceOptionDTO[],
): ApiTokenAccessValue {
  return {
    workspaceId: workspaces[0]?.id ?? null,
    modules: workspaces[0]?.modules ?? [],
    access: 'read',
    expiresInDays: 90,
  }
}

export function scopesOf(access: ApiTokenAccessLevel): ApiScope[] {
  return access === 'write' ? ['api:read', 'api:write'] : ['api:read']
}

export function accessLabel(scopes: readonly ApiScope[]): string {
  return scopes.includes('api:write') ? 'Ler e alterar' : 'Somente ler'
}

export function moduleList(modules: readonly ApiModuleDTO[]): string {
  return modules.map((m) => MCP_MODULE_LABELS[m]).join(', ') || 'Nenhum módulo'
}

/** "17 de out. de 2026", in Brasília time (CI runs in UTC). */
export function formatTokenDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

export function canSubmitAccess(value: ApiTokenAccessValue): boolean {
  return value.workspaceId !== null && value.modules.length > 0
}

export function ApiTokenAccessFields({
  idPrefix,
  workspaces,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string
  workspaces: readonly ApiTokenWorkspaceOptionDTO[]
  value: ApiTokenAccessValue
  onChange: (next: ApiTokenAccessValue) => void
  disabled?: boolean
}) {
  const workspace = workspaces.find((ws) => ws.id === value.workspaceId)

  function selectWorkspace(id: string | null) {
    const next = workspaces.find((ws) => ws.id === id)
    onChange({ ...value, workspaceId: id, modules: next?.modules ?? [] })
  }

  function toggleModule(module: ApiModuleDTO, checked: boolean) {
    onChange({
      ...value,
      modules: checked
        ? [...new Set([...value.modules, module])]
        : value.modules.filter((m) => m !== module),
    })
  }

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-workspace`}>Workspace</FieldLabel>
        <Select
          items={workspaces.map((ws) => ({ value: ws.id, label: ws.name }))}
          value={value.workspaceId ?? undefined}
          onValueChange={(next) => selectWorkspace(next ?? null)}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-workspace`} className='w-full h-9'>
            <SelectValue placeholder='Selecione um workspace' />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          O token vale só para este workspace.
        </FieldDescription>
      </Field>

      <FieldSet>
        <FieldLegend variant='label'>Módulos</FieldLegend>
        <div className='flex flex-col gap-3'>
          {(workspace?.modules ?? []).map((module) => (
            <Field key={module} orientation='horizontal'>
              <Checkbox
                id={`${idPrefix}-module-${module}`}
                checked={value.modules.includes(module)}
                onCheckedChange={(checked) =>
                  toggleModule(module, checked === true)
                }
                disabled={disabled}
              />
              <FieldContent>
                <FieldLabel htmlFor={`${idPrefix}-module-${module}`}>
                  {MCP_MODULE_LABELS[module]}
                </FieldLabel>
                <FieldDescription>
                  {API_MODULE_DESCRIPTIONS[module]}
                </FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant='label'>Nível de acesso</FieldLegend>
        <RadioGroup
          value={value.access}
          onValueChange={(next) =>
            onChange({ ...value, access: next as ApiTokenAccessLevel })
          }
          className='flex flex-col gap-2'
        >
          <FieldLabel htmlFor={`${idPrefix}-access-read`}>
            <Field orientation='horizontal' className='px-4 py-3'>
              <FieldContent>
                <FieldTitle>Somente ler</FieldTitle>
                <FieldDescription>
                  Consultar chamados, leads, negócios e templates.
                </FieldDescription>
              </FieldContent>
              <RadioGroupItem
                value='read'
                id={`${idPrefix}-access-read`}
                disabled={disabled}
              />
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor={`${idPrefix}-access-write`}>
            <Field orientation='horizontal' className='px-4 py-3'>
              <FieldContent>
                <FieldTitle>Ler e alterar</FieldTitle>
                <FieldDescription>
                  Também criar e atualizar registros, sempre com as suas
                  permissões no workspace.
                </FieldDescription>
              </FieldContent>
              <RadioGroupItem
                value='write'
                id={`${idPrefix}-access-write`}
                disabled={disabled}
              />
            </Field>
          </FieldLabel>
        </RadioGroup>
      </FieldSet>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-expiry`}>Validade</FieldLabel>
        <Select
          items={API_TOKEN_EXPIRY_OPTIONS.map((option) => ({
            value: String(option.days),
            label: option.label,
          }))}
          value={String(value.expiresInDays)}
          onValueChange={(next) =>
            onChange({ ...value, expiresInDays: Number(next ?? 90) })
          }
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-expiry`} className='w-full h-9'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {API_TOKEN_EXPIRY_OPTIONS.map((option) => (
                <SelectItem key={option.days} value={String(option.days)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Depois disso o token para de funcionar. Dá para revogar antes.
        </FieldDescription>
      </Field>
    </>
  )
}

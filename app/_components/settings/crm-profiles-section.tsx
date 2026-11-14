'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import {
  createProfile,
  deleteProfile,
  updateProfile,
  useProfiles,
} from '@/src/hooks/use-profile'
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  type PermissionAction,
} from '@/src/lib/permissions'
import type { ProfileDTO } from '@/src/schemas/profile.schema'

const RESOURCE_LABEL: Record<string, string> = {
  companies: 'Empresas',
  people: 'Pessoas',
  opportunities: 'Oportunidades',
  products: 'Produtos',
  pipelines: 'Funis',
  quotas: 'Metas',
  'custom-fields': 'Campos customizados',
  tasks: 'Tarefas',
  notes: 'Notas',
  documents: 'Documentos',
  forms: 'Formulários',
  'landing-pages': 'Landing pages',
  email: 'E-mail',
  dashboards: 'Painéis',
  workflows: 'Workflows',
  social: 'Social',
  integrations: 'Integrações',
  members: 'Membros',
  settings: 'Configurações',
  'audit-logs': 'Log de auditoria',
  leads: 'Leads',
  reports: 'Relatórios',
  conversations: 'Conversas',
  contacts: 'Contatos',
  groups: 'Grupos',
  broadcasts: 'Transmissões',
  'message-templates': 'Templates de mensagem',
  'quick-replies': 'Respostas rápidas',
  'sd-tickets': 'ServiceDesk · Chamados',
  'sd-customers': 'ServiceDesk · Clientes e empresas',
  'sd-contacts': 'ServiceDesk · Contatos',
  'sd-config-items': 'ServiceDesk · Itens de configuração',
  'sd-knowledge': 'ServiceDesk · Base de conhecimento',
  'sd-dashboards': 'ServiceDesk · Painéis',
  'sd-portal': 'ServiceDesk · Portal do solicitante',
  'sd-settings': 'ServiceDesk · Configurações',
  'sd-channels': 'ServiceDesk · Canais de entrada',
  'sd-contracts': 'ServiceDesk · Contratos e horas',
  'sd-change-calendar': 'ServiceDesk · Calendário de mudanças',
  'sd-oncall': 'ServiceDesk · Plantão',
  'sd-reports': 'ServiceDesk · Relatórios agendados',
  'sd-integrations': 'ServiceDesk · Integrações (Slack e GitHub)',
}

const ACTION_LABEL: Record<PermissionAction, string> = {
  VIEW: 'Ver',
  CREATE: 'Criar',
  EDIT: 'Editar',
  DELETE: 'Excluir',
}

type PermissionsDraft = Record<string, PermissionAction[]>

function toggleAction(
  draft: PermissionsDraft,
  resource: string,
  action: PermissionAction,
): PermissionsDraft {
  const current = draft[resource] ?? []
  const next = current.includes(action)
    ? current.filter((a) => a !== action)
    : [...current, action]
  return { ...draft, [resource]: next }
}

function PermissionMatrix({
  value,
  onChange,
  disabled,
}: {
  value: PermissionsDraft
  onChange: (next: PermissionsDraft) => void
  disabled?: boolean
}) {
  return (
    <div className='max-h-80 overflow-auto rounded-md border'>
      <table className='w-full text-sm'>
        <thead className='sticky top-0 bg-muted/50'>
          <tr>
            <th className='px-3 py-2 text-left font-medium'>Recurso</th>
            {PERMISSION_ACTIONS.map((action) => (
              <th key={action} className='px-3 py-2 text-center font-medium'>
                {ACTION_LABEL[action]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_RESOURCES.map((resource) => (
            <tr key={resource} className='border-t'>
              <td className='px-3 py-2'>
                {RESOURCE_LABEL[resource] ?? resource}
              </td>
              {PERMISSION_ACTIONS.map((action) => (
                <td key={action} className='px-3 py-2 text-center'>
                  <Checkbox
                    disabled={disabled}
                    checked={(value[resource] ?? []).includes(action)}
                    onCheckedChange={() =>
                      onChange(toggleAction(value, resource, action))
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CreateProfileDialog({
  workspaceId,
  basePath,
  onCreated,
}: {
  workspaceId: string
  basePath?: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [permissions, setPermissions] = useState<PermissionsDraft>({})
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    const result = await createProfile(
      workspaceId,
      { name: name.trim(), permissions },
      basePath,
    )
    setSaving(false)
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível criar o perfil.')
      return
    }
    notify.success('Perfil criado')
    setOpen(false)
    setName('')
    setPermissions({})
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size='sm'>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
            Novo perfil
          </Button>
        }
      />
      <DialogContent className='max-w-2xl'>
        <FieldGroup>
          <Field>
            <FieldLabel>Nome do perfil</FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Ex.: Vendedor'
            />
          </Field>
          <Field>
            <FieldLabel>Permissões</FieldLabel>
            <PermissionMatrix value={permissions} onChange={setPermissions} />
          </Field>
        </FieldGroup>
        <div className='mt-4 flex justify-end gap-2'>
          <DialogClose render={<Button variant='ghost'>Cancelar</Button>} />
          <Button onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Criando...' : 'Criar perfil'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditProfileDialog({
  workspaceId,
  basePath,
  profile,
  onUpdated,
}: {
  workspaceId: string
  basePath?: string
  profile: ProfileDTO
  onUpdated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [permissions, setPermissions] = useState<PermissionsDraft>(
    profile.permissions as PermissionsDraft,
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const result = await updateProfile(
      workspaceId,
      profile.id,
      { permissions },
      basePath,
    )
    setSaving(false)
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível salvar o perfil.')
      return
    }
    notify.success('Perfil atualizado')
    setOpen(false)
    onUpdated()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant='outline' size='sm'>
            Editar
          </Button>
        }
      />
      <DialogContent className='max-w-2xl'>
        <p className='mb-2 font-medium text-sm'>{profile.name}</p>
        <PermissionMatrix value={permissions} onChange={setPermissions} />
        <div className='mt-4 flex justify-end gap-2'>
          <DialogClose render={<Button variant='ghost'>Cancelar</Button>} />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CrmProfilesSection({
  workspaceId,
  basePath,
}: {
  workspaceId: string
  basePath?: string
}) {
  const { profiles, isLoading, refetch } = useProfiles(workspaceId, basePath)

  async function handleDelete(profile: ProfileDTO) {
    const result = await deleteProfile(workspaceId, profile.id, basePath)
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível excluir o perfil.')
      return
    }
    notify.success('Perfil excluído')
    refetch()
  }

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle>Perfis de acesso</CardTitle>
        <CreateProfileDialog
          workspaceId={workspaceId}
          basePath={basePath}
          onCreated={refetch}
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Muted>Carregando perfis...</Muted>
        ) : (
          <div className='space-y-2'>
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className='flex items-center justify-between rounded-md border px-3 py-2'
              >
                <div>
                  <p className='font-medium text-sm'>{profile.name}</p>
                  {profile.isSystem ? (
                    <Muted className='text-xs'>Perfil de sistema</Muted>
                  ) : null}
                </div>
                <div className='flex items-center gap-2'>
                  {!profile.isSystem && (
                    <>
                      <EditProfileDialog
                        workspaceId={workspaceId}
                        basePath={basePath}
                        profile={profile}
                        onUpdated={refetch}
                      />
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label='Excluir perfil'
                        onClick={() => handleDelete(profile)}
                      >
                        <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

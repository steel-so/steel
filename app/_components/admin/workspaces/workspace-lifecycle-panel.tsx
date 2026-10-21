'use client'

import {
  Delete02Icon,
  PauseIcon,
  PlayIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { type ReactNode, useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  useChangeWorkspacePlan,
  useDeleteWorkspace,
  useSetWorkspaceAllowedIps,
  useSetWorkspaceStatus,
} from '@/src/hooks/use-admin'
import type { AdminWorkspaceDetailDTO } from '@/types/admin-workspace'
import { PLAN_LABEL } from '../shell/admin-labels'
import { AdminPanel } from '../shell/admin-ui'
import { ConfirmActionDialog } from '../shell/confirm-action-dialog'

type DialogKind = 'suspend' | 'reactivate' | 'plan' | 'ips' | 'delete' | null

const PLANS = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'] as const

function ActionRow({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 px-4 py-3'>
      <div className='min-w-0 flex-1 basis-56'>
        <p className='font-medium text-sm'>{title}</p>
        <p className='text-muted-foreground text-xs'>{description}</p>
      </div>
      <div className='shrink-0'>{action}</div>
    </div>
  )
}

/**
 * Ações de ciclo de vida do workspace (admin global): suspender/reativar,
 * trocar plano e excluir definitivamente. Todas pedem motivo; a exclusão
 * pede o slug digitado.
 */
export function WorkspaceLifecyclePanel({
  workspace,
}: {
  workspace: AdminWorkspaceDetailDTO
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [plan, setPlan] = useState<string>(workspace.activePlan)
  const [forceCancel, setForceCancel] = useState(false)
  const forceCancelId = useId()
  const setStatus = useSetWorkspaceStatus(workspace.id)
  const changePlan = useChangeWorkspacePlan(workspace.id)
  const setIps = useSetWorkspaceAllowedIps(workspace.id)
  const [ipsText, setIpsText] = useState(workspace.allowedIps.join('\n'))
  const remove = useDeleteWorkspace(workspace.id)

  const deleting = workspace.status === 'DELETING'
  const suspended = workspace.status === 'SUSPENDED'

  function close() {
    setDialog(null)
    setPlan(workspace.activePlan)
    setIpsText(workspace.allowedIps.join('\n'))
    setForceCancel(false)
  }

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      notify.success(success)
      close()
      router.refresh()
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <AdminPanel
      title='Ciclo de vida'
      description='Ações auditadas, só para admin global'
      flush
    >
      <div className='divide-y'>
        <ActionRow
          title={suspended ? 'Reativar workspace' : 'Suspender workspace'}
          description={
            suspended
              ? 'Os membros voltam a acessar o app e a API na hora.'
              : 'Bloqueia todos os membros (app e API) e as rotas públicas, sem apagar nada.'
          }
          action={
            <Button
              size='sm'
              variant='outline'
              disabled={deleting}
              onClick={() => setDialog(suspended ? 'reactivate' : 'suspend')}
            >
              <SteelIcon
                icon={suspended ? PlayIcon : PauseIcon}
                strokeWidth={2}
              />
              {suspended ? 'Reativar' : 'Suspender'}
            </Button>
          }
        />
        <ActionRow
          title='Plano'
          description={`Atual: ${PLAN_LABEL[workspace.activePlan]}. Troca manual (contrato fora do AbacatePay); o limite de assentos segue o plano.`}
          action={
            <Button
              size='sm'
              variant='outline'
              disabled={deleting}
              onClick={() => setDialog('plan')}
            >
              Alterar plano
            </Button>
          }
        />
        <ActionRow
          title='Rede permitida (IPs)'
          description={
            workspace.allowedIps.length > 0
              ? `${workspace.allowedIps.length} entrada(s): ${workspace.allowedIps.join(', ')}. Fora delas o acesso é bloqueado.`
              : 'Sem restrição: o workspace abre de qualquer rede.'
          }
          action={
            <Button
              size='sm'
              variant='outline'
              disabled={deleting}
              onClick={() => setDialog('ips')}
            >
              Editar IPs
            </Button>
          }
        />
        <div className='bg-destructive/5'>
          <ActionRow
            title='Excluir workspace'
            description='Faz backup do workspace, cancela as assinaturas no AbacatePay e só então apaga dados e arquivos. Não tem volta sem restaurar o backup.'
            action={
              <Button
                size='sm'
                variant='destructive'
                disabled={deleting}
                onClick={() => setDialog('delete')}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                {deleting ? 'Exclusão em andamento' : 'Excluir'}
              </Button>
            }
          />
        </div>
      </div>

      <ConfirmActionDialog
        open={dialog === 'suspend' || dialog === 'reactivate'}
        onOpenChange={(open) => !open && close()}
        title={
          dialog === 'reactivate'
            ? `Reativar ${workspace.name}`
            : `Suspender ${workspace.name}`
        }
        description={
          dialog === 'reactivate'
            ? 'Os membros recuperam o acesso imediatamente.'
            : `Os ${workspace.memberCount} membro(s) passam a ver uma tela de bloqueio e a API responde WORKSPACE_SUSPENDED. Nada é apagado.`
        }
        confirmLabel={dialog === 'reactivate' ? 'Reativar' : 'Suspender'}
        destructive={dialog === 'suspend'}
        pending={setStatus.isPending}
        onConfirm={({ reason }) =>
          run(
            () =>
              setStatus.mutateAsync({
                action: dialog === 'reactivate' ? 'reactivate' : 'suspend',
                reason,
              }),
            dialog === 'reactivate'
              ? 'Workspace reativado'
              : 'Workspace suspenso',
          )
        }
      />

      <ConfirmActionDialog
        open={dialog === 'plan'}
        onOpenChange={(open) => !open && close()}
        title='Alterar plano'
        description='Muda o plano na hora e zera o trial (o job de fim de trial não desfaz). Assinaturas do AbacatePay não são alteradas.'
        confirmLabel='Alterar plano'
        extraValid={plan !== workspace.activePlan}
        pending={changePlan.isPending}
        onConfirm={({ reason }) =>
          run(() => changePlan.mutateAsync({ plan, reason }), 'Plano alterado')
        }
      >
        <div className='space-y-1.5'>
          <Label>Novo plano</Label>
          <Select
            value={plan}
            onValueChange={(value) => setPlan(String(value))}
          >
            <SelectTrigger className='w-full'>
              <span>{PLAN_LABEL[plan] ?? plan}</span>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {PLANS.map((value) => (
                <SelectItem key={value} value={value}>
                  {PLAN_LABEL[value]}
                  {value === workspace.activePlan ? ' (atual)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={dialog === 'ips'}
        onOpenChange={(open) => !open && close()}
        title='Rede permitida do workspace'
        description='Informe os IPs públicos de saída (um por linha; aceita CIDR, ex.: 200.1.2.0/24). Fora deles, app e API respondem bloqueio. Deixe vazio para liberar qualquer rede. Inclua também o IP de saída da VPN.'
        confirmLabel='Salvar'
        pending={setIps.isPending}
        onConfirm={({ reason }) =>
          run(
            () =>
              setIps.mutateAsync({
                allowedIps: ipsText
                  .split(/[\s,;]+/)
                  .map((entry) => entry.trim())
                  .filter(Boolean),
                reason,
              }),
            'IPs permitidos atualizados',
          )
        }
      >
        <div className='space-y-1.5'>
          <Label>IPs / CIDRs</Label>
          <textarea
            value={ipsText}
            onChange={(event) => setIpsText(event.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={'200.1.2.3\n200.1.2.0/24'}
            className='w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        </div>
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && close()}
        title={`Excluir ${workspace.name} definitivamente`}
        destructive
        requireSlug={workspace.slug}
        confirmLabel='Excluir workspace'
        pendingLabel='Enfileirando...'
        pending={remove.isPending}
        description={
          <ul className='list-disc space-y-1 pl-4'>
            <li>
              Os membros são bloqueados na hora; o worker faz o backup do
              workspace e só apaga depois que ele concluir.
            </li>
            <li>
              Apaga todos os dados (CRM, WhatsApp, membros, perfis...) e os
              arquivos no MinIO. Arquivos não entram no backup.
            </li>
            <li>
              As assinaturas ativas são canceladas no AbacatePay antes de apagar
              qualquer coisa. Se algum cancelamento falhar, a exclusão é barrada
              e nada é apagado.
            </li>
          </ul>
        }
        onConfirm={(values) =>
          run(
            () =>
              remove.mutateAsync({
                ...values,
                ignoreSubscriptionCancelFailure: forceCancel,
              }),
            'Exclusão enfileirada',
          )
        }
      >
        <div className='flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3'>
          <Checkbox
            id={forceCancelId}
            checked={forceCancel}
            onCheckedChange={(state) => setForceCancel(state === true)}
          />
          <Label
            htmlFor={forceCancelId}
            className='block text-muted-foreground text-xs leading-normal'
          >
            Seguir mesmo se o cancelamento da assinatura falhar. As assinaturas
            recusadas ficam registradas na operação e na auditoria — você
            precisará cancelá-las à mão no painel do AbacatePay.
          </Label>
        </div>
      </ConfirmActionDialog>
    </AdminPanel>
  )
}

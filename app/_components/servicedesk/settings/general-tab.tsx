'use client'

import { RefreshIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useMemo, useState } from 'react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useRestoreSdDefaults,
  useSdSettings,
  useUpdateSdSettings,
} from '@/src/hooks/use-sd-config'
import type { UpdateSdSettingsDTO } from '@/src/schemas/sd-settings.schema'
import type { SdSettingsDTO } from '@/types/sd-config'
import {
  FieldBlock,
  NumberInput,
  SD_TICKET_TYPE_OPTIONS,
  SettingsSection,
  SimpleSelect,
  TicketTypeToggles,
  ToggleRow,
  useSdSettingsContext,
} from './sd-settings-kit'

type Draft = Pick<
  SdSettingsDTO,
  | 'ticketPrefixes'
  | 'defaultDepartmentId'
  | 'defaultSlaPolicyId'
  | 'portalEnabled'
  | 'portalTicketTypes'
  | 'portalCompanyScope'
  | 'requireSignatureOnClose'
  | 'requireSolutionOnResolve'
  | 'autoCloseResolvedAfterHours'
  | 'slaAtRiskPercent'
  | 'reopenOnRequesterReply'
  | 'autoAssignRoundRobin'
  | 'kbReviewIntervalDays'
>

function toDraft(settings: SdSettingsDTO): Draft {
  return {
    ticketPrefixes: settings.ticketPrefixes,
    defaultDepartmentId: settings.defaultDepartmentId,
    defaultSlaPolicyId: settings.defaultSlaPolicyId,
    portalEnabled: settings.portalEnabled,
    portalTicketTypes: settings.portalTicketTypes,
    portalCompanyScope: settings.portalCompanyScope,
    requireSignatureOnClose: settings.requireSignatureOnClose,
    requireSolutionOnResolve: settings.requireSolutionOnResolve,
    autoCloseResolvedAfterHours: settings.autoCloseResolvedAfterHours,
    slaAtRiskPercent: settings.slaAtRiskPercent,
    reopenOnRequesterReply: settings.reopenOnRequesterReply,
    autoAssignRoundRobin: settings.autoAssignRoundRobin,
    kbReviewIntervalDays: settings.kbReviewIntervalDays,
  }
}

export function SdGeneralTab() {
  const { workspaceId, canEdit, config } = useSdSettingsContext()
  const settings = useSdSettings(workspaceId)
  const update = useUpdateSdSettings(workspaceId)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    if (settings.data) setDraft(toDraft(settings.data))
  }, [settings.data])

  const departmentOptions = useMemo(
    () =>
      (config?.departments ?? []).flatMap((root) => [
        { value: root.id, label: root.name },
        ...root.children.map((child) => ({
          value: child.id,
          label: `${root.name} › ${child.name}`,
        })),
      ]),
    [config?.departments],
  )
  const policyOptions = (config?.slaPolicies ?? []).map((p) => ({
    value: p.id,
    label:
      p.isDefault && p.name.trim().toLowerCase() !== 'padrão'
        ? `${p.name} (padrão)`
        : p.name,
  }))

  if (!draft || !settings.data) {
    return <Skeleton className='h-96 w-full' />
  }

  const original = toDraft(settings.data)
  const dirty = JSON.stringify(original) !== JSON.stringify(draft)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current))

  async function save() {
    if (!draft) return
    const changes: UpdateSdSettingsDTO = {}
    for (const key of Object.keys(draft) as (keyof Draft)[]) {
      if (JSON.stringify(draft[key]) !== JSON.stringify(original[key])) {
        Object.assign(changes, { [key]: draft[key] })
      }
    }
    try {
      await update.mutateAsync(changes)
      notify.success('Configurações salvas')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-5'>
      <SettingsSection
        title='Numeração dos chamados'
        description='O número é sequencial por workspace; o prefixo muda por tipo (ex.: INC-1024).'
      >
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          {SD_TICKET_TYPE_OPTIONS.map((option) => (
            <FieldBlock key={option.value} label={option.label}>
              <Input
                value={draft.ticketPrefixes[option.value]}
                maxLength={8}
                disabled={!canEdit}
                onChange={(e) =>
                  set('ticketPrefixes', {
                    ...draft.ticketPrefixes,
                    [option.value]: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ''),
                  })
                }
                className='font-mono uppercase'
              />
            </FieldBlock>
          ))}
        </div>
        <p className='text-xs text-muted-foreground'>
          Próximo número:{' '}
          <span className='font-mono font-medium text-foreground'>
            {settings.data.nextTicketNumber}
          </span>
        </p>
      </SettingsSection>

      <SettingsSection
        title='Padrões de roteamento'
        description='Usados quando o catálogo não define departamento/SLA para o chamado.'
      >
        <div className='grid gap-4 md:grid-cols-2'>
          <FieldBlock label='Departamento padrão'>
            <SimpleSelect
              value={draft.defaultDepartmentId}
              onChange={(value) => set('defaultDepartmentId', value)}
              options={departmentOptions}
              allowEmpty
              emptyLabel='Nenhum'
              disabled={!canEdit}
            />
          </FieldBlock>
          <FieldBlock
            label='Política de SLA padrão'
            hint='Também marca a política como padrão na aba SLA.'
          >
            <SimpleSelect
              value={draft.defaultSlaPolicyId}
              onChange={(value) => set('defaultSlaPolicyId', value)}
              options={policyOptions}
              allowEmpty
              emptyLabel='Nenhuma'
              disabled={!canEdit}
            />
          </FieldBlock>
        </div>
        <ToggleRow
          label='Atribuição automática (round-robin)'
          description='Distribui os chamados novos entre os agentes do departamento, em rodízio.'
          checked={draft.autoAssignRoundRobin}
          onCheckedChange={(value) => set('autoAssignRoundRobin', value)}
          disabled={!canEdit}
        />
      </SettingsSection>

      <SettingsSection
        title='Portal do solicitante'
        description='Membros sem departamento abrem e acompanham chamados pelo portal.'
      >
        <ToggleRow
          label='Portal habilitado'
          checked={draft.portalEnabled}
          onCheckedChange={(value) => set('portalEnabled', value)}
          disabled={!canEdit}
        />
        <FieldBlock
          label='Tipos que o solicitante pode abrir'
          hint='Sem nenhum marcado, o solicitante não abre chamados pelo portal.'
        >
          <TicketTypeToggles
            value={draft.portalTicketTypes}
            onChange={(value) => set('portalTicketTypes', value)}
            disabled={!canEdit || !draft.portalEnabled}
            emptyLabel='nenhum'
          />
        </FieldBlock>
        <ToggleRow
          label='Contato externo vê os chamados da empresa dele'
          description='No portal por link mágico (/suporte), o contato acompanha todos os chamados das empresas às quais está vinculado. Desligado, ele vê apenas os chamados em que é o contato.'
          checked={draft.portalCompanyScope}
          onCheckedChange={(value) => set('portalCompanyScope', value)}
          disabled={!canEdit || !draft.portalEnabled}
        />
      </SettingsSection>

      <SettingsSection
        title='Exigências e ciclo de vida'
        description='Regras aplicadas ao mudar de fase e depois da resolução.'
      >
        <ToggleRow
          label='Exigir solução ao resolver'
          description='Fases de resolvido pedem o texto da solução e a classificação da solução.'
          checked={draft.requireSolutionOnResolve}
          onCheckedChange={(value) => set('requireSolutionOnResolve', value)}
          disabled={!canEdit}
        />
        <ToggleRow
          label='Exigir assinatura ao fechar'
          description='Fases de fechado só aceitam o chamado com a assinatura de aceite colhida.'
          checked={draft.requireSignatureOnClose}
          onCheckedChange={(value) => set('requireSignatureOnClose', value)}
          disabled={!canEdit}
        />
        <ToggleRow
          label='Reabrir quando o solicitante responder'
          description='Nova mensagem do solicitante num chamado resolvido volta-o para atendimento.'
          checked={draft.reopenOnRequesterReply}
          onCheckedChange={(value) => set('reopenOnRequesterReply', value)}
          disabled={!canEdit}
        />
        <div className='grid gap-4 md:grid-cols-2'>
          <FieldBlock
            label='Fechar resolvidos automaticamente após'
            hint='0 desliga o fechamento automático.'
          >
            <NumberInput
              value={draft.autoCloseResolvedAfterHours}
              onCommit={(value) =>
                set('autoCloseResolvedAfterHours', value ?? 0)
              }
              min={0}
              max={8760}
              suffix='horas'
              disabled={!canEdit}
            />
          </FieldBlock>
          <FieldBlock
            label='SLA em risco a partir de'
            hint='Percentual do prazo consumido para alertar e escalonar.'
          >
            <NumberInput
              value={draft.slaAtRiskPercent}
              onCommit={(value) => set('slaAtRiskPercent', value ?? 80)}
              min={1}
              max={99}
              suffix='%'
              disabled={!canEdit}
            />
          </FieldBlock>
          <FieldBlock
            label='Validade da revisão dos artigos'
            hint='Padrão do KCS: depois de aprovado, o artigo volta para revisão neste prazo. Cada artigo pode ter o seu.'
          >
            <NumberInput
              value={draft.kbReviewIntervalDays}
              onCommit={(value) => set('kbReviewIntervalDays', value ?? 180)}
              min={1}
              max={3650}
              suffix='dias'
              disabled={!canEdit}
            />
          </FieldBlock>
        </div>
      </SettingsSection>

      {canEdit ? (
        <div className='sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xs'>
          <RestoreDefaultsButton />
          <div className='flex items-center gap-2'>
            {dirty ? (
              <span className='text-xs text-muted-foreground'>
                Alterações não salvas
              </span>
            ) : null}
            <Button
              variant='outline'
              size='sm'
              disabled={!dirty || update.isPending}
              onClick={() => setDraft(original)}
            >
              Descartar
            </Button>
            <Button
              size='sm'
              disabled={!dirty || update.isPending}
              onClick={save}
            >
              {update.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RestoreDefaultsButton() {
  const { workspaceId } = useSdSettingsContext()
  const restore = useRestoreSdDefaults(workspaceId)

  async function handleRestore() {
    try {
      const summary = await restore.mutateAsync()
      const created = Object.values(summary).reduce((n, v) => n + v, 0)
      notify.success(
        created === 0
          ? 'Nada a restaurar: os padrões ITIL já estão presentes'
          : `${created} itens padrão recriados`,
      )
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant='ghost' size='sm'>
            <SteelIcon icon={RefreshIcon} strokeWidth={2} />
            Restaurar padrões ITIL
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restaurar padrões ITIL</AlertDialogTitle>
          <AlertDialogDescription>
            Recria o que estiver faltando dos padrões (fases por tipo, matriz de
            prioridade, severidades, classificações, calendários com feriados,
            SLAs, tipos de CI, departamentos, catálogo de exemplo, modelos e
            regras). Nada do que você já customizou é alterado ou apagado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restore.isPending}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={restore.isPending}
            onClick={handleRestore}
          >
            Restaurar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

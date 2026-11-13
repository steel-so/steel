'use client'

import { useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCrmRetentionSettings,
  useUpdateCrmRetentionSettings,
} from '@/src/hooks/use-crm-retention'
import {
  CRM_RETENTION_DUE_DAYS_MAX,
  CRM_RETENTION_DUE_DAYS_MIN,
} from '@/src/schemas/crm-retention.schema'

/**
 * Retenção de clientes: o que o CRM abre para o responsável da conta quando
 * um cliente dá nota baixa na pesquisa ou a saúde dele cai. OWNER/ADMIN
 * configuram; os demais membros só visualizam.
 */
export function CrmRetentionSettingsSection({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isPrivileged = useIsPrivileged()
  const { data: settings, isLoading } = useCrmRetentionSettings(workspaceId)
  const update = useUpdateCrmRetentionSettings(workspaceId)

  const [onDetractor, setOnDetractor] = useState(true)
  const [onHealthDrop, setOnHealthDrop] = useState(true)
  const [onSlaBreach, setOnSlaBreach] = useState(false)
  const [createOpportunity, setCreateOpportunity] = useState(false)
  const [dueDays, setDueDays] = useState('2')

  useEffect(() => {
    if (!settings) return
    setOnDetractor(settings.onDetractor)
    setOnHealthDrop(settings.onHealthDrop)
    setOnSlaBreach(settings.onSlaBreach)
    setCreateOpportunity(settings.createOpportunity)
    setDueDays(String(settings.taskDueDays))
  }, [settings])

  const days = Number(dueDays)
  const daysValid =
    Number.isInteger(days) &&
    days >= CRM_RETENTION_DUE_DAYS_MIN &&
    days <= CRM_RETENTION_DUE_DAYS_MAX
  const dirty =
    !!settings &&
    (onDetractor !== settings.onDetractor ||
      onHealthDrop !== settings.onHealthDrop ||
      onSlaBreach !== settings.onSlaBreach ||
      createOpportunity !== settings.createOpportunity ||
      days !== settings.taskDueDays)

  async function handleSave() {
    if (!daysValid) {
      notify.error(
        `Informe um prazo entre ${CRM_RETENTION_DUE_DAYS_MIN} e ${CRM_RETENTION_DUE_DAYS_MAX} dias.`,
      )
      return
    }
    try {
      await update.mutateAsync({
        onDetractor,
        onHealthDrop,
        onSlaBreach,
        createOpportunity,
        taskDueDays: days,
      })
      notify.success('Regras de retenção salvas')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retenção de clientes</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {isLoading || !settings ? (
          <Muted>Carregando...</Muted>
        ) : (
          <>
            <FieldGroup>
              <Field orientation='horizontal'>
                <Switch
                  id='crm-retention-detractor'
                  checked={onDetractor}
                  onCheckedChange={(checked) => setOnDetractor(checked === true)}
                  disabled={!isPrivileged}
                />
                <FieldLabel htmlFor='crm-retention-detractor'>
                  Criar tarefa quando o cliente der nota baixa (NPS ou CSAT)
                </FieldLabel>
              </Field>

              <Field orientation='horizontal'>
                <Switch
                  id='crm-retention-health'
                  checked={onHealthDrop}
                  onCheckedChange={(checked) =>
                    setOnHealthDrop(checked === true)
                  }
                  disabled={!isPrivileged}
                />
                <FieldLabel htmlFor='crm-retention-health'>
                  Criar tarefa quando a saúde do cliente cair
                </FieldLabel>
              </Field>

              <Field orientation='horizontal'>
                <Switch
                  id='crm-retention-sla'
                  checked={onSlaBreach}
                  onCheckedChange={(checked) => setOnSlaBreach(checked === true)}
                  disabled={!isPrivileged}
                />
                <FieldLabel htmlFor='crm-retention-sla'>
                  Criar tarefa quando um chamado do cliente estourar o SLA
                </FieldLabel>
              </Field>

              <Field orientation='horizontal'>
                <Switch
                  id='crm-retention-opportunity'
                  checked={createOpportunity}
                  onCheckedChange={(checked) =>
                    setCreateOpportunity(checked === true)
                  }
                  disabled={!isPrivileged}
                />
                <FieldLabel htmlFor='crm-retention-opportunity'>
                  Abrir também uma oportunidade de retenção
                </FieldLabel>
              </Field>

              <Field>
                <FieldLabel htmlFor='crm-retention-due-days'>
                  Prazo da tarefa (dias)
                </FieldLabel>
                <Input
                  id='crm-retention-due-days'
                  type='number'
                  min={CRM_RETENTION_DUE_DAYS_MIN}
                  max={CRM_RETENTION_DUE_DAYS_MAX}
                  value={dueDays}
                  onChange={(e) => setDueDays(e.target.value)}
                  disabled={!isPrivileged}
                  aria-invalid={!daysValid}
                  className='max-w-40'
                />
                <FieldDescription>
                  A tarefa vai para o responsável pela conta da empresa do
                  cliente (ou para um administrador, se não houver). Cada
                  resposta ou queda gera no máximo uma tarefa. A oportunidade
                  entra na primeira etapa aberta do funil padrão.
                </FieldDescription>
              </Field>
            </FieldGroup>

            {isPrivileged ? (
              <div className='flex justify-end'>
                <Button
                  onClick={handleSave}
                  disabled={!dirty || update.isPending}
                >
                  {update.isPending ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            ) : (
              <Muted>
                Somente proprietários e administradores podem alterar estas
                regras.
              </Muted>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

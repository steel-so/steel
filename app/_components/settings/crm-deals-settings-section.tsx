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
  useCrmDealsSettings,
  useUpdateCrmDealsSettings,
} from '@/src/hooks/use-crm-deals'

/**
 * Cobrança na proposta e a janela de renovação dos contratos. A cobrança
 * nasce desligada e só tem o provedor de teste; os demais membros só
 * visualizam. Os documentos não têm assinatura (ADR 0063): o aceite registra
 * nome, e-mail e a versão aceita, então a antiga chave de assinatura saiu.
 */
export function CrmDealsSettingsSection({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isPrivileged = useIsPrivileged()
  const { data: settings, isLoading } = useCrmDealsSettings(workspaceId)
  const update = useUpdateCrmDealsSettings(workspaceId)

  const [payment, setPayment] = useState(false)
  const [leadDays, setLeadDays] = useState('60')
  const [autoCreate, setAutoCreate] = useState(true)

  useEffect(() => {
    if (!settings) return
    setPayment(settings.proposalPaymentEnabled)
    setLeadDays(String(settings.renewalLeadDays))
    setAutoCreate(settings.renewalAutoCreate)
  }, [settings])

  const days = Number(leadDays)
  const daysValid = Number.isInteger(days) && days >= 7 && days <= 365
  const dirty =
    !!settings &&
    (payment !== settings.proposalPaymentEnabled ||
      days !== settings.renewalLeadDays ||
      autoCreate !== settings.renewalAutoCreate)

  async function handleSave() {
    if (!daysValid) {
      notify.error('Informe uma janela de renovação entre 7 e 365 dias.')
      return
    }
    try {
      await update.mutateAsync({
        proposalPaymentEnabled: payment,
        renewalLeadDays: days,
        renewalAutoCreate: autoCreate,
      })
      notify.success('Configurações salvas')
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobrança e renovações</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {isLoading || !settings ? (
          <Muted>Carregando...</Muted>
        ) : (
          <>
            <FieldGroup>
              <Field orientation='horizontal'>
                <Switch
                  id='crm-deals-payment'
                  checked={payment}
                  onCheckedChange={(checked) => setPayment(checked === true)}
                  disabled={!isPrivileged}
                />
                <div className='flex flex-col gap-1'>
                  <FieldLabel htmlFor='crm-deals-payment'>
                    Cobrar por Pix ou boleto na proposta
                  </FieldLabel>
                  <FieldDescription>
                    Ainda não há um provedor de pagamento escolhido: as
                    cobranças saem pelo provedor de teste, que não movimenta
                    dinheiro de verdade. O pagamento confirmado marca a
                    oportunidade como ganha.
                  </FieldDescription>
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor='crm-deals-lead-days'>
                  Avisar sobre contratos que vencem em (dias)
                </FieldLabel>
                <Input
                  id='crm-deals-lead-days'
                  type='number'
                  min={7}
                  max={365}
                  value={leadDays}
                  onChange={(e) => setLeadDays(e.target.value)}
                  disabled={!isPrivileged}
                  aria-invalid={!daysValid}
                  className='max-w-40'
                />
                <FieldDescription>
                  O responsável recebe o aviso uma vez, quando o contrato entra
                  nesta janela.
                </FieldDescription>
              </Field>

              <Field orientation='horizontal'>
                <Switch
                  id='crm-deals-auto-renew'
                  checked={autoCreate}
                  onCheckedChange={(checked) => setAutoCreate(checked === true)}
                  disabled={!isPrivileged}
                />
                <FieldLabel htmlFor='crm-deals-auto-renew'>
                  Criar a oportunidade de renovação sozinho
                </FieldLabel>
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
                configurações.
              </Muted>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

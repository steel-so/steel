'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import {
  useUpdateWhatsAppAdSettings,
  useWhatsAppAdSettings,
} from '@/src/hooks/use-whatsapp-ads'
import { useWhatsAppAssignableMembers } from '@/src/hooks/use-whatsapp-conversations'

const NO_OWNER = 'none'

/** Opt-in of the ad attribution and of the lead creation (off by default). */
export function WhatsAppAdsSettings({ workspaceId }: { workspaceId: string }) {
  const settings = useWhatsAppAdSettings(workspaceId)
  const members = useWhatsAppAssignableMembers(workspaceId)
  const save = useUpdateWhatsAppAdSettings(workspaceId)
  const [enabled, setEnabled] = useState(false)
  const [createLeads, setCreateLeads] = useState(false)
  const [ownerId, setOwnerId] = useState(NO_OWNER)
  const [leadSource, setLeadSource] = useState('')

  useEffect(() => {
    if (!settings.data) return
    setEnabled(settings.data.enabled)
    setCreateLeads(settings.data.createLeads)
    setOwnerId(settings.data.leadOwnerId ?? NO_OWNER)
    setLeadSource(settings.data.leadSource)
  }, [settings.data])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await save.mutateAsync({
        enabled,
        createLeads,
        leadOwnerId: ownerId === NO_OWNER ? null : ownerId,
        leadSource: leadSource.trim() || undefined,
      })
      notify.success('Configuração salva.')
    } catch (err) {
      notify.error(err, 'Não foi possível salvar a configuração.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Atribuição de anúncios</CardTitle>
        <CardDescription>
          Guarda de qual anúncio Click-to-WhatsApp cada conversa veio. Só vale
          para conexões da API oficial da Meta, e só para conversas iniciadas
          depois que a opção for ligada.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isLoading ? (
          <p className='text-muted-foreground text-sm'>Carregando...</p>
        ) : settings.error ? (
          <p className='text-destructive text-sm'>
            {settings.error instanceof Error
              ? settings.error.message
              : 'Não foi possível carregar a configuração.'}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className='space-y-4'>
            <div className='flex items-center justify-between gap-4 rounded-md border p-3'>
              <div>
                <p className='font-medium text-sm'>Atribuir conversas</p>
                <p className='text-muted-foreground text-xs'>
                  Registra o anúncio de origem e mostra o aviso na conversa.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label='Atribuir conversas a anúncios'
              />
            </div>

            <div className='flex items-center justify-between gap-4 rounded-md border p-3'>
              <div>
                <p className='font-medium text-sm'>Criar lead no CRM</p>
                <p className='text-muted-foreground text-xs'>
                  Abre um lead (ou reaproveita o aberto, pelo telefone) com a
                  origem do anúncio. Exige o módulo CRM.
                </p>
              </div>
              <Switch
                checked={createLeads}
                disabled={!enabled}
                onCheckedChange={setCreateLeads}
                aria-label='Criar lead no CRM'
              />
            </div>

            {enabled && createLeads ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label htmlFor='adLeadSource'>Origem do lead</Label>
                  <Input
                    id='adLeadSource'
                    value={leadSource}
                    maxLength={60}
                    onChange={(event) => setLeadSource(event.target.value)}
                  />
                  <p className='text-muted-foreground text-xs'>
                    O título do anúncio é adicionado ao final.
                  </p>
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor='adLeadOwner'>Responsável pelo lead</Label>
                  <Select
                    value={ownerId}
                    onValueChange={(value) => setOwnerId(value ?? NO_OWNER)}
                  >
                    <SelectTrigger id='adLeadOwner' className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        <SelectItem value={NO_OWNER}>
                          Regras de roteamento
                        </SelectItem>
                        {(members.data ?? []).map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            <Button type='submit' disabled={save.isPending}>
              {save.isPending ? 'Salvando...' : 'Salvar configuração'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

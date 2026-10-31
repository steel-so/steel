'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { useCrmPipelines } from '@/src/hooks/use-crm-pipeline'
import {
  useUpdateWhatsAppCommerceSettings,
  useWhatsAppCommerceSettings,
  useWhatsAppStores,
} from '@/src/hooks/use-whatsapp-commerce'
import { useWhatsAppPixSettings } from '@/src/hooks/use-whatsapp-pix'
import type { WhatsAppCatalogSourceDTO } from '@/types/whatsapp-commerce'
import { SimpleSelect } from '../chatbots/chatbot-select'

const SOURCE_OPTIONS: Array<{
  value: WhatsAppCatalogSourceDTO
  label: string
}> = [
  { value: 'CRM', label: 'Produtos do CRM' },
  { value: 'TRAY', label: 'Loja Tray' },
  { value: 'NUVEMSHOP', label: 'Loja Nuvemshop' },
]

const DEFAULT_PIPELINE = '__default'

function Toggle({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
      <div>
        <p className='font-medium text-sm'>{label}</p>
        <p className='text-muted-foreground text-xs'>{help}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}

/**
 * Catálogo no WhatsApp (Z8), só OWNER/ADMIN. Tudo nasce desligado: o catálogo
 * precisa estar criado e ligado à conta do WhatsApp Business no Gerenciador
 * de Comércio da Meta antes de ser ativado aqui.
 */
export function CatalogSettings({ workspaceId }: { workspaceId: string }) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppCommerceSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppCommerceSettings(workspaceId)
  const stores = useWhatsAppStores(workspaceId)
  const pipelines = useCrmPipelines(workspaceId)
  const pix = useWhatsAppPixSettings(workspaceId, isAdmin)

  const [enabled, setEnabled] = useState(false)
  const [catalogId, setCatalogId] = useState('')
  const [source, setSource] = useState<WhatsAppCatalogSourceDTO>('CRM')
  const [storeId, setStoreId] = useState('')
  const [storeSync, setStoreSync] = useState(false)
  const [createsDeal, setCreatesDeal] = useState(true)
  const [pipelineId, setPipelineId] = useState(DEFAULT_PIPELINE)
  const [orderPix, setOrderPix] = useState(false)

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setEnabled(data.catalogEnabled)
    setCatalogId(data.metaCatalogId ?? '')
    setSource(data.catalogSource)
    setStoreId(data.catalogIntegrationId ?? '')
    setStoreSync(data.storeSyncEnabled)
    setCreatesDeal(data.orderCreatesOpportunity)
    setPipelineId(data.orderPipelineId ?? DEFAULT_PIPELINE)
    setOrderPix(data.orderPixEnabled)
  }, [settings.data])

  if (!isAdmin) {
    return (
      <p className='text-muted-foreground text-sm'>
        Só administradores configuram o catálogo.
      </p>
    )
  }

  const storeOptions = (stores.data ?? [])
    .filter((store) => store.provider === source)
    .map((store) => ({ value: store.id, label: store.name }))
  const pipelineOptions = [
    { value: DEFAULT_PIPELINE, label: 'Pipeline padrão' },
    ...(pipelines.data ?? []).map((pipeline) => ({
      value: pipeline.id,
      label: pipeline.name,
    })),
  ]

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      {
        catalogEnabled: enabled,
        metaCatalogId: catalogId.trim() || null,
        catalogSource: source,
        catalogIntegrationId: source === 'CRM' ? null : storeId || null,
        storeSyncEnabled: storeSync,
        orderCreatesOpportunity: createsDeal,
        orderPipelineId: pipelineId === DEFAULT_PIPELINE ? null : pipelineId,
        orderPixEnabled: orderPix,
      },
      {
        onSuccess: () => notify.success('Configuração do catálogo salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-xl space-y-4'>
      <Toggle
        label='Catálogo no WhatsApp'
        help='Os atendentes enviam produtos pela conversa e o carrinho que o cliente monta chega como pedido.'
        checked={enabled}
        onChange={setEnabled}
      />

      <div className='space-y-1.5'>
        <Label htmlFor='metaCatalogId'>Id do catálogo na Meta</Label>
        <Input
          id='metaCatalogId'
          inputMode='numeric'
          placeholder='Ex.: 1234567890123456'
          value={catalogId}
          onChange={(event) => setCatalogId(event.target.value)}
        />
        <p className='text-muted-foreground text-xs'>
          Crie o catálogo no Gerenciador de Comércio da Meta e ligue-o ao número
          do WhatsApp Business (Configurações do catálogo, Conectar ativo). O id
          do conteúdo de cada produto lá precisa ser o SKU do produto (ou o id
          interno, quando não há SKU).
        </p>
      </div>

      <div className='space-y-1.5'>
        <Label>De onde vêm os produtos</Label>
        <SimpleSelect
          ariaLabel='Origem dos produtos'
          value={source}
          options={SOURCE_OPTIONS}
          onChange={(value) => setSource(value as WhatsAppCatalogSourceDTO)}
        />
      </div>

      {source !== 'CRM' ? (
        <>
          <div className='space-y-1.5'>
            <Label>Loja</Label>
            <SimpleSelect
              ariaLabel='Loja de origem'
              value={storeId}
              placeholder={
                storeOptions.length === 0
                  ? 'Conecte a loja na aba Lojas'
                  : 'Escolha a loja'
              }
              options={storeOptions}
              onChange={setStoreId}
            />
          </div>
          <Toggle
            label='Ler os produtos direto da loja'
            help='Usa a API da loja com as credenciais salvas nela. Desligado, a sincronização recusa a origem.'
            checked={storeSync}
            onChange={setStoreSync}
          />
        </>
      ) : null}

      <Toggle
        label='Criar lead e oportunidade a cada pedido'
        help='O cliente vira lead (sem duplicar) e o carrinho vira uma oportunidade com os itens.'
        checked={createsDeal}
        onChange={setCreatesDeal}
      />
      {createsDeal ? (
        <div className='space-y-1.5'>
          <Label>Pipeline das oportunidades</Label>
          <SimpleSelect
            ariaLabel='Pipeline das oportunidades'
            value={pipelineId}
            options={pipelineOptions}
            onChange={setPipelineId}
          />
        </div>
      ) : null}

      <Toggle
        label='Cobrar o pedido via Pix'
        help={
          pix.data?.enabled
            ? 'Envia a cobrança Pix do total assim que o pedido chega.'
            : 'Ative antes o Pix na conversa em Configurações. O provedor de Pix ainda é de teste.'
        }
        checked={orderPix}
        onChange={setOrderPix}
        disabled={!pix.data?.enabled}
      />

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar catálogo'}
      </Button>
    </form>
  )
}

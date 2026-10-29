'use client'

import {
  ArrowRight01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  ServerStack01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SdCustomFieldsView } from '@/app/_components/servicedesk/custom-fields/sd-custom-fields-form'
import {
  formatSdDate,
  SD_CI_STATUS_LABEL,
  SD_CI_STATUS_TONE,
  SD_RISK_LABEL,
  SD_RISK_TONE,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-labels'
import {
  SdConfirmDelete,
  SdLinkedTickets,
  SdPill,
  SdWarrantyBadge,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-widgets'
import { SdInfoRow } from '@/app/_components/servicedesk/directory/shared/sd-form-bits'
import { SdConfigItemAlerts } from '@/app/_components/servicedesk/monitoring/sd-monitor-alert-list'
import { SdConfigItemRoutines } from '@/app/_components/servicedesk/recurring/sd-recurring-bits'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useDeleteSdConfigItem,
  useSdConfigItem,
  useSdConfigItemTypes,
} from '@/src/hooks/use-sd-config-items'
import type { SdConfigItemDTO } from '@/types/sd-config-item'

function attributeText(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

/**
 * Detalhe do CI: Dados (com atributos do tipo e garantia), Relacionamentos
 * (cadeia de pais → item → filhos, navegável), Chamados e Rotinas (os
 * chamados recorrentes que incidem sobre este item).
 */
export function SdConfigItemDetailSheet({
  workspaceId,
  slug,
  itemId,
  onNavigate,
  onOpenChange,
  onEdit,
  onAddChild,
}: {
  workspaceId: string
  slug: string
  itemId: string | null
  /** Abre outro CI (pai/filho) no mesmo painel. */
  onNavigate: (itemId: string) => void
  onOpenChange: (open: boolean) => void
  onEdit: (item: SdConfigItemDTO) => void
  onAddChild: (parent: { id: string; label: string }) => void
}) {
  const { data: item, isLoading } = useSdConfigItem(workspaceId, itemId)
  const { data: types = [] } = useSdConfigItemTypes(workspaceId)
  const remove = useDeleteSdConfigItem(workspaceId)
  const [confirming, setConfirming] = useState(false)
  const schema = types.find((t) => t.id === item?.typeId)?.attributeSchema ?? []
  const labelOf = (key: string) =>
    schema.find((def) => def.key === key)?.label ?? key

  return (
    <Sheet open={Boolean(itemId)} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col gap-0 p-0 sm:max-w-2xl'>
        <SheetHeader className='border-b px-6 py-4'>
          {item ? (
            <div className='flex items-start justify-between gap-3 pr-8'>
              <div className='min-w-0'>
                <SheetTitle className='truncate'>{item.name}</SheetTitle>
                <SheetDescription className='flex flex-wrap items-center gap-2'>
                  {item.code ? (
                    <span className='font-mono'>{item.code}</span>
                  ) : null}
                  {item.type ? (
                    <SdPill className='bg-muted text-foreground'>
                      {item.type.name}
                    </SdPill>
                  ) : null}
                  <SdPill className={SD_CI_STATUS_TONE[item.status]}>
                    {SD_CI_STATUS_LABEL[item.status]}
                  </SdPill>
                  <SdPill className={SD_RISK_TONE[item.criticality]}>
                    Criticidade {SD_RISK_LABEL[item.criticality].toLowerCase()}
                  </SdPill>
                  <SdWarrantyBadge until={item.warrantyUntil} />
                </SheetDescription>
              </div>
              <div className='flex shrink-0 gap-1'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => onEdit(item)}
                >
                  <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  Editar
                </Button>
                <Button
                  variant='outline'
                  size='icon-sm'
                  onClick={() => setConfirming(true)}
                  aria-label='Excluir'
                >
                  <SteelIcon
                    icon={Delete02Icon}
                    strokeWidth={2}
                    className='text-destructive'
                  />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <SheetTitle>
                <Skeleton className='h-5 w-48' />
              </SheetTitle>
              <SheetDescription>
                <Skeleton className='h-4 w-32' />
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        {isLoading || !item ? (
          <div className='flex flex-col gap-3 p-6'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-2/3' />
          </div>
        ) : (
          <Tabs
            defaultValue='data'
            className='flex min-h-0 flex-1 flex-col gap-0'
          >
            <TabsList className='mx-6 mt-4'>
              <TabsTrigger value='data'>Dados</TabsTrigger>
              <TabsTrigger value='tree'>
                Relacionamentos ({item.children.length})
              </TabsTrigger>
              <TabsTrigger value='tickets'>Chamados</TabsTrigger>
              <TabsTrigger value='routines'>Rotinas</TabsTrigger>
              <TabsTrigger value='monitoring'>Monitoramento</TabsTrigger>
            </TabsList>
            <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
              <TabsContent value='data'>
                <dl className='divide-y'>
                  <SdInfoRow label='Cliente/empresa'>
                    {item.customer?.name}
                  </SdInfoRow>
                  <SdInfoRow label='Departamento'>
                    {item.department?.name}
                  </SdInfoRow>
                  <SdInfoRow label='Responsável'>{item.owner?.name}</SdInfoRow>
                  <SdInfoRow label='Fabricante/modelo'>
                    {[item.manufacturer, item.model].filter(Boolean).join(' ')}
                  </SdInfoRow>
                  <SdInfoRow label='Nº de série'>
                    {item.serialNumber ? (
                      <span className='font-mono'>{item.serialNumber}</span>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Endereço IP'>
                    {item.ipAddress ? (
                      <span className='font-mono'>{item.ipAddress}</span>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Localização'>{item.location}</SdInfoRow>
                  <SdInfoRow label='Compra'>
                    {item.purchasedAt ? formatSdDate(item.purchasedAt) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Garantia'>
                    <SdWarrantyBadge until={item.warrantyUntil} />
                  </SdInfoRow>
                  <SdInfoRow label='Observações'>
                    {item.notes ? (
                      <span className='whitespace-pre-wrap'>{item.notes}</span>
                    ) : null}
                  </SdInfoRow>
                </dl>
                {Object.keys(item.attributes).length > 0 ? (
                  <div className='mt-4'>
                    <h4 className='mb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
                      Atributos {item.type ? `de ${item.type.name}` : ''}
                    </h4>
                    <dl className='divide-y'>
                      {Object.entries(item.attributes).map(([key, value]) => (
                        <SdInfoRow key={key} label={labelOf(key)}>
                          {attributeText(value)}
                        </SdInfoRow>
                      ))}
                    </dl>
                  </div>
                ) : null}
                <SdCustomFieldsView
                  workspaceId={workspaceId}
                  entity='CONFIG_ITEM'
                  values={item.customFields}
                />
              </TabsContent>

              <TabsContent value='tree' className='flex flex-col gap-3'>
                <ol className='flex flex-col'>
                  {item.ancestors.map((a, depth) => (
                    <li key={a.id} style={{ paddingLeft: depth * 16 }}>
                      <button
                        type='button'
                        onClick={() => onNavigate(a.id)}
                        className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground text-sm hover:bg-muted hover:text-foreground'
                      >
                        <SteelIcon
                          icon={ServerStack01Icon}
                          strokeWidth={2}
                          className='size-4'
                        />
                        <span className='truncate'>{a.name}</span>
                        {a.code ? (
                          <span className='font-mono text-xs'>{a.code}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  <li style={{ paddingLeft: item.ancestors.length * 16 }}>
                    <div className='flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 font-medium text-primary text-sm'>
                      <SteelIcon
                        icon={ServerStack01Icon}
                        strokeWidth={2}
                        className='size-4'
                      />
                      <span className='truncate'>{item.name}</span>
                      <span className='text-xs'>(este item)</span>
                    </div>
                  </li>
                  {item.children.map((child) => (
                    <li
                      key={child.id}
                      style={{ paddingLeft: (item.ancestors.length + 1) * 16 }}
                    >
                      <button
                        type='button'
                        onClick={() => onNavigate(child.id)}
                        className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted'
                      >
                        <SteelIcon
                          icon={ArrowRight01Icon}
                          strokeWidth={2}
                          className='size-3.5 text-muted-foreground'
                        />
                        <span className='min-w-0 flex-1 truncate'>
                          {child.name}
                          {child.code ? (
                            <span className='ml-2 font-mono text-muted-foreground text-xs'>
                              {child.code}
                            </span>
                          ) : null}
                        </span>
                        {child.typeName ? (
                          <span className='text-muted-foreground text-xs'>
                            {child.typeName}
                          </span>
                        ) : null}
                        {child.childrenCount > 0 ? (
                          <span className='text-muted-foreground text-xs tabular-nums'>
                            +{child.childrenCount}
                          </span>
                        ) : null}
                        <SdPill className={cn(SD_CI_STATUS_TONE[child.status])}>
                          {SD_CI_STATUS_LABEL[child.status]}
                        </SdPill>
                      </button>
                    </li>
                  ))}
                </ol>
                <Button
                  size='sm'
                  variant='outline'
                  className='self-start'
                  onClick={() => onAddChild({ id: item.id, label: item.name })}
                >
                  <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                  Adicionar item filho
                </Button>
              </TabsContent>

              <TabsContent value='tickets'>
                <SdLinkedTickets slug={slug} tickets={item.recentTickets} />
              </TabsContent>

              <TabsContent value='routines'>
                <SdConfigItemRoutines
                  workspaceId={workspaceId}
                  configItemId={item.id}
                  slug={slug}
                />
              </TabsContent>

              <TabsContent value='monitoring'>
                <SdConfigItemAlerts
                  workspaceId={workspaceId}
                  slug={slug}
                  configItemId={item.id}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}

        <SdConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title='Excluir item de configuração?'
          description='Os itens filhos passam para o pai deste item. Chamados já abertos mantêm o vínculo.'
          onConfirm={async () => {
            if (!item) return
            try {
              await remove.mutateAsync(item.id)
              notify.success('Item excluído.')
              onOpenChange(false)
            } catch (error) {
              notify.error(error, 'Não foi possível excluir.')
            }
          }}
        />
      </SheetContent>
    </Sheet>
  )
}

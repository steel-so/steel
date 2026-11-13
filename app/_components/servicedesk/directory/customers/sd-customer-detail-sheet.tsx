'use client'

import {
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  StarIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { CustomerLinkPanel } from '@/app/_components/customer-link/customer-link-panel'
import { SdCustomerContractBlock } from '@/app/_components/servicedesk/contracts/sd-customer-contract-block'
import { SdCustomFieldsView } from '@/app/_components/servicedesk/custom-fields/sd-custom-fields-form'
import { SdContactFormSheet } from '@/app/_components/servicedesk/directory/contacts/sd-contact-form-sheet'
import {
  formatSdDate,
  SD_CI_STATUS_LABEL,
  SD_CI_STATUS_TONE,
  SD_CUSTOMER_KIND_LABEL,
  SD_PERSON_TYPE_LABEL,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-labels'
import {
  SdActivePill,
  SdConfirmDelete,
  SdLinkedTickets,
  SdPill,
  SdWarrantyBadge,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-widgets'
import { SdInfoRow } from '@/app/_components/servicedesk/directory/shared/sd-form-bits'
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
import { useSdConfigItems } from '@/src/hooks/use-sd-config-items'
import {
  useDeleteSdCustomer,
  useSdCustomer,
} from '@/src/hooks/use-sd-customers'
import { formatDocument, formatPhone } from '@/src/lib/servicedesk/document'
import type { SdCustomerDTO } from '@/types/sd-customer'

/** Detalhe do cliente/empresa com as abas Dados, Contatos, CIs e Chamados. */
export function SdCustomerDetailSheet({
  workspaceId,
  slug,
  customerId,
  onOpenChange,
  onEdit,
}: {
  workspaceId: string
  slug: string
  customerId: string | null
  onOpenChange: (open: boolean) => void
  onEdit: (customer: SdCustomerDTO) => void
}) {
  const { data: customer, isLoading } = useSdCustomer(workspaceId, customerId)
  const remove = useDeleteSdCustomer(workspaceId)
  const [confirming, setConfirming] = useState(false)
  const [addingContact, setAddingContact] = useState(false)
  const items = useSdConfigItems(workspaceId, {
    customerId: customerId ?? undefined,
    pageSize: 50,
  })

  const address = customer
    ? [
        [customer.street, customer.number].filter(Boolean).join(', '),
        customer.complement,
        customer.district,
        [customer.city, customer.state].filter(Boolean).join('/'),
        customer.zipCode
          ? `CEP ${customer.zipCode.replace(/(\d{5})(\d{3})/, '$1-$2')}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <Sheet open={Boolean(customerId)} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col gap-0 p-0 sm:max-w-2xl'>
        <SheetHeader className='border-b px-6 py-4'>
          {customer ? (
            <div className='flex items-start justify-between gap-3 pr-8'>
              <div className='min-w-0'>
                <SheetTitle className='truncate'>{customer.name}</SheetTitle>
                <SheetDescription className='flex flex-wrap items-center gap-2'>
                  <SdPill className='bg-muted text-foreground'>
                    {SD_CUSTOMER_KIND_LABEL[customer.kind]}
                  </SdPill>
                  {customer.document ? (
                    <span className='font-mono'>
                      {formatDocument(customer.document)}
                    </span>
                  ) : null}
                  {customer.active ? null : <SdActivePill active={false} />}
                </SheetDescription>
              </div>
              <div className='flex shrink-0 gap-1'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => onEdit(customer)}
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

        {isLoading || !customer ? (
          <div className='flex flex-col gap-3 p-6'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-3/4' />
            <Skeleton className='h-4 w-1/2' />
          </div>
        ) : (
          <Tabs
            defaultValue='data'
            className='flex min-h-0 flex-1 flex-col gap-0'
          >
            <TabsList className='mx-6 mt-4'>
              <TabsTrigger value='data'>Dados</TabsTrigger>
              <TabsTrigger value='contacts'>
                Contatos ({customer.contacts.length})
              </TabsTrigger>
              <TabsTrigger value='items'>
                Itens de configuração ({customer.configItemsCount})
              </TabsTrigger>
              <TabsTrigger value='contract'>Contrato</TabsTrigger>
              <TabsTrigger value='tickets'>Chamados</TabsTrigger>
            </TabsList>

            <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
              <TabsContent value='data'>
                <dl className='divide-y'>
                  <SdInfoRow label='Nome fantasia'>
                    {customer.tradeName}
                  </SdInfoRow>
                  <SdInfoRow label='Tipo de pessoa'>
                    {SD_PERSON_TYPE_LABEL[customer.personType]}
                  </SdInfoRow>
                  <SdInfoRow label='E-mail'>
                    {customer.email ? (
                      <a
                        href={`mailto:${customer.email}`}
                        className='text-primary hover:underline'
                      >
                        {customer.email}
                      </a>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Telefone'>
                    {formatPhone(customer.phone)}
                  </SdInfoRow>
                  <SdInfoRow label='WhatsApp'>
                    {customer.whatsapp ? (
                      <a
                        href={`https://wa.me/${customer.whatsapp}`}
                        target='_blank'
                        rel='noreferrer'
                        className='font-medium hover:underline'
                      >
                        {formatPhone(customer.whatsapp)}
                      </a>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Endereço'>{address}</SdInfoRow>
                  {customer.ibgeCode ? (
                    <SdInfoRow label='Código IBGE'>
                      {customer.ibgeCode}
                    </SdInfoRow>
                  ) : null}
                  <SdInfoRow label='Observações'>
                    {customer.notes ? (
                      <span className='whitespace-pre-wrap'>
                        {customer.notes}
                      </span>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Criado em'>
                    {formatSdDate(customer.createdAt)}
                  </SdInfoRow>
                </dl>
                <SdCustomFieldsView
                  workspaceId={workspaceId}
                  entity='CUSTOMER'
                  values={customer.customFields}
                />
                <div className='mt-4'>
                  <CustomerLinkPanel
                    workspaceId={workspaceId}
                    kind='sd-customer'
                    id={customer.id}
                  />
                </div>
              </TabsContent>

              <TabsContent value='contacts' className='flex flex-col gap-3'>
                <Button
                  size='sm'
                  variant='outline'
                  className='self-end'
                  onClick={() => setAddingContact(true)}
                >
                  <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                  Novo contato
                </Button>
                {customer.contacts.length === 0 ? (
                  <p className='py-8 text-center text-muted-foreground text-sm'>
                    Nenhum contato vinculado.
                  </p>
                ) : (
                  <ul className='divide-y rounded-lg border'>
                    {customer.contacts.map((c) => (
                      <li
                        key={c.id}
                        className='flex items-center gap-3 px-3 py-2.5 text-sm'
                      >
                        <div className='min-w-0 flex-1'>
                          <p className='flex items-center gap-1.5 font-medium'>
                            {c.name}
                            {c.isPrimary ? (
                              <SteelIcon
                                icon={StarIcon}
                                strokeWidth={2}
                                className='size-3.5 fill-highlight text-highlight'
                                aria-label='Contato principal'
                              />
                            ) : null}
                          </p>
                          <p className='truncate text-muted-foreground text-xs'>
                            {[c.jobTitle, c.email, formatPhone(c.whatsapp)]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value='items'>
                {(items.data?.items.length ?? 0) === 0 ? (
                  <p className='py-8 text-center text-muted-foreground text-sm'>
                    Nenhum item de configuração deste cadastro.
                  </p>
                ) : (
                  <ul className='divide-y rounded-lg border'>
                    {items.data?.items.map((item) => (
                      <li
                        key={item.id}
                        className='flex items-center gap-3 px-3 py-2.5 text-sm'
                      >
                        <div className='min-w-0 flex-1'>
                          <p className='truncate font-medium'>{item.name}</p>
                          <p className='truncate text-muted-foreground text-xs'>
                            {[item.code, item.type?.name, item.location]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <SdWarrantyBadge until={item.warrantyUntil} />
                        <SdPill className={SD_CI_STATUS_TONE[item.status]}>
                          {SD_CI_STATUS_LABEL[item.status]}
                        </SdPill>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value='contract'>
                <SdCustomerContractBlock
                  workspaceId={workspaceId}
                  customerId={customer.id}
                />
              </TabsContent>

              <TabsContent value='tickets'>
                <SdLinkedTickets slug={slug} tickets={customer.recentTickets} />
              </TabsContent>
            </div>
          </Tabs>
        )}

        <SdConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title='Excluir cadastro?'
          description='O cadastro sai das listas e dos seletores. Chamados já abertos mantêm o vínculo.'
          onConfirm={async () => {
            if (!customer) return
            try {
              await remove.mutateAsync(customer.id)
              notify.success('Cadastro excluído.')
              onOpenChange(false)
            } catch (error) {
              notify.error(error, 'Não foi possível excluir.')
            }
          }}
        />

        {customer ? (
          <SdContactFormSheet
            workspaceId={workspaceId}
            open={addingContact}
            onOpenChange={setAddingContact}
            defaultCustomer={{ id: customer.id, name: customer.name }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

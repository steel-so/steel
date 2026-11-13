'use client'

import {
  Delete02Icon,
  PencilEdit02Icon,
  StarIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { CustomerLinkPanel } from '@/app/_components/customer-link/customer-link-panel'
import { SdCustomFieldsView } from '@/app/_components/servicedesk/custom-fields/sd-custom-fields-form'
import {
  formatSdDate,
  SD_CUSTOMER_KIND_LABEL,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-labels'
import {
  SdConfirmDelete,
  SdLinkedTickets,
  SdPill,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-widgets'
import { SdInfoRow } from '@/app/_components/servicedesk/directory/shared/sd-form-bits'
import { SdPortalAccessButton } from '@/app/_components/servicedesk/external-portal'
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
import { useDeleteSdContact, useSdContact } from '@/src/hooks/use-sd-contacts'
import { formatPhone } from '@/src/lib/servicedesk/document'
import type { SdContactDTO } from '@/types/sd-contact'

/** Detalhe do contato: Dados, Clientes/empresas e Chamados. */
export function SdContactDetailSheet({
  workspaceId,
  slug,
  contactId,
  onOpenChange,
  onEdit,
}: {
  workspaceId: string
  slug: string
  contactId: string | null
  onOpenChange: (open: boolean) => void
  onEdit: (contact: SdContactDTO) => void
}) {
  const { data: contact, isLoading } = useSdContact(workspaceId, contactId)
  const remove = useDeleteSdContact(workspaceId)
  const [confirming, setConfirming] = useState(false)

  return (
    <Sheet open={Boolean(contactId)} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col gap-0 p-0 sm:max-w-xl'>
        <SheetHeader className='border-b px-6 py-4'>
          {contact ? (
            <div className='flex items-start justify-between gap-3 pr-8'>
              <div className='min-w-0'>
                <SheetTitle className='truncate'>{contact.name}</SheetTitle>
                <SheetDescription>
                  {[contact.jobTitle, contact.customers[0]?.name]
                    .filter(Boolean)
                    .join(' · ') || 'Contato'}
                </SheetDescription>
              </div>
              <div className='flex shrink-0 gap-1'>
                <SdPortalAccessButton
                  workspaceId={workspaceId}
                  contactId={contact.id}
                  contactEmail={contact.email}
                  contactName={contact.name}
                  label='Portal'
                />
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => onEdit(contact)}
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
                <Skeleton className='h-5 w-40' />
              </SheetTitle>
              <SheetDescription>
                <Skeleton className='h-4 w-24' />
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        {isLoading || !contact ? (
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
              <TabsTrigger value='customers'>
                Clientes e empresas ({contact.customers.length})
              </TabsTrigger>
              <TabsTrigger value='tickets'>Chamados</TabsTrigger>
            </TabsList>
            <div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
              <TabsContent value='data'>
                <dl className='divide-y'>
                  <SdInfoRow label='E-mail'>
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        className='text-primary hover:underline'
                      >
                        {contact.email}
                      </a>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Telefone'>
                    {formatPhone(contact.phone)}
                  </SdInfoRow>
                  <SdInfoRow label='WhatsApp'>
                    {contact.whatsapp ? (
                      <a
                        href={`https://wa.me/${contact.whatsapp}`}
                        target='_blank'
                        rel='noreferrer'
                        className='font-medium hover:underline'
                      >
                        {formatPhone(contact.whatsapp)}
                      </a>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Usuário'>
                    {contact.user
                      ? `${contact.user.name} (${contact.user.email})`
                      : null}
                  </SdInfoRow>
                  <SdInfoRow label='Situação'>
                    {contact.active ? 'Ativo' : 'Inativo'}
                  </SdInfoRow>
                  <SdInfoRow label='Observações'>
                    {contact.notes ? (
                      <span className='whitespace-pre-wrap'>
                        {contact.notes}
                      </span>
                    ) : null}
                  </SdInfoRow>
                  <SdInfoRow label='Criado em'>
                    {formatSdDate(contact.createdAt)}
                  </SdInfoRow>
                </dl>
                <SdCustomFieldsView
                  workspaceId={workspaceId}
                  entity='CONTACT'
                  values={contact.customFields}
                />
                <div className='mt-4'>
                  <CustomerLinkPanel
                    workspaceId={workspaceId}
                    kind='sd-contact'
                    id={contact.id}
                  />
                </div>
              </TabsContent>
              <TabsContent value='customers'>
                {contact.customers.length === 0 ? (
                  <p className='py-8 text-center text-muted-foreground text-sm'>
                    Sem vínculo com clientes ou empresas.
                  </p>
                ) : (
                  <ul className='divide-y rounded-lg border'>
                    {contact.customers.map((c) => (
                      <li
                        key={c.id}
                        className='flex items-center gap-2 px-3 py-2.5 text-sm'
                      >
                        {c.isPrimary ? (
                          <SteelIcon
                            icon={StarIcon}
                            strokeWidth={2}
                            className='size-4 fill-highlight text-highlight'
                          />
                        ) : (
                          <span className='size-4' />
                        )}
                        <span className='min-w-0 flex-1 truncate'>
                          {c.name}
                        </span>
                        <SdPill className='bg-muted text-foreground'>
                          {SD_CUSTOMER_KIND_LABEL[c.kind]}
                        </SdPill>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value='tickets'>
                <SdLinkedTickets slug={slug} tickets={contact.recentTickets} />
              </TabsContent>
            </div>
          </Tabs>
        )}

        <SdConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title='Excluir contato?'
          description='O contato sai das listas e dos seletores. Chamados já abertos mantêm o vínculo.'
          onConfirm={async () => {
            if (!contact) return
            try {
              await remove.mutateAsync(contact.id)
              notify.success('Contato excluído.')
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

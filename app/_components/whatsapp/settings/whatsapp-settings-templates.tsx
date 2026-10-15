'use client'

import { TouchInteraction01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import {
  useSyncWhatsAppTemplates,
  useWhatsAppTemplates,
} from '@/src/hooks/use-whatsapp-templates'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { WhatsappButtonsSummary } from '../buttons/whatsapp-buttons-editor'
import { CreateTemplateDialog } from '../create-template-dialog'
import { TemplateButtonsSheet } from '../template-buttons-sheet'
import {
  TemplateQualityBadge,
  TemplateStatusBadge,
} from '../template-quality-badge'

const CATEGORY_LABEL: Record<string, string> = {
  UTILITY: 'Utilidade',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticação',
}

export function WhatsappSettingsTemplates({
  workspaceId,
}: {
  workspaceId: string
}) {
  const connections = useWhatsAppConnections(workspaceId)
  const metaConnections = (connections.data ?? []).filter(
    (connection) => connection.provider === 'META',
  )
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>()

  const templates = useWhatsAppTemplates(workspaceId)
  const syncTemplates = useSyncWhatsAppTemplates(workspaceId)
  // Criar/sincronizar templates é restrito a admins.
  const canManage = useCan('message-templates', 'CREATE')
  const [editingButtons, setEditingButtons] =
    useState<WhatsAppTemplateDTO | null>(null)

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='font-medium text-sm'>Templates da Meta</h3>
          <p className='text-muted-foreground text-xs'>
            Sincronize os templates aprovados na sua conta Meta
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={selectedConnectionId ?? null}
            onValueChange={(value) =>
              setSelectedConnectionId(value ?? undefined)
            }
          >
            <SelectTrigger className='w-52' aria-label='Conexão Meta'>
              <SelectValue>
                {(value: string | null) =>
                  metaConnections.find((c) => c.id === value)?.label ?? (
                    <span className='text-muted-foreground'>Conexão Meta</span>
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {metaConnections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {canManage ? (
            <Button
              size='sm'
              variant='outline'
              disabled={!selectedConnectionId || syncTemplates.isPending}
              onClick={() => {
                if (!selectedConnectionId) return
                syncTemplates.mutate(selectedConnectionId, {
                  onSuccess: () => notify.success('Templates sincronizados'),
                  onError: (error) =>
                    notify.error(error, 'Falha ao sincronizar'),
                })
              }}
            >
              {syncTemplates.isPending
                ? 'Sincronizando...'
                : 'Sincronizar agora'}
            </Button>
          ) : null}
          {canManage ? (
            <CreateTemplateDialog workspaceId={workspaceId} />
          ) : null}
        </div>
      </div>

      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Idioma</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Botões</TableHead>
              {canManage ? <TableHead className='w-0' /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(templates.data ?? []).map((template) => {
              const hasReply = template.buttons.some(
                (button) => button.type === 'REPLY',
              )
              return (
                <TableRow key={template.id}>
                  <TableCell>
                    <span className='flex items-center gap-2'>
                      <TemplateQualityBadge quality={template.quality} />
                      <span className='font-medium'>{template.name}</span>
                    </span>
                  </TableCell>
                  <TableCell>{template.language}</TableCell>
                  <TableCell>
                    {CATEGORY_LABEL[template.category] ?? template.category}
                  </TableCell>
                  <TableCell>
                    <TemplateStatusBadge
                      status={template.status}
                      reason={template.statusReason}
                    />
                  </TableCell>
                  <TableCell>
                    <WhatsappButtonsSummary buttons={template.buttons} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className='text-right'>
                      {hasReply ? (
                        <Button
                          size='xs'
                          variant='outline'
                          aria-label={`Ações dos botões de ${template.name}`}
                          onClick={() => setEditingButtons(template)}
                        >
                          <SteelIcon icon={TouchInteraction01Icon} size={14} />
                          Ações dos botões
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
            {templates.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={canManage ? 6 : 5}
                  className='text-muted-foreground text-sm'
                >
                  Nenhum template sincronizado ainda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TemplateButtonsSheet
        workspaceId={workspaceId}
        template={editingButtons}
        onOpenChange={(open) => {
          if (!open) setEditingButtons(null)
        }}
      />
    </div>
  )
}

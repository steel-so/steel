'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useWhatsAppFlowResponses } from '@/src/hooks/use-whatsapp-flows'
import { answerText } from '@/src/lib/whatsapp/flows/answers'
import { allFields } from '@/src/lib/whatsapp/flows/editor-model'
import type { FlowDefinition } from '@/src/schemas/whatsapp-flow.schema'
import type { WhatsAppFlowResponseDTO } from '@/types/whatsapp-flow'
import { formatFlowDate } from './flow-ui'

function crmChips(response: WhatsAppFlowResponseDTO): string[] {
  const chips: string[] = []
  if (response.createdLeadId) chips.push('Lead criado')
  if (response.createdPersonId) chips.push('Pessoa criada')
  if (response.createdCompanyId) chips.push('Empresa criada')
  return chips
}

function Answers({
  definition,
  response,
}: {
  definition: FlowDefinition
  response: WhatsAppFlowResponseDTO
}) {
  if (!response.answers) {
    return <span className='text-muted-foreground'>Aguardando resposta</span>
  }
  const lines = allFields(definition)
    .map((field) => ({
      label: field.label,
      text: answerText(field, response.answers?.[field.key]),
    }))
    .filter((line) => line.text)
  if (lines.length === 0) {
    return <span className='text-muted-foreground'>Sem respostas</span>
  }
  return (
    <dl className='space-y-0.5'>
      {lines.map((line) => (
        <div key={line.label} className='flex gap-1.5 text-xs'>
          <dt className='shrink-0 text-muted-foreground'>{line.label}:</dt>
          <dd className='min-w-0 break-words'>{line.text}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Answers collected by a flow, newest first, with the CRM records they made. */
export function FlowResponses({
  workspaceId,
  flowId,
  definition,
}: {
  workspaceId: string
  flowId: string
  definition: FlowDefinition
}) {
  const [cursors, setCursors] = useState<string[]>([])
  const cursor = cursors[cursors.length - 1]
  const responses = useWhatsAppFlowResponses(workspaceId, flowId, cursor)

  if (responses.isLoading) return <Skeleton className='h-40 rounded-xl' />
  if (responses.isError) {
    return (
      <p role='alert' className='text-destructive text-sm'>
        Não foi possível carregar as respostas.
      </p>
    )
  }
  const items = responses.data?.items ?? []
  if (items.length === 0 && cursors.length === 0) {
    return (
      <div className='rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm'>
        Nenhum envio ainda. Envie o formulário de uma conversa pelo botão de
        anexo.
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='overflow-x-auto rounded-xl border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contato</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Enviado</TableHead>
              <TableHead>Respostas</TableHead>
              <TableHead>CRM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((response) => (
              <TableRow key={response.id}>
                <TableCell className='align-top'>
                  <p className='font-medium'>
                    {response.contactName ?? response.contactWaId}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {response.contactWaId}
                  </p>
                </TableCell>
                <TableCell className='align-top'>
                  <Badge
                    variant={
                      response.status === 'COMPLETED' ? 'default' : 'outline'
                    }
                  >
                    {response.status === 'COMPLETED'
                      ? 'Respondido'
                      : 'Aguardando'}
                  </Badge>
                </TableCell>
                <TableCell className='align-top text-xs'>
                  {formatFlowDate(response.sentAt)}
                  {response.respondedAt ? (
                    <p className='text-muted-foreground'>
                      Resposta {formatFlowDate(response.respondedAt)}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className='min-w-56 align-top'>
                  <Answers definition={definition} response={response} />
                </TableCell>
                <TableCell className='align-top'>
                  <div className='flex flex-wrap gap-1'>
                    {crmChips(response).map((chip) => (
                      <Badge key={chip} variant='secondary'>
                        {chip}
                      </Badge>
                    ))}
                  </div>
                  {response.mappingNote ? (
                    <p className='mt-1 max-w-48 text-muted-foreground text-xs'>
                      {response.mappingNote}
                    </p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className='flex justify-end gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={cursors.length === 0}
          onClick={() => setCursors((current) => current.slice(0, -1))}
        >
          Anterior
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={!responses.data?.nextCursor}
          onClick={() => {
            const next = responses.data?.nextCursor
            if (next) setCursors((current) => [...current, next])
          }}
        >
          Próxima
        </Button>
      </div>
    </div>
  )
}

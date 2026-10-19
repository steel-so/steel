'use client'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCrmApolloImports } from '@/src/hooks/use-crm-apollo'
import {
  formatDateTime,
  IMPORT_STATUS_LABELS,
  IMPORT_STATUS_VARIANT,
  SKIP_REASON_LABELS,
} from './apollo-labels'

/** "Histórico de importações": counts and credits, polled while one runs. */
export function ApolloHistoryTab({ workspaceId }: { workspaceId: string }) {
  const imports = useCrmApolloImports(workspaceId)

  if (imports.isLoading) {
    return (
      <p className='text-muted-foreground text-sm'>Carregando histórico…</p>
    )
  }
  if (imports.error) {
    return (
      <p role='alert' className='text-destructive text-sm'>
        {imports.error.message}
      </p>
    )
  }
  const rows = imports.data ?? []
  if (rows.length === 0) {
    return (
      <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Nenhuma importação ainda. Busque pessoas ou escolha uma lista para
        começar.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Início</TableHead>
          <TableHead>Origem</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead className='text-right'>Pedidos</TableHead>
          <TableHead className='text-right'>Criados</TableHead>
          <TableHead className='text-right'>Ignorados</TableHead>
          <TableHead className='text-right'>Falhas</TableHead>
          <TableHead className='text-right'>Créditos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => (
          <TableRow key={item.id}>
            <TableCell className='whitespace-nowrap'>
              {formatDateTime(item.createdAt)}
            </TableCell>
            <TableCell>
              {item.source === 'SEARCH' ? 'Busca' : 'Lista da Apollo'}
            </TableCell>
            <TableCell>
              <div className='flex min-w-0 flex-col gap-1'>
                <Badge variant={IMPORT_STATUS_VARIANT[item.status]}>
                  {IMPORT_STATUS_LABELS[item.status]}
                </Badge>
                {item.error ? (
                  <span className='max-w-64 break-words text-destructive text-xs'>
                    {item.error}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className='text-right'>{item.requestedCount}</TableCell>
            <TableCell className='text-right'>{item.createdCount}</TableCell>
            <TableCell className='text-right'>
              {item.skippedCount}
              <SkipReasons reasons={item.skipReasons} />
            </TableCell>
            <TableCell className='text-right'>{item.failedCount}</TableCell>
            <TableCell className='text-right'>
              {item.creditsConsumed}
              {item.revealPhones ? (
                <span className='block text-muted-foreground text-xs'>
                  {item.phonesReceived}/{item.phonesRequested} com telefone
                </span>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Why people were ignored, one line per reason (pt-BR). */
function SkipReasons({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons)
  if (entries.length === 0) return null
  return (
    <ul className='mt-1 flex max-w-64 flex-col gap-0.5 text-left text-muted-foreground text-xs'>
      {entries.map(([reason, count]) => (
        <li key={reason}>
          <strong>{count}</strong> · {SKIP_REASON_LABELS[reason] ?? reason}
        </li>
      ))}
    </ul>
  )
}

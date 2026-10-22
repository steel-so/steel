import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  WhatsAppCostProviderRowDTO,
  WhatsAppCostReportDTO,
} from '@/types/whatsapp-cost'
import { formatBrl, formatCount } from './whatsapp-costs-format'

const PROVIDER_LABEL = { META: 'Meta (API oficial)', ZAPI: 'Z-API' } as const

function ProviderColumn({ row }: { row: WhatsAppCostProviderRowDTO }) {
  return (
    <div className='min-w-0 space-y-3 rounded-xl border border-border/80 bg-card p-4'>
      <div>
        <p className='font-medium text-sm'>{PROVIDER_LABEL[row.provider]}</p>
        <p className='text-muted-foreground text-xs'>
          {row.connections === 0
            ? 'Nenhuma conexão'
            : `${row.connections} ${row.connections === 1 ? 'conexão' : 'conexões'}`}
        </p>
      </div>
      <dl className='grid grid-cols-2 gap-x-3 gap-y-2 text-sm'>
        <dt className='text-muted-foreground'>Custo total</dt>
        <dd className='text-right font-semibold tabular-nums'>
          {formatBrl(row.totalCost)}
        </dd>
        <dt className='text-muted-foreground'>
          {row.provider === 'META' ? 'Meta (estimado)' : 'Por mensagem'}
        </dt>
        <dd className='text-right tabular-nums'>
          {formatBrl(row.variableCost)}
        </dd>
        <dt className='text-muted-foreground'>Mensalidades</dt>
        <dd className='text-right tabular-nums'>{formatBrl(row.fee)}</dd>
        <dt className='text-muted-foreground'>Mensagens</dt>
        <dd className='text-right tabular-nums'>{formatCount(row.messages)}</dd>
        <dt className='text-muted-foreground'>Custo por mensagem</dt>
        <dd className='text-right tabular-nums'>
          {formatBrl(row.costPerMessage)}
        </dd>
        <dt className='text-muted-foreground'>Custo por conversa</dt>
        <dd className='text-right tabular-nums'>
          {formatBrl(row.costPerConversation)}
        </dd>
      </dl>
    </div>
  )
}

export function CostProviders({ report }: { report: WhatsAppCostReportDTO }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meta x Z-API</CardTitle>
        <CardDescription>
          A Meta cobra por mensagem de template (estimativa pela tabela de
          preços). A Z-API cobra uma mensalidade fixa por instância: o custo
          efetivo é a mensalidade dividida pelo volume do período.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <div className='grid gap-3 md:grid-cols-2'>
          {report.byProvider.map((row) => (
            <ProviderColumn key={row.provider} row={row} />
          ))}
        </div>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conexão</TableHead>
                <TableHead className='text-right'>Mensagens</TableHead>
                <TableHead className='text-right'>Conversas</TableHead>
                <TableHead className='text-right'>Meta</TableHead>
                <TableHead className='text-right'>Mensalidade</TableHead>
                <TableHead className='text-right'>Total</TableHead>
                <TableHead className='text-right'>Por mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byConnection.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='py-6 text-center text-muted-foreground'
                  >
                    Nenhuma conexão de Comunicação.
                  </TableCell>
                </TableRow>
              ) : (
                report.byConnection.map((row) => (
                  <TableRow key={row.connectionId}>
                    <TableCell className='font-medium'>
                      {row.label}
                      <span className='ml-1.5 text-muted-foreground text-xs'>
                        {row.provider === 'META' ? 'Meta' : 'Z-API'}
                      </span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatCount(row.messages)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatCount(row.conversations)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatBrl(row.variableCost)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatBrl(row.fee)}
                    </TableCell>
                    <TableCell className='text-right font-medium tabular-nums'>
                      {formatBrl(row.totalCost)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatBrl(row.costPerMessage)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

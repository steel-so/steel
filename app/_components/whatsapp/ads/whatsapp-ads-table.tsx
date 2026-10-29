import { StatTile } from '@/app/_components/steel-ai-usage/usage-charts'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { WhatsAppAdReportDTO } from '@/types/whatsapp-ad'
import { formatBrl, formatCount } from '../costs/whatsapp-costs-format'
import { formatAdMoney, formatRoi } from './whatsapp-ads-format'

export function AdTotals({ report }: { report: WhatsAppAdReportDTO }) {
  const { totals } = report
  return (
    <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
      <StatTile
        label='Conversas de anúncios'
        value={formatCount(totals.conversations)}
        detail={`${formatCount(totals.clicks)} mensagens com origem de anúncio, ${formatCount(totals.contacts)} contatos`}
      />
      <StatTile
        label='Leads'
        value={formatCount(totals.leads)}
        detail={`${formatCount(totals.leadsWon)} ganhos · custo por lead ${formatAdMoney(totals.costPerLead, formatBrl)}`}
      />
      <StatTile
        label='Gasto'
        value={formatBrl(totals.spend)}
        detail={`Custo por conversa ${formatAdMoney(totals.costPerConversation, formatBrl)}`}
      />
      <StatTile
        label='Receita e ROI'
        value={formatBrl(totals.revenue)}
        detail={`ROI ${formatRoi(totals.roi)}`}
      />
    </div>
  )
}

export function AdTable({ report }: { report: WhatsAppAdReportDTO }) {
  if (report.rows.length === 0) {
    return (
      <p className='rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground text-sm'>
        Nenhuma conversa de anúncio no período. Quando a atribuição estiver
        ligada, as conversas que chegarem de um anúncio Click-to-WhatsApp
        aparecem aqui.
      </p>
    )
  }

  return (
    <div className='overflow-x-auto rounded-xl border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Anúncio</TableHead>
            <TableHead className='text-right'>Conversas</TableHead>
            <TableHead className='text-right'>Leads</TableHead>
            <TableHead className='text-right'>Ganhos</TableHead>
            <TableHead className='text-right'>Gasto</TableHead>
            <TableHead className='text-right'>Custo/lead</TableHead>
            <TableHead className='text-right'>Receita</TableHead>
            <TableHead className='text-right'>ROI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((row) => (
            <TableRow key={row.sourceId}>
              <TableCell className='max-w-72'>
                <p className='truncate font-medium'>
                  {row.name ?? `Anúncio ${row.sourceId}`}
                </p>
                <p className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                  <span className='truncate'>{row.sourceId}</span>
                  {row.sourceType === 'post' ? (
                    <Badge variant='outline'>Publicação</Badge>
                  ) : null}
                </p>
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatCount(row.conversations)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatCount(row.leads)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatCount(row.leadsWon)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatBrl(row.spend)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatAdMoney(row.costPerLead, formatBrl)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatBrl(row.revenue)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatRoi(row.roi)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

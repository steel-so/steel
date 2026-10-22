import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { WhatsAppCostReportDTO } from '@/types/whatsapp-cost'
import { CostBars } from './whatsapp-costs-bars'

const SECTIONS = [
  {
    key: 'byCategory',
    title: 'Por categoria',
    hint: 'Categoria do template na Meta; mensagens na janela de 24 h não têm custo.',
  },
  {
    key: 'bySource',
    title: 'Por origem',
    hint: 'De onde partiu o envio.',
  },
  {
    key: 'byBroadcast',
    title: 'Por transmissão',
    hint: 'Custo de cada transmissão enviada no período.',
  },
  {
    key: 'byAiCampaign',
    title: 'Por campanha de IA',
    hint: 'Disparos iniciais das campanhas de IA.',
  },
  {
    key: 'byAgent',
    title: 'Por atendente',
    hint: 'Mensagens enviadas manualmente por cada pessoa.',
  },
] as const

export function CostBreakdowns({ report }: { report: WhatsAppCostReportDTO }) {
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      {SECTIONS.map((section) => (
        <Card key={section.key}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.hint}</CardDescription>
          </CardHeader>
          <CardContent>
            <CostBars items={report[section.key]} label={section.title} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

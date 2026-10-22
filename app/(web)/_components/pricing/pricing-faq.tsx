import { JsonLd } from '@/components/seo/json-ld'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Title } from '../text/title'

export interface PricingFaqItem {
  question: string
  answer: string
}

/** Questions about plans; every answer describes the product as it is. */
export const PRICING_FAQ: PricingFaqItem[] = [
  {
    question: 'O que é o Steel?',
    answer:
      'É a plataforma da Stratus Telecom que reúne ServiceDesk ITIL 4, CRM e atendimento por WhatsApp Business num só workspace, com a Steel AI trabalhando nos três módulos.',
  },
  {
    question: 'O que muda de um plano para outro?',
    answer:
      'Hoje, o número de membros: até 12 no Free e no Pro, ilimitados no Business e no Enterprise. Os recursos dos módulos, da Steel AI e de segurança são os mesmos em todos os planos.',
  },
  {
    question: 'Como contrato um plano pago?',
    answer:
      'A contratação é feita com a nossa equipe comercial: use "Falar com vendas" e conte o tamanho da equipe e os módulos que você precisa.',
  },
  {
    question: 'Existe período de teste?',
    answer:
      'Sim. Todo workspace novo começa com 14 dias do plano Business, sem cobrança. Ao fim do período, ele volta para o plano Free.',
  },
  {
    question: 'Como os módulos são habilitados?',
    answer:
      'ServiceDesk, CRM e Comunicação são habilitados por workspace pela equipe da Stratus Telecom. Um workspace pode usar um, dois ou os três.',
  },
  {
    question: 'A Steel AI tem custo à parte?',
    answer:
      'O uso de IA entra numa cota mensal do workspace, em dólares, definida pelo administrador. Cada uso é contado pelo preço real do modelo escolhido, e as telas de Uso e Análises mostram o consumo.',
  },
  {
    question: 'As tarifas do WhatsApp estão incluídas?',
    answer:
      'Não. As conversas e os templates do WhatsApp Business são cobrados pela Meta (ou pelo seu provedor Z-API) diretamente, à parte do Steel.',
  },
  {
    question: 'Meus dados ficam seguros e são meus?',
    answer:
      'O Steel tem verificação em duas etapas, auditoria das ações sensíveis e backup diário criptografado. O administrador exporta todos os dados do workspace quando quiser, e o tratamento segue a LGPD.',
  },
]

export function PricingFaq() {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: PRICING_FAQ.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  }

  return (
    <section
      aria-labelledby='pricing-faq'
      className='py-16 flex flex-col gap-6 w-full pb-20'
    >
      <JsonLd data={faqSchema} />
      <Title as='h2' className='text-3xl sm:text-4xl font-medium'>
        <span id='pricing-faq'>Perguntas frequentes</span>
      </Title>
      <Accordion className='max-w-5xl w-full mx-auto flex flex-col'>
        {PRICING_FAQ.map((item) => (
          <AccordionItem
            key={item.question}
            value={item.question}
            className='data-open:bg-card p-4'
          >
            <AccordionTrigger className='text-base hover:no-underline'>
              {item.question}
            </AccordionTrigger>
            <AccordionContent>{item.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}

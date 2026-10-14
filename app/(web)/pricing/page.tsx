import {
  AiMagicIcon,
  DatabaseIcon,
  Shield01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { connection } from 'next/server'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { isBillingEnabled } from '@/src/lib/billing'
import { PricingBillingNote } from '../_components/pricing/pricing-billing-note'
import { BillingToggle } from '../_components/pricing/pricing-billing-toggle'
import { PricingCalculator } from '../_components/pricing/pricing-calculator'
import { PricingCardPlan } from '../_components/pricing/pricing-card-plan'
import { PricingComparison } from '../_components/pricing/pricing-comparison'
import { PricingFaq } from '../_components/pricing/pricing-faq'
import { PricingTableDetailsPlan } from '../_components/pricing/table/pricing-table-details-plan'
import { SubTitle } from '../_components/text/sub-title'
import { Title } from '../_components/text/title'

const HIGHLIGHTS = [
  {
    icon: AiMagicIcon,
    title: 'Steel AI nos três módulos',
    text: 'Consulta e age sobre chamados, leads e conversas, sempre com a sua confirmação antes de alterar dados.',
  },
  {
    icon: DatabaseIcon,
    title: 'Seus dados, exportáveis',
    text: 'O administrador exporta todos os dados e os registros de atividade do workspace quando quiser.',
  },
  {
    icon: Shield01Icon,
    title: 'Segurança e LGPD',
    text: 'Verificação em duas etapas, auditoria das ações sensíveis, backup diário criptografado e descadastro de marketing.',
  },
] as const

export default async function PricingPage() {
  // Read the billing flag per request (a restart flips it, no rebuild). With
  // billing off the page stays informative and paid-plan CTAs go to sales.
  await connection()
  const billingEnabled = isBillingEnabled()

  return (
    <main className='mx-auto w-full flex flex-col items-center px-4 py-3 sm:px-8 xl:max-w-336 xl:px-11 2xl:max-w-384'>
      <div className='border-border lg:border-x mx-auto w-full flex flex-col items-center gap-4 py-16 sm:py-20'>
        <Title className='text-4xl sm:text-6xl'>
          ServiceDesk, CRM e WhatsApp <br className='hidden sm:block' />
          num só workspace
        </Title>
        <SubTitle>
          Todos os planos incluem os três módulos e a Steel AI. O que muda entre
          eles é o número de membros.{' '}
          <Link
            href='#features'
            className='text-branding-600 dark:text-branding-400'
          >
            Veja tudo o que está incluído.
          </Link>
        </SubTitle>
      </div>
      <div className='w-full flex flex-col gap-3 border-border border px-5 py-6 sm:flex-row sm:items-center sm:justify-between'>
        <BillingToggle />
        <PricingBillingNote billingEnabled={billingEnabled} />
      </div>
      <div className='border-x border-border grid w-full grid-cols-1 lg:grid-cols-2 xl:grid-cols-4'>
        <PricingCardPlan plan='FREE' billingEnabled={billingEnabled} />
        <PricingCardPlan plan='PRO' billingEnabled={billingEnabled} />
        <PricingCardPlan plan='BUSINESS' billingEnabled={billingEnabled} />
        <PricingCardPlan plan='ENTERPRISE' billingEnabled={billingEnabled} />
      </div>
      <div className='grid w-full grid-cols-1 gap-6 border border-border px-5 py-8 md:grid-cols-3'>
        {HIGHLIGHTS.map((item) => (
          <div key={item.title} className='flex gap-2'>
            <SteelIcon icon={item.icon} size={24} strokeWidth={2} />
            <div className='flex flex-col gap-1.5'>
              <h2 className='text-base font-semibold'>{item.title}</h2>
              <p className='text-sm'>{item.text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className='flex flex-wrap items-center justify-center gap-4 px-4 py-4 border border-border w-full'>
        <Button
          size='sm'
          nativeButton={false}
          render={<Link href='#features'>Tudo o que está incluído</Link>}
        />
        <Button
          size='sm'
          variant='outline'
          nativeButton={false}
          render={<Link href='#calculadora'>Calculadora de economia</Link>}
        />
      </div>
      <div className='w-full border border-border flex flex-col gap-4 px-4 pt-16 pb-4'>
        <h2 className='font-normal text-3xl'>
          Um workspace no lugar de três assinaturas
        </h2>
        <p className='text-muted-foreground'>
          Atendimento, vendas e WhatsApp costumam ser três contratos. Escolha
          uma ferramenta de cada categoria e compararemos com o Steel, que
          inclui os três módulos no mesmo assento.
        </p>
      </div>
      <PricingCalculator />
      <PricingComparison />
      <div className='w-full border border-border flex flex-col gap-4 px-4 pt-16 pb-4'>
        <h2 className='font-normal text-3xl'>Tudo o que está incluído</h2>
        <p className='text-muted-foreground'>
          Os mesmos recursos em todos os planos. O limite de membros é a única
          diferença.
        </p>
      </div>
      <PricingTableDetailsPlan billingEnabled={billingEnabled} />
      <PricingFaq />
    </main>
  )
}

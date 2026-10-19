import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from 'react-email'
import { baseEmailUrl } from '@/lib/base-email-url'
import { EmailFooter } from '../_components/email-footer'

export interface AiDailyDigestEmailItem {
  /** "ServiceDesk", "CRM", "Comunicação". */
  moduleLabel: string
  /** "Urgente", "Atenção", "Informativo". */
  severityLabel: string
  title: string
  body: string
  /** Absolute URL, or `null` when the insight has no link. */
  url: string | null
}

export interface AiDailyDigestEmailProps {
  email: string
  username?: string
  workspaceName: string
  /** One or two sentences (LLM-phrased only when grounded, ADR 0040). */
  intro: string
  items: AiDailyDigestEmailItem[]
  /** Absolute URL of the inbox "Alertas da IA" view. */
  feedUrl: string
  /** Absolute URL of Ajustes › Notificações (to turn it off). */
  settingsUrl: string
}

/** Proactive AI daily digest (opt-out, once a day in the person's time zone). */
export const AiDailyDigest = ({
  username,
  workspaceName,
  intro,
  items,
  feedUrl,
  settingsUrl,
}: AiDailyDigestEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>{`Steel | ${intro}`}</Preview>
        <Container className='bg-white mx-auto py-10 px-6 max-w-140'>
          <Img
            width={120}
            height={33.8}
            className='mb-10'
            src={`${baseEmailUrl}/brand/logo-email.png`}
            alt='Steel'
          />
          <Section>
            <Text className='text-2xl leading-6.5'>
              <strong>Para sua atenção hoje</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              {username ? `Olá, ${username}. ` : ''}No workspace{' '}
              <strong className='font-semibold'>{workspaceName}</strong>:{' '}
              {intro}
            </Text>
          </Section>
          <Section>
            {items.map((item) => (
              <Section
                key={`${item.moduleLabel}-${item.title}`}
                className='border border-solid border-[#e5e7eb] rounded-md px-4 py-1 my-3'
              >
                <Text className='text-[12px] leading-5 text-[#6b7280] my-2'>
                  {item.moduleLabel} · {item.severityLabel}
                </Text>
                <Text className='text-[14px] leading-6 font-semibold my-1'>
                  {item.url ? (
                    <Link href={item.url}>{item.title}</Link>
                  ) : (
                    item.title
                  )}
                </Text>
                <Text className='text-[14px] leading-6 font-light my-2'>
                  {item.body}
                </Text>
              </Section>
            ))}
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#2893cc] text-white text-center font-semibold'
              style={{ width: '-webkit-fill-available' }}
              href={feedUrl}
            >
              Ver todos os alertas
            </Button>
          </Section>
          <Section>
            <Text className='text-[14px] leading-6.5 font-light'>
              Os números deste resumo vêm direto do Steel. Não quer mais
              recebê-lo? Desligue em{' '}
              <Link href={settingsUrl}>Ajustes &gt; Notificações</Link>.
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

AiDailyDigest.PreviewProps = {
  email: 'ana@example.com',
  username: 'Ana',
  workspaceName: 'Stratus',
  intro:
    'Você tem 3 alertas hoje: 1 no ServiceDesk e 2 no CRM. O mais urgente: A fila de N1 deve estourar o SLA às 15:00.',
  items: [
    {
      moduleLabel: 'ServiceDesk',
      severityLabel: 'Urgente',
      title: 'A fila de N1 deve estourar o SLA às 15:00',
      body: '3 chamados com previsão de estouro até 17:30, 1 sem responsável. O primeiro é INC-000123: Servidor de e-mail fora do ar.',
      url: 'https://steel.stratustelecom.com.br/ws/servicedesk/risk',
    },
    {
      moduleLabel: 'CRM',
      severityLabel: 'Informativo',
      title: '4 oportunidades suas sem contato há 10 dias ou mais',
      body: 'Somam R$ 120.000,00. A mais parada, Acme — Renovação, está sem atividade há 32 dias.',
      url: 'https://steel.stratustelecom.com.br/ws/crm/opportunities',
    },
  ],
  feedUrl: 'https://steel.stratustelecom.com.br/ws/inbox?view=insights',
  settingsUrl: 'https://steel.stratustelecom.com.br/ws/settings/notifications',
} satisfies AiDailyDigestEmailProps

export default AiDailyDigest

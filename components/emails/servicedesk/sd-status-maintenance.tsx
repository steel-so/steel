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

export interface SdStatusMaintenanceEmailProps {
  email: string
  pageName: string
  workspaceName: string
  title: string
  /** `Manutenção programada`, `reagendada` or `cancelada`. */
  headline: string
  /** Already formatted in the zone of the page; empty when canceled. */
  whenText: string
  description: string | null
  pageUrl: string
  unsubscribeUrl: string
  canceled: boolean
}

/**
 * Aviso de manutenção programada para quem assina a página de status. Texto
 * puro vindo do agente: exibido como parágrafo, nunca como HTML.
 */
export const SdStatusMaintenance = ({
  pageName,
  workspaceName,
  title,
  headline,
  whenText,
  description,
  pageUrl,
  unsubscribeUrl,
  canceled,
}: SdStatusMaintenanceEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>
          {headline}: {title}
        </Preview>
        <Container className='bg-white mx-auto py-10 px-6 max-w-140'>
          <Img
            width={120}
            height={33.8}
            className='mb-10'
            src={`${baseEmailUrl}/brand/logo-email.png`}
            alt='Steel'
          />
          <Section>
            <Text className='text-[13px] leading-6 text-[#667085] m-0'>
              {pageName} · {workspaceName}
            </Text>
            <Text className='text-2xl leading-7 mt-1'>
              <strong>{title}</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              <strong className='font-semibold'>{headline}</strong>
              {canceled ? '' : ` · ${whenText}`}
            </Text>
            {description ? (
              <Text
                className='text-[14px] leading-6.5 font-light'
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {description}
              </Text>
            ) : null}
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#101828] text-white text-center font-semibold'
              style={{ width: '-webkit-fill-available' }}
              href={pageUrl}
            >
              Ver a página de status
            </Button>
          </Section>
          <Section>
            <Text className='text-[13px] leading-6 font-light text-[#667085]'>
              Você recebe este aviso porque assina a página de status{' '}
              {pageName}.{' '}
              <Link href={unsubscribeUrl}>Cancelar a inscrição</Link>.
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

SdStatusMaintenance.PreviewProps = {
  email: 'ana@acme.com.br',
  pageName: 'Acme · Telefonia',
  workspaceName: 'Stratus Telecom',
  title: 'Troca do switch do datacenter',
  headline: 'Manutenção programada',
  whenText: '10/11/2026 22:00 até 11/11/2026 02:00',
  description: 'A telefonia pode ficar indisponível por alguns minutos.',
  pageUrl: 'https://steel.stratustelecom.com.br/status-page/acme-telefonia',
  unsubscribeUrl:
    'https://steel.stratustelecom.com.br/status-page/acme-telefonia/inscricao/abc',
  canceled: false,
} satisfies SdStatusMaintenanceEmailProps

export default SdStatusMaintenance

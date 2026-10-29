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

export interface SdStatusUpdateEmailProps {
  email: string
  pageName: string
  workspaceName: string
  incidentTitle: string
  statusLabel: string
  impactLabel: string
  message: string
  pageUrl: string
  unsubscribeUrl: string
  resolved: boolean
}

/**
 * Aviso de atualização de incidente para quem assina a página de status.
 * Texto puro vindo do agente: a mensagem é exibida como parágrafo, nunca
 * como HTML.
 */
export const SdStatusUpdate = ({
  pageName,
  workspaceName,
  incidentTitle,
  statusLabel,
  impactLabel,
  message,
  pageUrl,
  unsubscribeUrl,
  resolved,
}: SdStatusUpdateEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>
          {resolved ? 'Resolvido' : statusLabel}: {incidentTitle}
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
              <strong>{incidentTitle}</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              <strong className='font-semibold'>{statusLabel}</strong>
              {resolved ? '' : ` · ${impactLabel}`}
            </Text>
            <Text
              className='text-[14px] leading-6.5 font-light'
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {message}
            </Text>
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#101828] text-white text-center font-semibold'
              style={{ width: '-webkit-fill-available' }}
              href={pageUrl}
            >
              Acompanhar o incidente
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

SdStatusUpdate.PreviewProps = {
  email: 'ana@acme.com.br',
  pageName: 'Acme · Telefonia',
  workspaceName: 'Stratus Telecom',
  incidentTitle: 'Instabilidade na telefonia',
  statusLabel: 'Causa identificada',
  impactLabel: 'Indisponibilidade parcial',
  message:
    'Identificamos uma falha no link principal e já estamos trocando para o link de contingência.',
  pageUrl: 'https://steel.stratustelecom.com.br/status-page/acme-telefonia',
  unsubscribeUrl:
    'https://steel.stratustelecom.com.br/status-page/acme-telefonia/inscricao/abc',
  resolved: false,
} satisfies SdStatusUpdateEmailProps

export default SdStatusUpdate

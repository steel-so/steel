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
import { EmailFooter } from './_components/email-footer'

/** Owner e-mail when a sent document expires unanswered (ADR 0063). */
export interface DocumentExpiredEmailProps {
  username: string
  documentTitle: string
  workspaceName: string
  /** Validity already formatted (dd/mm/aaaa). */
  validUntil: string
  documentUrl: string
}

export const DocumentExpired = ({
  username,
  documentTitle,
  workspaceName,
  validUntil,
  documentUrl,
}: DocumentExpiredEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>Steel | O documento {documentTitle} expirou.</Preview>
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
              <strong>O documento {documentTitle} expirou</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              Olá, {username}. A validade do documento{' '}
              <strong className='font-semibold'>{documentTitle}</strong>, do
              workspace <strong className='font-semibold'>{workspaceName}</strong>
              , terminou em {validUntil} sem resposta.
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              O link continua no ar, mas ninguém consegue mais aceitá-lo. Se a
              negociação continua, ajuste a validade e envie o documento de
              novo.
            </Text>
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#2893cc] text-white text-center font-semibold'
              style={{ width: '-webkit-fill-available' }}
              href={documentUrl}
            >
              Abrir o documento
            </Button>
          </Section>
          <Section>
            <Text className='text-[14px] leading-6.5 font-light'>
              Ou copie e cole este endereço no seu navegador:{' '}
              <Link href={documentUrl}>{documentUrl}</Link>
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

export default DocumentExpired

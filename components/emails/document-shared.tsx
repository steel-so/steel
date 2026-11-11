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

/** E-mail sent to a recipient of CRM > Documentos (ADR 0063). */
export interface DocumentSharedEmailProps {
  recipientName: string
  senderName: string
  workspaceName: string
  documentTitle: string
  /** Personal link `/d/<token>` of the recipient. */
  documentUrl: string
  /** Optional note typed by the sender. */
  message?: string | null
  /** Validity already formatted (dd/mm/aaaa), when there is one. */
  validUntil?: string | null
}

export const DocumentShared = ({
  recipientName,
  senderName,
  workspaceName,
  documentTitle,
  documentUrl,
  message,
  validUntil,
}: DocumentSharedEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>
          {senderName} enviou o documento {documentTitle} para você.
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
            <Text className='text-2xl leading-6.5'>
              <strong>{documentTitle}</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              Olá, {recipientName}. {senderName}, de{' '}
              <strong className='font-semibold'>{workspaceName}</strong>,
              enviou um documento para você.
            </Text>
            {message ? (
              <Text className='text-[14px] leading-6.5 font-light italic border-l-2 border-solid border-[#2893cc] pl-3'>
                {message}
              </Text>
            ) : null}
            {validUntil ? (
              <Text className='text-[14px] leading-6.5 font-light'>
                O documento vale até {validUntil}.
              </Text>
            ) : null}
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
            <Text className='text-[12px] leading-5 text-slate-500'>
              O link é pessoal: as leituras e respostas feitas por ele ficam
              registradas em seu nome.
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

export default DocumentShared

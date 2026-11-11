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

/** Owner e-mail when a reader accepts or declines a document (ADR 0063). */
export interface DocumentAnsweredEmailProps {
  username: string
  documentTitle: string
  workspaceName: string
  action: 'ACCEPT' | 'DECLINE'
  readerName: string
  /** Decline reason typed by the reader. */
  reason?: string | null
  /** Accepted total already formatted (R$), when the document has prices. */
  totalLabel?: string | null
  documentUrl: string
}

export const DocumentAnswered = ({
  username,
  documentTitle,
  workspaceName,
  action,
  readerName,
  reason,
  totalLabel,
  documentUrl,
}: DocumentAnsweredEmailProps) => {
  const accepted = action === 'ACCEPT'
  const headline = accepted
    ? `${documentTitle} foi aceito`
    : `${documentTitle} foi recusado`
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className='bg-[#f4f5f5] font-sans py-6'>
          <Preview>Steel | {headline}.</Preview>
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
                <strong>{headline}</strong>
              </Text>
              <Text className='text-[14px] leading-6.5 font-light'>
                Olá, {username}. <strong>{readerName}</strong>{' '}
                {accepted ? 'aceitou' : 'recusou'} o documento{' '}
                <strong className='font-semibold'>{documentTitle}</strong>, do
                workspace{' '}
                <strong className='font-semibold'>{workspaceName}</strong>.
              </Text>
              {accepted && totalLabel ? (
                <Text className='text-[14px] leading-6.5 font-light'>
                  Total aceito: <strong>{totalLabel}</strong>.
                </Text>
              ) : null}
              {!accepted && reason ? (
                <Text className='text-[14px] leading-6.5 font-light italic'>
                  Motivo informado: {reason}
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
            </Section>
            <EmailFooter />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export default DocumentAnswered

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
import type { CrmDocumentViewedEmailProps } from '@/types/mail'
import { EmailFooter } from '../_components/email-footer'

export const CrmDocumentViewed = ({
  username,
  title,
  detail,
  documentTitle,
  workspaceName,
  documentUrl,
}: CrmDocumentViewedEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>Steel | {title}</Preview>
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
              <strong>{title}</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              {username ? `Olá, ${username}. ` : ''}
              {detail} O documento{' '}
              <strong className='font-semibold'>{documentTitle}</strong> é do
              workspace{' '}
              <strong className='font-semibold'>{workspaceName}</strong>.
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              No painel do documento você vê quanto tempo cada seção foi lida,
              até onde o leitor chegou e de qual aparelho ele abriu.
            </Text>
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#2893cc] text-white text-center font-semibold'
              style={{ width: '-webkit-fill-available' }}
              href={documentUrl}
            >
              Ver a leitura do documento
            </Button>
          </Section>
          <Section>
            <Text className='text-[14px] leading-6.5 font-light'>
              Ou copie e cole essa URL no seu navegador:{' '}
              <Link href={documentUrl}>{documentUrl}</Link>
            </Text>
            <Text className='text-[12px] leading-5 font-light text-[#6b7280]'>
              Para não receber este e-mail, desligue o aviso de leitura por
              e-mail nas configurações do documento.
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

CrmDocumentViewed.PreviewProps = {
  email: 'joao@suaempresa.com.br',
  username: 'João',
  title: 'Maria Souza abriu Proposta comercial agora',
  detail: 'Primeira leitura do documento. No celular.',
  documentTitle: 'Proposta comercial',
  workspaceName: 'Stratus Telecom',
  documentUrl: 'https://steel.stratustelecom.com.br/acme/crm/documents/abc',
} satisfies CrmDocumentViewedEmailProps

export default CrmDocumentViewed

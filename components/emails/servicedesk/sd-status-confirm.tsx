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

export interface SdStatusConfirmEmailProps {
  email: string
  pageName: string
  workspaceName: string
  confirmUrl: string
}

/** Confirmação (double opt-in) da inscrição numa página de status. */
export const SdStatusConfirm = ({
  pageName,
  workspaceName,
  confirmUrl,
}: SdStatusConfirmEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>Confirme sua inscrição — {pageName}</Preview>
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
              <strong>Confirme sua inscrição</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              Alguém pediu para receber por e-mail os avisos de incidentes da
              página de status{' '}
              <strong className='font-semibold'>{pageName}</strong>, de{' '}
              <strong className='font-semibold'>{workspaceName}</strong>. Se
              foi você, confirme no botão abaixo.
            </Text>
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#101828] text-white text-center font-semibold'
              style={{ width: '-webkit-fill-available' }}
              href={confirmUrl}
            >
              Confirmar inscrição
            </Button>
          </Section>
          <Section>
            <Text className='text-[14px] leading-6.5 font-light'>
              Ou copie e cole este endereço no navegador:{' '}
              <Link href={confirmUrl}>{confirmUrl}</Link>
            </Text>
            <Text className='text-[13px] leading-6 font-light text-[#667085]'>
              Se não foi você, ignore este e-mail: sem a confirmação, nada é
              enviado.
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

SdStatusConfirm.PreviewProps = {
  email: 'ana@acme.com.br',
  pageName: 'Acme · Telefonia',
  workspaceName: 'Stratus Telecom',
  confirmUrl:
    'https://steel.stratustelecom.com.br/status-page/acme-telefonia/inscricao/abc',
} satisfies SdStatusConfirmEmailProps

export default SdStatusConfirm

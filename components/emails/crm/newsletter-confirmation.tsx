import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from 'react-email'

export type CrmNewsletterConfirmationEmailProps = {
  newsletterName: string
  /** Workspace (company) that publishes the newsletter. */
  publisherName: string
  name?: string | null
  confirmUrl: string
  /** Days until the link expires. */
  expiresInDays: number
}

/**
 * Double opt-in e-mail of a CRM newsletter (ADR 0054). Sent on behalf of
 * the customer, so it carries the newsletter's name, not the Steel brand.
 */
export const CrmNewsletterConfirmation = ({
  newsletterName,
  publisherName,
  name,
  confirmUrl,
  expiresInDays,
}: CrmNewsletterConfirmationEmailProps) => (
  <Html lang='pt-BR'>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>Confirme sua inscrição em {newsletterName}</Preview>
        <Container className='bg-white mx-auto py-10 px-6 max-w-140'>
          <Section>
            <Text className='text-2xl leading-6.5'>
              <strong>Confirme sua inscrição</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              {name ? `Olá, ${name}. ` : 'Olá. '}Recebemos um pedido para
              inscrever este e-mail na newsletter{' '}
              <strong className='font-semibold'>{newsletterName}</strong>, de{' '}
              {publisherName}. Para começar a receber, confirme no botão abaixo.
            </Text>
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#2893cc] text-white text-center font-semibold'
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
            <Text className='text-[13px] leading-6 text-slate-500'>
              O link vale por {expiresInDays} dias. Se você não pediu a
              inscrição, ignore este e-mail: sem a confirmação, você não recebe
              nada.
            </Text>
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

CrmNewsletterConfirmation.PreviewProps = {
  newsletterName: 'Novidades da Acme',
  publisherName: 'Acme',
  name: 'Ana',
  confirmUrl: 'https://steel.stratustelecom.com.br/newsletter/confirmar/abc',
  expiresInDays: 7,
} satisfies CrmNewsletterConfirmationEmailProps

export default CrmNewsletterConfirmation

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Tailwind,
  Text,
} from 'react-email'
import { baseEmailUrl } from '@/lib/base-email-url'
import { EmailFooter } from '../_components/email-footer'

export interface ChangelogEmailItem {
  title: string
  body: string
  imageUrl?: string | null
}

export interface ChangelogEmailProps {
  subject: string
  items: ChangelogEmailItem[]
}

export const ChangelogEmail = ({ subject, items }: ChangelogEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>Steel | {subject}</Preview>
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
              <strong>{subject}</strong>
            </Text>
          </Section>
          {items.map((item, index) => (
            <Section key={index} className='mt-2'>
              {index > 0 && <Hr className='my-6 border-[#e5e7eb]' />}
              <Text className='text-[16px] leading-6.5 font-semibold'>
                {item.title}
              </Text>
              {item.imageUrl ? (
                <Img
                  src={item.imageUrl}
                  alt={item.title}
                  className='w-full rounded-md mb-3'
                />
              ) : null}
              <Text className='text-[14px] leading-6.5 font-light whitespace-pre-line'>
                {item.body}
              </Text>
            </Section>
          ))}
          <Section className='mt-6'>
            <Text className='text-[14px] leading-6.5 font-light'>
              Tem dúvidas? Responda este email, nossa equipe lê tudo.
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

ChangelogEmail.PreviewProps = {
  subject: 'O que mudou no Steel',
  items: [
    {
      title: 'Equipes no WhatsApp e botões que fazem o trabalho',
      body: 'Organize o atendimento por equipes, com visibilidade por equipe, e use botões que já executam ações.',
      imageUrl: `${baseEmailUrl}/changelog/2026-10-14/capa-whatsapp.jpg`,
    },
    {
      title: 'Sites no CRM, com editor visual completo',
      body: 'Monte e publique sites direto no CRM, arrastando e soltando seções prontas.',
      imageUrl: `${baseEmailUrl}/changelog/2026-10-15/capa-sites.jpg`,
    },
    {
      title: 'Novo editor de e-mail, de arrastar e soltar',
      body: 'Crie e-mails de campanha no mesmo editor visual dos Sites.',
      imageUrl: null,
    },
  ],
} satisfies ChangelogEmailProps

export default ChangelogEmail

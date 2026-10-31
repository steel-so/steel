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
import type { CrmMeetingEmailProps } from '@/types/mail'
import { EmailFooter } from '../_components/email-footer'

const COPY = {
  confirmation: {
    title: 'Reunião confirmada',
    intro: 'Seu horário está reservado.',
    action: 'Ver ou cancelar o agendamento',
  },
  reminder: {
    title: 'Lembrete da sua reunião',
    intro: 'Sua reunião começa em breve.',
    action: 'Ver ou cancelar o agendamento',
  },
  canceled: {
    title: 'Reunião cancelada',
    intro: 'Este agendamento foi cancelado.',
    action: 'Agendar outro horário',
  },
} as const

export const CrmMeetingBooking = ({
  username,
  kind,
  workspaceName,
  pageTitle,
  hostName,
  whenLabel,
  timezone,
  location,
  manageUrl,
}: CrmMeetingEmailProps) => {
  const copy = COPY[kind]
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className='bg-[#f4f5f5] font-sans py-6'>
          <Preview>
            {copy.title}: {pageTitle}, {whenLabel}.
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
                <strong>{copy.title}</strong>
              </Text>
              <Text className='text-[14px] leading-6.5 font-light'>
                {username ? `Olá, ${username}. ` : ''}
                {copy.intro}
              </Text>
              <Text className='text-[14px] leading-6.5 font-light'>
                <strong className='font-semibold'>{pageTitle}</strong> com{' '}
                {hostName} ({workspaceName})
                <br />
                <strong className='font-semibold'>{whenLabel}</strong>{' '}
                <span>({timezone})</span>
                {location && kind !== 'canceled' ? (
                  <>
                    <br />
                    Local ou link: {location}
                  </>
                ) : null}
              </Text>
              {kind === 'confirmation' ? (
                <Text className='text-[14px] leading-6.5 font-light'>
                  O convite em anexo (.ics) adiciona a reunião à sua agenda.
                </Text>
              ) : null}
            </Section>
            <Section className='my-5'>
              <Button
                className='rounded-sm py-3 px-2.5 bg-[#2893cc] text-white text-center font-semibold'
                style={{ width: '-webkit-fill-available' }}
                href={manageUrl}
              >
                {copy.action}
              </Button>
            </Section>
            <Section>
              <Text className='text-[14px] leading-6.5 font-light'>
                Ou copie e cole essa URL no seu navegador:{' '}
                <Link href={manageUrl}>{manageUrl}</Link>
              </Text>
            </Section>
            <EmailFooter />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export default CrmMeetingBooking

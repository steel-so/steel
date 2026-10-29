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

export interface SurveyInvitationEmailProps {
  email: string
  recipientName?: string | null
  workspaceName: string
  question: string
  /** `/pesquisa/<token>` */
  surveyUrl: string
  /** Quick answers: each links to the page with the score pre-selected. */
  options: { label: string; url: string }[]
}

/**
 * Convite da pesquisa de satisfação (NPS/CSAT/CES) por e-mail. Os links só
 * abrem a página com a nota marcada; a resposta só vale ao confirmar lá (um
 * antivírus que "clica" nos links do e-mail não responde pelo cliente).
 */
export const SurveyInvitation = ({
  recipientName,
  workspaceName,
  question,
  surveyUrl,
  options,
}: SurveyInvitationEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className='bg-[#f4f5f5] font-sans py-6'>
        <Preview>Sua opinião sobre o atendimento — {workspaceName}</Preview>
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
              <strong>Como foi o atendimento?</strong>
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              {recipientName ? `Olá, ${recipientName}. ` : 'Olá. '}
              {workspaceName} quer saber a sua opinião.
            </Text>
            <Text className='text-[14px] leading-6.5 font-light'>
              {question}
            </Text>
          </Section>
          <Section className='my-4'>
            {options.map((option) => (
              <Link
                key={option.url}
                href={option.url}
                className='inline-block mr-2 mb-2 rounded-sm border border-solid border-[#d0d5dd] py-2 px-3 text-[14px] text-[#101828] no-underline'
              >
                {option.label}
              </Link>
            ))}
          </Section>
          <Section className='my-5'>
            <Button
              className='rounded-sm py-3 px-2.5 bg-[#101828] text-white text-center font-semibold'
              style={{ width: '-webkit-fill-available' }}
              href={surveyUrl}
            >
              Responder a pesquisa
            </Button>
          </Section>
          <Section>
            <Text className='text-[13px] leading-6 font-light text-[#667085]'>
              Leva menos de um minuto. Se você não esperava este e-mail, pode
              ignorá-lo.
            </Text>
          </Section>
          <EmailFooter />
        </Container>
      </Body>
    </Tailwind>
  </Html>
)

SurveyInvitation.PreviewProps = {
  email: 'ana@acme.com.br',
  recipientName: 'Ana Souza',
  workspaceName: 'Stratus Telecom',
  question:
    'Como você avalia o atendimento que recebeu? Escolha uma nota de 1 a 5.',
  surveyUrl: 'https://steel.stratustelecom.com.br/pesquisa/abc123',
  options: [1, 2, 3, 4, 5].map((n) => ({
    label: String(n),
    url: `https://steel.stratustelecom.com.br/pesquisa/abc123?nota=${n}`,
  })),
} satisfies SurveyInvitationEmailProps

export default SurveyInvitation

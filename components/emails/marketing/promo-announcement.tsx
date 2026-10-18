import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from 'react-email'
import { EmailFooter } from '@/components/emails/_components/email-footer'
import { MarketingFonts } from '@/components/emails/marketing/_shared/fonts'
import { marketingTailwindConfig } from '@/components/emails/marketing/_shared/theme'
import { baseEmailUrl } from '@/lib/base-email-url'
import { brand } from '@/lib/brand'

export type PromoAnnouncementEmailProps = {
  heading: string
  subheading?: string
  body: string
  imageUrl?: string
  ctaLabel?: string
  ctaUrl?: string
}

export const PromoAnnouncementEmail = ({
  heading,
  subheading,
  body,
  imageUrl,
  ctaLabel,
  ctaUrl,
}: PromoAnnouncementEmailProps) => (
  <Tailwind config={marketingTailwindConfig}>
    <Html>
      <Head>
        <MarketingFonts />
      </Head>
      <Body className='bg-bg-2 m-0 font-sans'>
        <Preview>{subheading || heading}</Preview>
        <Container className='mx-auto mt-8 w-full max-w-[640px] mobile:mt-0'>
          <Section className='bg-bg px-6 py-4 mobile:px-2'>
            <Section className='mb-3 px-6'>
              <Row>
                <Column className='w-1/2 py-[7px] align-middle'>
                  <Img
                    src={`${baseEmailUrl}/brand/logo-email-mark.png`}
                    alt={brand.displayName}
                    width={23}
                    height={24}
                    className='block'
                  />
                </Column>
                <Column align='right' className='w-1/2 py-[7px] align-middle'>
                  <Text className='font-13 m-0 text-right'>
                    <span className='text-fg-3'>{brand.displayName}</span>
                  </Text>
                </Column>
              </Row>
            </Section>

            <Section className='bg-bg-2 mb-6 rounded-[10px] px-5 pt-5 pb-14 mobile:mb-2 mobile:px-4 mobile:pt-4 mobile:pb-10'>
              {imageUrl ? (
                <Section className='mb-10'>
                  <Img
                    src={imageUrl}
                    alt={heading}
                    width={600}
                    className='mx-auto block w-full max-w-[600px] rounded-[12px]'
                  />
                </Section>
              ) : null}
              <Section className='mx-auto max-w-[422px] text-center'>
                {subheading ? (
                  <Text className='font-13 text-fg-3 mt-0 mb-6'>
                    {subheading}
                  </Text>
                ) : null}
                <Heading as='h1' className='font-40 text-fg mt-0 mb-6'>
                  {heading}
                </Heading>
                {body
                  .split('\n')
                  .filter((paragraph) => paragraph.trim().length > 0)
                  .map((paragraph, index) => (
                    <Text
                      key={`${index}-${paragraph.slice(0, 12)}`}
                      className='font-16 text-fg-2 m-0 mt-2 first:mt-0'
                    >
                      {paragraph}
                    </Text>
                  ))}
                {ctaLabel && ctaUrl ? (
                  <Section className='mt-8 text-center'>
                    <Button
                      href={ctaUrl}
                      className='bg-brand font-16 text-fg-inverted inline-block rounded-lg px-7 py-4 text-center leading-6'
                    >
                      {ctaLabel}
                    </Button>
                  </Section>
                ) : null}
              </Section>
            </Section>

            <EmailFooter />
          </Section>
        </Container>
      </Body>
    </Html>
  </Tailwind>
)

export default PromoAnnouncementEmail

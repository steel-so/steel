import type { Metadata } from 'next'
import { connection } from 'next/server'
import { PublicSurveyForm } from '@/app/_components/survey/public-survey-form'
import { SatisfactionSurveyService } from '@/src/services/satisfaction-survey.service'

export const metadata: Metadata = {
  title: 'Pesquisa de satisfação',
  robots: { index: false, follow: false },
}

/**
 * Página pública (sem login) do link da pesquisa enviada por e-mail. O GET
 * só mostra a pergunta (a nota do link vem marcada); a resposta só vale ao
 * clicar em enviar (POST), para que scanners de link não respondam sozinhos.
 */
export default async function PublicSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ nota?: string | string[] }>
}) {
  await connection()

  const [{ token }, query] = await Promise.all([params, searchParams])
  const survey = await SatisfactionSurveyService.getPublic(token)
  const raw = Array.isArray(query.nota) ? query.nota[0] : query.nota
  const initialScore =
    raw !== undefined && /^\d{1,2}$/.test(raw) ? Number(raw) : null

  return (
    <div className='flex min-h-screen items-center justify-center bg-muted/30 p-6'>
      <div className='w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm'>
        {survey.ok ? (
          <PublicSurveyForm
            token={token}
            survey={survey.value}
            initialScore={initialScore}
          />
        ) : (
          <div className='space-y-2'>
            <h1 className='font-semibold text-lg'>Link inválido</h1>
            <p className='text-muted-foreground text-sm'>
              Não encontramos esta pesquisa. Verifique se copiou o endereço
              completo do e-mail.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

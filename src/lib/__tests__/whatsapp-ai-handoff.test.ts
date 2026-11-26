import { describe, expect, it } from 'vitest'
import { replyAnnouncesHandoff } from '@/src/lib/whatsapp/ai-handoff'

describe('replyAnnouncesHandoff', () => {
  it.each([
    'Não consegui enviar a imagem diretamente. Vou transferir sua solicitação para a Viviane, que pode te ajudar com isso! Um momento.',
    'Vou transferir você para um atendente.',
    'Pronto! Já encaminhei o print do painel para a Viviane.',
    'Vou encaminhar seu pedido para o time comercial.',
    'Transferindo para a equipe de suporte, um momento.',
    'Vou repassar sua dúvida para o responsável.',
  ])('detects an announced transfer: %s', (reply) => {
    expect(replyAnnouncesHandoff(reply)).toBe(true)
  })

  it.each([
    'Boa! Vcs acompanham isso pelos relatórios?',
    'Dá pra transferir o número para a Stratus sem trocar nada.',
    'A portabilidade permite transferir a linha para a nossa operadora.',
    'Posso te mandar um print por aqui?',
    'Vou te explicar como funciona. Depois a gente vê a demonstração.',
    '',
  ])('ignores a normal answer: %s', (reply) => {
    expect(replyAnnouncesHandoff(reply)).toBe(false)
  })
})

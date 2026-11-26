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
    'Estou encaminhando o print do meu painel para a Viviane agora. Qualquer dúvida, estou por aqui!',
    'Só um segundinho! Já estou enviando o print do painel novamente.',
    'Vou pegar um print aqui do nosso painel e já te mando! Um momento.',
    'Pode ser sim! Vou agendar uma demonstração para hoje. Um momento.',
    'Vou verificar isso com o time e já te falo.',
    'Vou chamar o comercial pra vc, só um segundinho.',
    'Vou ver isso pra vc. Aguarde.',
  ])('detects an announced transfer: %s', (reply) => {
    expect(replyAnnouncesHandoff(reply)).toBe(true)
  })

  it.each([
    'Boa! Vcs acompanham isso pelos relatórios?',
    'Dá pra transferir o número para a Stratus sem trocar nada.',
    'A portabilidade permite transferir a linha para a nossa operadora.',
    'Posso te mandar um print por aqui?',
    'Quer que a Viviane te mande um print pra comparar?',
    'Claro! Qual dia e horário fica melhor pra vc?',
    'Vou te explicar como funciona. Um momento de atenção: o painel é em tempo real.',
    'Um momento, deixa eu entender melhor sua dúvida?',
    'O painel mostra as chamadas em tempo real.',
    'Vou te explicar como funciona. Depois a gente vê a demonstração.',
    '',
  ])('ignores a normal answer: %s', (reply) => {
    expect(replyAnnouncesHandoff(reply)).toBe(false)
  })
})

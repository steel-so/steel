import type { TourDefinition } from '../../types'

export const broadcastsTour: TourDefinition = {
  key: 'zap.broadcasts',
  version: 1,
  module: 'zap',
  title: 'Transmissões',
  description: 'Como enviar a mesma mensagem para vários contatos.',
  route: '/zap/transmissoes',
  docsHref: '/docs/comunicacao/transmissoes',
  steps: [
    {
      target: 'zap-broadcasts-intro',
      title: 'Mensagem para muitos contatos',
      body: 'Uma transmissão envia a mesma mensagem a uma lista de contatos, com um intervalo automático entre os envios para proteger o seu número.',
      placement: 'bottom',
    },
    {
      target: 'zap-broadcasts-actions',
      title: 'Montar a lista',
      body: '"Nova lista" cria uma transmissão com nome, conexão e mensagem. "Importar planilha" lê um arquivo CSV com os telefones e usa um template aprovado.',
      placement: 'bottom',
    },
    {
      title: 'Envio antes de uma data',
      body: 'Na importação, você define quantas horas antes da data de cada contato a mensagem sai. Serve para lembretes de consulta ou de evento.',
    },
    {
      target: 'zap-broadcasts-table',
      title: 'Acompanhar o envio',
      body: 'A tabela mostra o status e quantos já foram enviados. Em "Validar base" você descarta números sem WhatsApp, e "Ver falhas" explica cada erro.',
      placement: 'top',
    },
    {
      title: 'Custo antes de iniciar',
      body: 'Ao clicar em "Iniciar", o Steel mostra o custo estimado e o limite de gasto do número. Depois de começar, você ainda pode cancelar o que não saiu.',
    },
  ],
}

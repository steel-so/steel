import type { TourDefinition } from '../../../types'

export const newsletterIssueTour: TourDefinition = {
  key: 'crm.newsletters.issue',
  version: 1,
  module: 'crm',
  title: 'Editor de edição',
  description: 'Escreva a edição, teste e envie para os assinantes.',
  route: '/crm/newsletters/:newsletterId/issues/:issueId',
  openFrom: '/crm/newsletters',
  docsHref: '/docs/crm/newsletter-edicoes',
  desktopOnly: true,
  mobileSummary:
    'O editor de edições é visual e precisa de uma tela maior. Abra esta página em um computador ou tablet para escrever, testar e enviar a edição.',
  steps: [
    {
      title: 'Uma edição, do texto ao envio',
      body: 'Você monta o e-mail com blocos, testa em sua caixa de entrada e só então envia ou agenda. A edição é salva sozinha enquanto você trabalha.',
    },
    {
      target: 'newsletter-issue-subject',
      title: 'Assunto da edição',
      body: 'É o que o assinante lê primeiro na caixa de entrada. Ao lado, o botão com o endereço abre o texto de pré-visualização e o endereço público da edição.',
      placement: 'bottom',
    },
    {
      target: 'canvas-sidebar',
      title: 'Blocos e variáveis',
      body: 'Arraste textos, imagens, botões e colunas. Variáveis insere dados do assinante, Salvos guarda blocos seus e a aba IA ajuda a escrever uma seção.',
      placement: 'right',
    },
    {
      target: 'canvas-stage',
      title: 'O e-mail',
      body: 'Solte os blocos aqui e clique num elemento para editar o texto ou as propriedades. Use Celular, no alto, para conferir como fica no telefone.',
      placement: 'left',
    },
    {
      target: 'newsletter-issue-ai',
      title: 'Ajuda da IA',
      body: 'Use Escrever com IA para gerar um rascunho da edição ou Sugerir assuntos para ter opções de título. Leia e revise o resultado antes de enviar.',
      placement: 'bottom',
    },
    {
      target: 'newsletter-issue-test',
      title: 'Testar',
      body: 'Manda a edição para o seu e-mail antes do envio real. Confira o assunto, as imagens e os links, principalmente no celular.',
      placement: 'bottom',
    },
    {
      target: 'newsletter-issue-send',
      title: 'Enviar ou agendar',
      body: 'Escolha o público, que pode ser um segmento, e envie agora ou agende. O botão fica desativado até o domínio do remetente ser verificado.',
      placement: 'bottom',
    },
  ],
}

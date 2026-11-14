import type { TourDefinition } from '../../../types'

export const emailEditorTour: TourDefinition = {
  key: 'crm.email-templates.editor',
  version: 1,
  module: 'crm',
  title: 'Editor de e-mail',
  description:
    'Monte o e-mail com blocos, veja com um contato e envie um teste.',
  route: '/crm/email-templates/:templateId',
  openFrom: '/crm/email-templates',
  desktopOnly: true,
  mobileSummary:
    'O editor de e-mail é visual e precisa de uma tela maior. Abra esta página em um computador ou tablet para montar o e-mail, ver a prévia e enviar um teste.',
  steps: [
    {
      title: 'Monte o e-mail com blocos',
      body: 'Escolha blocos na lateral, solte no e-mail e ajuste à direita. O template é salvo sozinho enquanto você trabalha, então não existe botão de salvar.',
    },
    {
      target: 'email-editor-subject',
      title: 'Nome, assunto e pré-visualização',
      body: 'À esquerda você dá nome ao template. Aqui você escreve o assunto e o texto que aparece ao lado dele na caixa de entrada. Os dois são obrigatórios.',
      placement: 'bottom',
    },
    {
      target: 'canvas-sidebar',
      title: 'Blocos e variáveis',
      body: 'Em Adicionar estão textos, imagens, botões e colunas. Variáveis insere o nome do contato e outros dados. Salvos guarda blocos seus para reusar. Estilos globais muda a marca.',
      placement: 'right',
    },
    {
      target: 'canvas-stage',
      title: 'O e-mail',
      body: 'Arraste os blocos até aqui e clique num elemento para editar o texto ou abrir as propriedades. Use Celular, no alto, para ver como fica no telefone.',
      placement: 'left',
    },
    {
      target: 'email-editor-checklist',
      title: 'Checklist de envio',
      body: 'Lista o que precisa de atenção antes de enviar, entre erros e avisos. O número ao lado indica quantos itens há; os erros bloqueiam o envio de teste.',
      placement: 'bottom',
    },
    {
      target: 'email-editor-preview',
      title: 'Visualizar com um contato',
      body: 'Abre a prévia em uma janela grande. Você escolhe um contato real e as variáveis, como o nome, são preenchidas com os dados dele.',
      placement: 'bottom',
    },
    {
      target: 'email-editor-send-test',
      title: 'Enviar teste',
      body: 'Manda o e-mail para a sua caixa de entrada, com os dados de um contato à sua escolha, depois de checar os problemas do checklist.',
      placement: 'bottom',
    },
    {
      target: 'email-editor-use-in-campaign',
      title: 'Usar na campanha',
      body: 'Como você veio de uma campanha, este botão salva o template e volta para ela com o e-mail já selecionado.',
      placement: 'bottom',
    },
  ],
}

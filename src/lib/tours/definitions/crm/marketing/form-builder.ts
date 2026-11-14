import type { TourDefinition } from '../../../types'

export const formBuilderTour: TourDefinition = {
  key: 'crm.forms.builder',
  version: 1,
  module: 'crm',
  title: 'Construtor de formulários',
  description: 'Monte os campos, defina o destino das respostas e publique.',
  route: '/crm/forms/:id',
  openFrom: '/crm/forms',
  docsHref: '/docs/crm/formularios-e-paginas',
  steps: [
    {
      title: 'Um formulário, do campo ao CRM',
      body: 'À esquerda você configura o formulário; à direita vê, em tempo real, como ele aparece para quem for preencher.',
    },
    {
      target: 'form-builder-name',
      title: 'Nome do formulário',
      body: 'Clique para renomear. Esse é o título que a pessoa vê no topo do formulário publicado.',
      placement: 'bottom',
    },
    {
      target: 'form-builder-action',
      title: 'Para onde vai a resposta',
      body: 'Escolha o que acontece quando alguém responde: vira um lead no funil, uma pessoa ou uma empresa no CRM. Isso muda a que campos do CRM cada pergunta pode ser ligada.',
      placement: 'right',
    },
    {
      target: 'form-builder-fields',
      title: 'Campos',
      body: 'Adicione os campos, arraste para mudar a ordem e escolha o tipo de cada um. Em Preenche, ligue o campo ao dado do CRM que ele vai alimentar, como nome ou e-mail.',
      placement: 'right',
    },
    {
      target: 'form-builder-publish',
      title: 'Publicar',
      body: 'Ligue o interruptor para ativar o endereço público e copie a URL para usar em links, em um site ou numa campanha. Desligado, o formulário não recebe respostas.',
      placement: 'right',
    },
    {
      target: 'form-builder-preview',
      title: 'Pré-visualização',
      body: 'Veja o formulário como a pessoa verá e alterne entre computador, tablet e celular. Formulários com duas ou mais fases viram um passo a passo.',
      placement: 'left',
    },
    {
      target: 'form-builder-responses',
      title: 'Respostas',
      body: 'Abre as respostas recebidas, com o total ao lado do nome. Cada uma também aparece no CRM, conforme o destino escolhido.',
      placement: 'bottom',
    },
    {
      target: 'form-builder-save',
      title: 'Salvar',
      body: 'As alterações são salvas sozinhas, mas você pode salvar na hora por aqui. Ao sair com mudanças pendentes, o Steel avisa antes.',
      placement: 'bottom',
    },
  ],
}

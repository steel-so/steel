import type { DocumentKindDTO } from '@/src/schemas/document.schema'
import {
  type DocumentOutline,
  type OutlineToDocumentResult,
  outlineToDocument,
} from './outline'

/**
 * Built-in starters of the "Novo documento" gallery (proposal, contract,
 * quote, presentation, terms, report...), written as outlines and built
 * with the catalog presets. Texts use merge tags (`{{empresa.nome}}`...)
 * so a starter already reads as a real document for each recipient.
 */
export interface DocumentStarterMeta {
  id: string
  title: string
  description: string
  kind: DocumentKindDTO
  /** Preview image under `public/`, optional. */
  thumbnail?: string
}

interface Starter {
  meta: DocumentStarterMeta
  outline: DocumentOutline
}

const COMMERCIAL_PROPOSAL: Starter = {
  meta: {
    id: 'proposta-comercial',
    title: 'Proposta comercial',
    description:
      'Capa, contexto do cliente, solução, investimento com itens opcionais, cronograma e aceite.',
    kind: 'PROPOSAL',
  },
  outline: {
    title: 'Proposta comercial',
    kind: 'PROPOSAL',
    sections: [
      {
        name: 'Capa',
        variant: 'cover',
        blocks: [
          { type: 'heading', text: 'Proposta para {{empresa.nome}}', level: 1 },
          {
            type: 'text',
            html: '<p>{{oportunidade.titulo}} · preparada por {{responsavel.nome}}, {{workspace.nome}}</p>',
          },
          { type: 'validity' },
        ],
      },
      {
        name: 'Sumário',
        blocks: [{ type: 'toc' }],
      },
      {
        name: 'Contexto',
        blocks: [
          { type: 'heading', text: 'O que entendemos do seu momento' },
          {
            type: 'text',
            html: '<p>Olá, {{contato.nome}}. Nas nossas conversas, ficou claro que a {{empresa.nome}} quer crescer sem aumentar a complexidade da operação. Esta proposta reúne o que combinamos e o caminho que sugerimos para chegar lá.</p>',
          },
          {
            type: 'columns',
            columns: [
              [
                { type: 'heading', text: 'Desafios', level: 3 },
                {
                  type: 'list',
                  items: [
                    'Processos manuais e planilhas espalhadas',
                    'Pouca visibilidade dos resultados',
                    'Tempo de resposta alto para os clientes',
                  ],
                },
              ],
              [
                { type: 'heading', text: 'Objetivos', level: 3 },
                {
                  type: 'list',
                  items: [
                    'Centralizar o atendimento e as vendas',
                    'Indicadores em tempo real',
                    'Reduzir o tempo de resposta pela metade',
                  ],
                },
              ],
            ],
          },
        ],
      },
      {
        name: 'Solução',
        variant: 'highlight',
        blocks: [
          { type: 'heading', text: 'Nossa solução' },
          {
            type: 'text',
            html: '<p>Uma implantação em etapas curtas, com entregas visíveis a cada semana e um time dedicado do início ao fim.</p>',
          },
          {
            type: 'stats',
            items: [
              { value: '4 semanas', label: 'para entrar em operação' },
              { value: '100%', label: 'dos dados migrados' },
              { value: '24h', label: 'de suporte na virada' },
            ],
          },
        ],
      },
      {
        name: 'Investimento',
        blocks: [
          { type: 'heading', text: 'Investimento' },
          {
            type: 'pricing',
            items: [
              {
                id: 'implantacao',
                name: 'Implantação e configuração',
                description:
                  'Levantamento, configuração, migração e treinamento.',
                unit: 'projeto',
                unitPrice: 12000,
                quantity: 1,
              },
              {
                id: 'licencas',
                name: 'Licenças',
                description: 'Por usuário, com atualizações e suporte.',
                unit: 'usuários',
                unitPrice: 149,
                quantity: 10,
                quantityEditable: true,
                recurrence: 'monthly',
              },
              {
                id: 'treinamento',
                name: 'Treinamento avançado para gestores',
                unitPrice: 2400,
                quantity: 1,
                optional: true,
              },
            ],
          },
          {
            type: 'callout',
            tone: 'info',
            text: 'Valores em reais. Escolha os itens opcionais e ajuste a quantidade de licenças: o total se atualiza na hora.',
          },
        ],
      },
      {
        name: 'Cronograma',
        blocks: [
          { type: 'heading', text: 'Cronograma' },
          {
            type: 'table',
            header: ['Etapa', 'O que acontece', 'Prazo'],
            rows: [
              ['Kickoff', 'Alinhamento de metas e acessos', 'Semana 1'],
              [
                'Configuração',
                'Fluxos, usuários e integrações',
                'Semanas 2 e 3',
              ],
              ['Treinamento', 'Turmas por perfil de uso', 'Semana 3'],
              ['Virada', 'Operação assistida', 'Semana 4'],
            ],
          },
        ],
      },
      {
        name: 'Aceite',
        blocks: [
          { type: 'heading', text: 'Próximos passos' },
          {
            type: 'text',
            html: '<p>Com o aceite, agendamos o kickoff em até três dias úteis.</p>',
          },
          {
            type: 'accept',
            buttonLabel: 'Aceitar proposta',
            allowDecline: true,
          },
          { type: 'contact-card' },
        ],
      },
    ],
  },
}

const RECURRING_PROPOSAL: Starter = {
  meta: {
    id: 'proposta-recorrente',
    title: 'Proposta de serviço recorrente',
    description:
      'Planos mensais com escopo, níveis de serviço, mensalidade e aceite.',
    kind: 'PROPOSAL',
  },
  outline: {
    title: 'Proposta de serviço recorrente',
    kind: 'PROPOSAL',
    sections: [
      {
        name: 'Capa',
        variant: 'cover',
        blocks: [
          {
            type: 'heading',
            text: 'Gestão contínua para {{empresa.nome}}',
            level: 1,
          },
          {
            type: 'text',
            html: '<p>Uma parceria mensal para manter sua operação estável, segura e evoluindo todo mês.</p>',
          },
          { type: 'validity' },
        ],
      },
      {
        name: 'Escopo',
        blocks: [
          { type: 'heading', text: 'O que está incluído' },
          {
            type: 'columns',
            columns: [
              [
                { type: 'heading', text: 'Todo mês', level: 3 },
                {
                  type: 'list',
                  items: [
                    'Monitoramento 24 horas por dia',
                    'Atualizações e correções de segurança',
                    'Relatório mensal com indicadores',
                  ],
                },
              ],
              [
                { type: 'heading', text: 'Sempre que precisar', level: 3 },
                {
                  type: 'list',
                  items: [
                    'Atendimento por chat, e-mail e telefone',
                    'Visitas técnicas agendadas',
                    'Consultoria para novos projetos',
                  ],
                },
              ],
            ],
          },
        ],
      },
      {
        name: 'Níveis de serviço',
        variant: 'highlight',
        blocks: [
          { type: 'heading', text: 'Níveis de serviço' },
          {
            type: 'table',
            header: ['Prioridade', 'Primeira resposta', 'Solução'],
            rows: [
              ['Crítica', '30 minutos', '4 horas'],
              ['Alta', '1 hora', '8 horas'],
              ['Normal', '4 horas', '2 dias úteis'],
            ],
          },
        ],
      },
      {
        name: 'Mensalidade',
        blocks: [
          { type: 'heading', text: 'Mensalidade' },
          {
            type: 'pricing',
            items: [
              {
                id: 'plano',
                name: 'Plano de gestão',
                description: 'Até 50 usuários e 10 servidores.',
                unitPrice: 3900,
                quantity: 1,
                recurrence: 'monthly',
              },
              {
                id: 'usuarios-extras',
                name: 'Usuários adicionais',
                unit: 'usuários',
                unitPrice: 45,
                quantity: 0,
                quantityEditable: true,
                recurrence: 'monthly',
              },
              {
                id: 'onboarding',
                name: 'Onboarding',
                description: 'Inventário, documentação e ajustes iniciais.',
                unitPrice: 2500,
                quantity: 1,
                discountPct: 50,
              },
            ],
          },
          {
            type: 'callout',
            tone: 'success',
            text: 'Fidelidade de 12 meses, com reajuste anual pelo IPCA. Cancelamento com 30 dias de aviso após o período.',
          },
        ],
      },
      {
        name: 'Aceite',
        blocks: [
          {
            type: 'accept',
            buttonLabel: 'Contratar plano',
            allowDecline: true,
          },
          { type: 'contact-card' },
        ],
      },
    ],
  },
}

const SERVICE_CONTRACT: Starter = {
  meta: {
    id: 'contrato-servicos',
    title: 'Contrato de prestação de serviços',
    description:
      'Partes, objeto, obrigações, valores, vigência, rescisão, foro e aceite eletrônico.',
    kind: 'CONTRACT',
  },
  outline: {
    title: 'Contrato de prestação de serviços',
    kind: 'CONTRACT',
    sections: [
      {
        name: 'Partes',
        blocks: [
          {
            type: 'heading',
            text: 'Contrato de prestação de serviços',
            level: 1,
          },
          {
            type: 'table',
            header: ['', 'Contratada', 'Contratante'],
            rows: [
              ['Razão social', '{{workspace.nome}}', '{{empresa.nome}}'],
              ['CNPJ', '', '{{empresa.cnpj}}'],
              ['Representante', '{{responsavel.nome}}', '{{contato.nome}}'],
            ],
          },
          {
            type: 'text',
            html: '<p>As partes acima identificadas celebram este contrato, que se rege pelas cláusulas a seguir.</p>',
          },
        ],
      },
      {
        name: 'Objeto',
        blocks: [
          { type: 'heading', text: '1. Objeto', level: 2 },
          {
            type: 'text',
            html: '<p>A CONTRATADA prestará à CONTRATANTE os serviços descritos em <strong>{{oportunidade.titulo}}</strong>, conforme o escopo e os níveis de serviço deste documento.</p>',
          },
        ],
      },
      {
        name: 'Obrigações',
        blocks: [
          { type: 'heading', text: '2. Obrigações das partes', level: 2 },
          {
            type: 'columns',
            columns: [
              [
                { type: 'heading', text: 'Da contratada', level: 3 },
                {
                  type: 'list',
                  ordered: true,
                  items: [
                    'Executar os serviços com qualidade e nos prazos acordados.',
                    'Manter sigilo sobre as informações da contratante.',
                    'Indicar um responsável pelo atendimento.',
                  ],
                },
              ],
              [
                { type: 'heading', text: 'Da contratante', level: 3 },
                {
                  type: 'list',
                  ordered: true,
                  items: [
                    'Fornecer acessos e informações necessários.',
                    'Efetuar os pagamentos nas datas de vencimento.',
                    'Validar as entregas em até cinco dias úteis.',
                  ],
                },
              ],
            ],
          },
        ],
      },
      {
        name: 'Valores',
        blocks: [
          { type: 'heading', text: '3. Valores e pagamento', level: 2 },
          {
            type: 'text',
            html: '<p>Pelos serviços, a CONTRATANTE pagará <strong>{{oportunidade.valor}}</strong>, conforme a tabela abaixo, por boleto ou Pix com vencimento todo dia 10.</p>',
          },
          {
            type: 'pricing',
            items: [
              {
                id: 'servicos',
                name: 'Prestação de serviços',
                unitPrice: 4000,
                quantity: 1,
                recurrence: 'monthly',
              },
            ],
          },
          {
            type: 'callout',
            tone: 'warning',
            text: 'Atrasos sujeitam-se a multa de 2% e juros de 1% ao mês, calculados pro rata die.',
          },
        ],
      },
      {
        name: 'Vigência e rescisão',
        blocks: [
          { type: 'heading', text: '4. Vigência e rescisão', level: 2 },
          {
            type: 'text',
            html: '<p>Este contrato vigora por 12 meses a partir do aceite, renovando-se automaticamente por iguais períodos. Qualquer parte pode rescindi-lo com aviso prévio de 30 dias, sem multa após o primeiro ano.</p>',
          },
          { type: 'heading', text: '5. Proteção de dados', level: 2 },
          {
            type: 'text',
            html: '<p>As partes tratam dados pessoais conforme a Lei 13.709/2018 (LGPD), apenas para as finalidades deste contrato.</p>',
          },
          { type: 'heading', text: '6. Foro', level: 2 },
          {
            type: 'text',
            html: '<p>Fica eleito o foro da comarca da sede da CONTRATADA para dirimir dúvidas deste contrato.</p>',
          },
        ],
      },
      {
        name: 'Aceite',
        pageBreakBefore: true,
        blocks: [
          { type: 'heading', text: 'Aceite eletrônico', level: 2 },
          {
            type: 'accept',
            buttonLabel: 'Aceitar contrato',
            terms:
              'Ao aceitar, você declara ter poderes para representar {{empresa.nome}} e concorda com todas as cláusulas acima.',
            allowDecline: false,
          },
        ],
      },
    ],
  },
}

const QUOTE: Starter = {
  meta: {
    id: 'orcamento',
    title: 'Orçamento',
    description:
      'Itens com quantidade, descontos e opcionais, condições de pagamento e validade.',
    kind: 'QUOTE',
  },
  outline: {
    title: 'Orçamento',
    kind: 'QUOTE',
    sections: [
      {
        name: 'Orçamento',
        blocks: [
          {
            type: 'columns',
            columns: [
              [
                { type: 'heading', text: 'Orçamento', level: 1 },
                {
                  type: 'text',
                  html: '<p>Para <strong>{{empresa.nome}}</strong><br>A/C {{contato.nome}} · {{contato.email}}</p>',
                },
              ],
              [{ type: 'validity' }],
            ],
          },
          { type: 'divider' },
          {
            type: 'pricing',
            items: [
              {
                id: 'equipamento',
                name: 'Equipamentos',
                description: 'Notebooks com garantia de 3 anos on-site.',
                unit: 'un.',
                unitPrice: 6200,
                quantity: 5,
                discountPct: 8,
                quantityEditable: true,
              },
              {
                id: 'instalacao',
                name: 'Instalação e configuração',
                unit: 'un.',
                unitPrice: 180,
                quantity: 5,
              },
              {
                id: 'garantia',
                name: 'Garantia estendida (+2 anos)',
                unit: 'un.',
                unitPrice: 420,
                quantity: 5,
                optional: true,
              },
            ],
          },
        ],
      },
      {
        name: 'Condições',
        variant: 'highlight',
        blocks: [
          { type: 'heading', text: 'Condições', level: 3 },
          {
            type: 'list',
            items: [
              'Pagamento: 30% no pedido e o restante na entrega, por boleto ou Pix.',
              'Entrega: até 15 dias úteis após a confirmação.',
              'Frete incluso para a capital e região metropolitana.',
            ],
          },
          {
            type: 'accept',
            buttonLabel: 'Aprovar orçamento',
            allowDecline: true,
          },
        ],
      },
    ],
  },
}

const PRESENTATION: Starter = {
  meta: {
    id: 'apresentacao-institucional',
    title: 'Apresentação institucional',
    description:
      'Quem somos, números, serviços, clientes, depoimento e contato, pronta para enviar.',
    kind: 'PRESENTATION',
  },
  outline: {
    title: 'Apresentação institucional',
    kind: 'PRESENTATION',
    sections: [
      {
        name: 'Capa',
        variant: 'cover',
        blocks: [
          { type: 'heading', text: '{{workspace.nome}}', level: 1 },
          {
            type: 'text',
            html: '<p>Tecnologia e atendimento próximo para empresas que não podem parar.</p>',
          },
        ],
      },
      {
        name: 'Quem somos',
        blocks: [
          {
            type: 'columns',
            columns: [
              [
                { type: 'heading', text: 'Quem somos' },
                {
                  type: 'text',
                  html: '<p>Há mais de dez anos ajudamos empresas a simplificar a operação com tecnologia, processos claros e um time que conhece cada cliente pelo nome.</p>',
                },
              ],
              [{ type: 'image', alt: 'Foto da equipe' }],
            ],
          },
          {
            type: 'stats',
            items: [
              { value: '10+', label: 'anos de mercado' },
              { value: '350', label: 'clientes ativos' },
              { value: '98%', label: 'de satisfação' },
              { value: '15 min', label: 'tempo médio de resposta' },
            ],
          },
        ],
      },
      {
        name: 'Serviços',
        variant: 'highlight',
        blocks: [
          { type: 'heading', text: 'O que fazemos' },
          {
            type: 'columns',
            columns: [
              [
                { type: 'heading', text: 'Infraestrutura', level: 3 },
                {
                  type: 'text',
                  html: '<p>Redes, servidores e nuvem dimensionados para o seu tamanho.</p>',
                },
              ],
              [
                { type: 'heading', text: 'Atendimento', level: 3 },
                {
                  type: 'text',
                  html: '<p>Central de serviços com SLA e indicadores abertos.</p>',
                },
              ],
              [
                { type: 'heading', text: 'Projetos', level: 3 },
                {
                  type: 'text',
                  html: '<p>Implantações com escopo fechado e entregas semanais.</p>',
                },
              ],
            ],
          },
        ],
      },
      {
        name: 'Clientes',
        blocks: [
          {
            type: 'quote',
            text: 'Em seis meses, o tempo de resposta caiu pela metade e o time passou a enxergar os números da operação.',
            author: 'Ana Ribeiro, diretora de operações',
          },
          {
            type: 'video',
            url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
          },
        ],
      },
      {
        name: 'Contato',
        blocks: [
          { type: 'heading', text: 'Vamos conversar?' },
          { type: 'contact-card' },
          {
            type: 'button',
            label: 'Fale com a gente',
            href: 'mailto:{{responsavel.email}}',
          },
        ],
      },
    ],
  },
}

const TERMS: Starter = {
  meta: {
    id: 'termo-de-aceite',
    title: 'Termo de aceite',
    description:
      'Confirmação de entrega ou de condições com identificação e aceite eletrônico.',
    kind: 'TERMS',
  },
  outline: {
    title: 'Termo de aceite',
    kind: 'TERMS',
    sections: [
      {
        name: 'Termo',
        blocks: [
          { type: 'heading', text: 'Termo de aceite de entrega', level: 1 },
          {
            type: 'text',
            html: '<p>Eu, representante de <strong>{{empresa.nome}}</strong>, declaro que recebi e validei as entregas referentes a <strong>{{oportunidade.titulo}}</strong>, executadas por {{workspace.nome}}.</p>',
          },
          {
            type: 'table',
            header: ['Entrega', 'Situação'],
            rows: [
              ['Ambiente configurado', 'Entregue'],
              ['Usuários treinados', 'Entregue'],
              ['Documentação técnica', 'Entregue'],
            ],
          },
          {
            type: 'callout',
            tone: 'info',
            text: 'Pendências apontadas até a data do aceite seguem tratadas pelo suporte, sem custo adicional.',
          },
          {
            type: 'field',
            fieldType: 'field-textarea',
            label: 'Observações (opcional)',
          },
          {
            type: 'accept',
            buttonLabel: 'Aceitar entrega',
            allowDecline: true,
          },
        ],
      },
    ],
  },
}

const MONTHLY_REPORT: Starter = {
  meta: {
    id: 'relatorio-mensal',
    title: 'Relatório mensal ao cliente',
    description:
      'Resumo do mês, indicadores, entregas, próximos passos e reunião de acompanhamento.',
    kind: 'REPORT',
  },
  outline: {
    title: 'Relatório mensal',
    kind: 'REPORT',
    sections: [
      {
        name: 'Capa',
        variant: 'cover',
        blocks: [
          {
            type: 'heading',
            text: 'Relatório mensal · {{empresa.nome}}',
            level: 1,
          },
          {
            type: 'text',
            html: '<p>Preparado por {{responsavel.nome}} em {{data.hoje}}</p>',
          },
        ],
      },
      {
        name: 'Resumo',
        blocks: [
          { type: 'heading', text: 'Resumo do mês' },
          {
            type: 'text',
            html: '<p>O mês foi estável, com todos os indicadores dentro da meta e duas melhorias entregues antes do prazo.</p>',
          },
          {
            type: 'stats',
            items: [
              { value: '142', label: 'chamados atendidos' },
              { value: '99,8%', label: 'de disponibilidade' },
              { value: '1h12', label: 'tempo médio de solução' },
            ],
          },
        ],
      },
      {
        name: 'Entregas',
        blocks: [
          { type: 'heading', text: 'Entregas' },
          {
            type: 'table',
            header: ['Item', 'Status', 'Data'],
            rows: [
              ['Atualização dos servidores', 'Concluído', '05/11'],
              ['Novo fluxo de aprovação', 'Concluído', '12/11'],
              ['Backup em nuvem', 'Em andamento', '28/11'],
            ],
          },
        ],
      },
      {
        name: 'Próximos passos',
        variant: 'highlight',
        blocks: [
          { type: 'heading', text: 'Próximos passos' },
          {
            type: 'list',
            ordered: true,
            items: [
              'Concluir a migração do backup para a nuvem.',
              'Revisar os acessos dos usuários desligados.',
              'Planejar as melhorias do próximo trimestre.',
            ],
          },
          { type: 'attachments', files: [] },
        ],
      },
    ],
  },
}

const REGISTRATION_FORM: Starter = {
  meta: {
    id: 'ficha-cadastral',
    title: 'Ficha cadastral com campos',
    description:
      'Coleta de dados da empresa e do responsável com CPF, CNPJ e telefone validados.',
    kind: 'OTHER',
  },
  outline: {
    title: 'Ficha cadastral',
    kind: 'OTHER',
    sections: [
      {
        name: 'Apresentação',
        blocks: [
          { type: 'heading', text: 'Ficha cadastral', level: 1 },
          {
            type: 'text',
            html: '<p>Olá, {{contato.nome}}! Preencha os dados abaixo para concluirmos o cadastro de {{empresa.nome}}. Leva menos de três minutos.</p>',
          },
        ],
      },
      {
        name: 'Empresa',
        blocks: [
          { type: 'heading', text: 'Dados da empresa', level: 2 },
          {
            type: 'field',
            fieldType: 'field-text',
            label: 'Razão social',
            required: true,
          },
          {
            type: 'field',
            fieldType: 'field-cnpj',
            label: 'CNPJ',
            required: true,
          },
          {
            type: 'field',
            fieldType: 'field-phone',
            label: 'Telefone comercial',
          },
          {
            type: 'field',
            fieldType: 'field-email',
            label: 'E-mail para faturamento',
            required: true,
          },
          {
            type: 'field',
            fieldType: 'field-select',
            label: 'Porte da empresa',
            options: [
              'Até 10 pessoas',
              '11 a 50 pessoas',
              'Mais de 50 pessoas',
            ],
          },
        ],
      },
      {
        name: 'Responsável',
        blocks: [
          { type: 'heading', text: 'Responsável', level: 2 },
          {
            type: 'field',
            fieldType: 'field-text',
            label: 'Nome completo',
            required: true,
          },
          {
            type: 'field',
            fieldType: 'field-cpf',
            label: 'CPF',
            required: true,
          },
          {
            type: 'field',
            fieldType: 'field-date',
            label: 'Data de nascimento',
          },
          {
            type: 'field',
            fieldType: 'field-phone',
            label: 'Celular',
            required: true,
          },
          {
            type: 'field',
            fieldType: 'field-checkbox',
            label:
              'Autorizo o contato por e-mail e WhatsApp sobre este cadastro.',
          },
          {
            type: 'accept',
            buttonLabel: 'Enviar ficha',
            terms:
              'Seus dados são usados apenas para este cadastro, conforme a LGPD.',
            allowDecline: false,
          },
        ],
      },
    ],
  },
}

const STARTERS: Starter[] = [
  COMMERCIAL_PROPOSAL,
  RECURRING_PROPOSAL,
  SERVICE_CONTRACT,
  QUOTE,
  PRESENTATION,
  TERMS,
  MONTHLY_REPORT,
  REGISTRATION_FORM,
]

export const DOCUMENT_STARTERS: DocumentStarterMeta[] = STARTERS.map(
  (starter) => starter.meta,
)

/** Outline of a starter (the AI prompt shows one as an example). */
export function getDocumentStarterOutline(id: string): DocumentOutline | null {
  return STARTERS.find((starter) => starter.meta.id === id)?.outline ?? null
}

/** Content + theme of a starter, or null when the id is unknown. */
export function getDocumentStarter(
  id: string,
): (OutlineToDocumentResult & { meta: DocumentStarterMeta }) | null {
  const starter = STARTERS.find((item) => item.meta.id === id)
  if (!starter) return null
  return { ...outlineToDocument(starter.outline), meta: starter.meta }
}

import {
  type ComparisonCatalog,
  ComparisonCatalogSchema,
} from '../schemas/competitor-comparison.schema'

/**
 * Competitor list prices and features shown on /pricing. Review every
 * quarter: open each `sourceUrl`, update the values and `checkedAt`. Prices
 * are list prices per user/agent per month on annual billing, in the
 * vendor's own currency (cents), exactly as the public page shows them.
 * Features follow the vendor's public pages only: anything not stated there
 * is `no-info`. Steel's own price is never here — it comes from
 * `src/config/plan-prices.ts`. Update `exchangeRate` together with the
 * prices (PTAX selling rate of the review day).
 *
 * Last checked on 2026-10-09 (see the PR of the web-content slice for what
 * changed against the first research).
 */
const CATALOG: ComparisonCatalog = {
  checkedAt: '2026-10',
  // PTAX selling rate published by the Banco Central do Brasil on this day.
  exchangeRate: { usdBrl: 5.0441, date: '2026-10-14' },
  blocks: [
    {
      module: 'servicedesk',
      title: 'Steel vs ServiceDesk',
      competitors: [
        {
          id: 'zendesk',
          name: 'Zendesk Suite',
          domain: 'zendesk.com',
          currency: 'USD',
          sourceUrl: 'https://www.zendesk.com/pricing/',
          plans: [
            { name: 'Suite Team', price: { kind: 'per-seat', cents: 5500 } },
            {
              name: 'Suite Professional',
              price: { kind: 'per-seat', cents: 11500 },
            },
            {
              name: 'Suite Enterprise + Copilot',
              price: { kind: 'quote' },
            },
          ],
        },
        {
          id: 'freshservice',
          name: 'Freshservice',
          domain: 'freshworks.com',
          currency: 'USD',
          sourceUrl: 'https://www.freshworks.com/freshservice/pricing/',
          plans: [
            { name: 'Starter', price: { kind: 'per-seat', cents: 1900 } },
            { name: 'Growth', price: { kind: 'per-seat', cents: 4900 } },
            { name: 'Pro', price: { kind: 'per-seat', cents: 9900 } },
            { name: 'Enterprise', price: { kind: 'quote' } },
          ],
        },
        {
          id: 'jsm',
          name: 'Jira Service Management',
          domain: 'atlassian.com',
          currency: 'USD',
          sourceUrl: 'https://www.atlassian.com/collections/service/pricing',
          plans: [
            {
              name: 'Free',
              price: { kind: 'per-seat', cents: 0 },
              note: 'até 3 agentes',
            },
            {
              name: 'Standard',
              price: { kind: 'per-seat', cents: 2000 },
              note: 'a partir de; varia com o número de agentes',
            },
            {
              name: 'Premium',
              price: { kind: 'per-seat', cents: 5142 },
              note: 'a partir de; varia com o número de agentes',
            },
            { name: 'Enterprise', price: { kind: 'quote' } },
          ],
        },
      ],
      features: [
        {
          label: 'Incidentes, problemas e mudanças (ITIL)',
          steel: 'yes',
          competitors: { zendesk: 'yes', freshservice: 'plan', jsm: 'yes' },
        },
        {
          label: 'Gestão de SLA',
          steel: 'yes',
          competitors: { zendesk: 'plan', freshservice: 'plan', jsm: 'yes' },
        },
        {
          label: 'Catálogo de serviços',
          steel: 'yes',
          competitors: {
            zendesk: 'plan',
            freshservice: 'plan',
            jsm: 'no-info',
          },
        },
        {
          label: 'CMDB (itens de configuração)',
          steel: 'yes',
          competitors: { zendesk: 'no-info', freshservice: 'plan', jsm: 'yes' },
        },
        {
          label: 'Base de conhecimento',
          steel: 'yes',
          competitors: { zendesk: 'yes', freshservice: 'yes', jsm: 'yes' },
        },
        {
          label: 'Portal do solicitante',
          steel: 'yes',
          competitors: { zendesk: 'plan', freshservice: 'yes', jsm: 'yes' },
        },
        {
          label: 'Assistente de IA integrado',
          steel: 'yes',
          competitors: { zendesk: 'yes', freshservice: 'plan', jsm: 'yes' },
        },
        {
          label: 'CRM e WhatsApp no mesmo produto',
          steel: 'yes',
          competitors: {
            zendesk: 'no-info',
            freshservice: 'no-info',
            jsm: 'no-info',
          },
        },
      ],
      notes: [
        'Jira Service Management: o preço por agente muda com o número de agentes; o valor é o "a partir de" da página oficial.',
        'Freshservice: gestão de problemas e mudanças a partir do plano Pro; SLA, catálogo e ativos a partir do Growth; agente de IA no Enterprise.',
      ],
    },
    {
      module: 'crm',
      title: 'Steel vs CRM',
      competitors: [
        {
          id: 'salesforce',
          name: 'Salesforce Sales Cloud',
          domain: 'salesforce.com',
          currency: 'USD',
          sourceUrl: 'https://www.salesforce.com/sales/pricing/',
          plans: [
            { name: 'Starter Suite', price: { kind: 'per-seat', cents: 2500 } },
            { name: 'Pro Suite', price: { kind: 'per-seat', cents: 10000 } },
            { name: 'Core', price: { kind: 'per-seat', cents: 19500 } },
          ],
        },
        {
          id: 'hubspot',
          name: 'HubSpot Sales Hub',
          domain: 'hubspot.com',
          currency: 'USD',
          sourceUrl: 'https://www.hubspot.com/pricing/sales',
          plans: [
            {
              name: 'Starter',
              price: { kind: 'per-seat-range', minCents: 700, maxCents: 2000 },
            },
            {
              name: 'Professional',
              price: {
                kind: 'per-seat-range',
                minCents: 9000,
                maxCents: 10000,
              },
              note: '+ US$ 1.500 de onboarding',
            },
            {
              name: 'Enterprise',
              price: { kind: 'per-seat', cents: 15000 },
              note: '+ US$ 3.500 de onboarding',
            },
          ],
        },
        {
          id: 'pipedrive',
          name: 'Pipedrive',
          domain: 'pipedrive.com',
          currency: 'USD',
          sourceUrl: 'https://www.pipedrive.com/pt/pricing',
          plans: [
            { name: 'Lite', price: { kind: 'per-seat', cents: 1400 } },
            { name: 'Growth', price: { kind: 'per-seat', cents: 2400 } },
            { name: 'Premium', price: { kind: 'per-seat', cents: 4900 } },
            { name: 'Ultimate', price: { kind: 'per-seat', cents: 6900 } },
          ],
        },
        {
          id: 'rdstation',
          name: 'RD Station CRM',
          domain: 'rdstation.com',
          currency: 'BRL',
          sourceUrl: 'https://www.rdstation.com/planos/crm/',
          plans: [
            {
              name: 'Free',
              price: { kind: 'per-seat', cents: 0 },
              note: 'até 4 usuários',
            },
            { name: 'Basic', price: { kind: 'per-seat', cents: 6570 } },
            {
              name: 'Pro',
              price: { kind: 'per-seat', cents: 11790 },
              note: 'mínimo de 4 usuários',
            },
            { name: 'Advanced', price: { kind: 'quote' } },
          ],
        },
      ],
      features: [
        {
          label: 'Gestão de leads',
          steel: 'yes',
          competitors: {
            salesforce: 'yes',
            hubspot: 'yes',
            pipedrive: 'yes',
            rdstation: 'no-info',
          },
        },
        {
          label: 'Funil de oportunidades',
          steel: 'yes',
          competitors: {
            salesforce: 'yes',
            hubspot: 'yes',
            pipedrive: 'yes',
            rdstation: 'yes',
          },
        },
        {
          label: 'Propostas comerciais',
          steel: 'yes',
          competitors: {
            salesforce: 'plan',
            hubspot: 'plan',
            pipedrive: 'plan',
            rdstation: 'yes',
          },
        },
        {
          label: 'Campanhas de e-mail marketing',
          steel: 'yes',
          competitors: {
            salesforce: 'yes',
            hubspot: 'no-info',
            pipedrive: 'addon',
            rdstation: 'addon',
          },
        },
        {
          label: 'Formulários web',
          steel: 'yes',
          competitors: {
            salesforce: 'yes',
            hubspot: 'no-info',
            pipedrive: 'plan',
            rdstation: 'addon',
          },
        },
        {
          label: 'Landing pages',
          steel: 'yes',
          competitors: {
            salesforce: 'no-info',
            hubspot: 'no-info',
            pipedrive: 'no-info',
            rdstation: 'addon',
          },
        },
        {
          label: 'Automação de workflows',
          steel: 'yes',
          competitors: {
            salesforce: 'yes',
            hubspot: 'yes',
            pipedrive: 'plan',
            rdstation: 'yes',
          },
        },
        {
          label: 'Previsão de vendas',
          steel: 'yes',
          competitors: {
            salesforce: 'yes',
            hubspot: 'yes',
            pipedrive: 'plan',
            rdstation: 'yes',
          },
        },
        {
          label: 'Assistente de IA integrado',
          steel: 'yes',
          competitors: {
            salesforce: 'yes',
            hubspot: 'yes',
            pipedrive: 'yes',
            rdstation: 'yes',
          },
        },
      ],
      notes: [
        'HubSpot: a página mostra dois valores por plano conforme a forma de cobrança; os dois aparecem acima.',
        'RD Station CRM: e-mail marketing, formulários e landing pages são de outro produto (RD Station Marketing).',
      ],
    },
    {
      module: 'comunicacao',
      title: 'Steel vs Comunicação',
      competitors: [
        {
          id: 'zenvia',
          name: 'Zenvia',
          domain: 'zenvia.com',
          currency: 'BRL',
          sourceUrl: 'https://www.zenvia.com/precos/',
          plans: [
            {
              name: 'Specialist',
              price: { kind: 'flat', cents: 60000 },
              note: '+ ativação do WhatsApp a partir de R$ 649',
            },
          ],
        },
        {
          id: 'blip',
          name: 'Blip',
          domain: 'blip.ai',
          currency: 'BRL',
          sourceUrl: 'https://www.blip.ai/precos/',
          plans: [
            {
              name: 'Blip Go Essencial',
              price: { kind: 'flat', cents: 38900 },
            },
            { name: 'Enterprise', price: { kind: 'quote' } },
          ],
        },
        {
          id: 'octadesk',
          name: 'Octadesk',
          domain: 'octadesk.com',
          currency: 'BRL',
          sourceUrl: 'https://www.octadesk.com/precos',
          plans: [
            {
              name: 'One',
              price: { kind: 'flat', cents: 249900 },
              note: '3.000 contatos ativos por dia + onboarding sob consulta',
            },
          ],
        },
      ],
      features: [
        {
          label: 'API oficial do WhatsApp Business',
          steel: 'yes',
          competitors: { zenvia: 'no-info', blip: 'yes', octadesk: 'yes' },
        },
        {
          label: 'Caixa de atendimento compartilhada',
          steel: 'yes',
          competitors: { zenvia: 'no-info', blip: 'plan', octadesk: 'no-info' },
        },
        {
          label: 'Resposta automática por IA',
          steel: 'yes',
          competitors: { zenvia: 'yes', blip: 'yes', octadesk: 'yes' },
        },
        {
          label: 'Transmissões (envio em massa)',
          steel: 'yes',
          competitors: { zenvia: 'yes', blip: 'yes', octadesk: 'yes' },
        },
        {
          label: 'Templates de mensagem',
          steel: 'yes',
          competitors: { zenvia: 'yes', blip: 'no-info', octadesk: 'yes' },
        },
        {
          label: 'CRM incluído',
          steel: 'yes',
          competitors: { zenvia: 'plan', blip: 'no-info', octadesk: 'no-info' },
        },
        {
          label: 'ServiceDesk ITIL incluído',
          steel: 'yes',
          competitors: {
            zenvia: 'no-info',
            blip: 'no-info',
            octadesk: 'no-info',
          },
        },
      ],
      notes: [
        'Preços mensais por conta, não por usuário: o custo para uma equipe de 10 depende do volume contratado.',
        'Tarifas da Meta por conversa ou por template são cobradas à parte em todos os casos, inclusive no Steel.',
      ],
    },
  ],
}

// Validated at module load: a malformed entry fails the build.
export const COMPETITOR_COMPARISON = ComparisonCatalogSchema.parse(CATALOG)

# 0056 — Pix na conversa atrás de uma interface de PSP, só com provedor de teste

- **Status:** Aceita
- **Data:** 2026-10-29
- **Decisores:** Claude (com a autorização do dono do produto para decidir dentro da fatia Z1)

## Contexto

O roadmap pede cobrança Pix dentro da conversa do WhatsApp, com a baixa do
pagamento na conversa e na oportunidade do CRM. O provedor de pagamento (PSP)
que emite e liquida o Pix ainda não foi escolhido, e a escolha muda o contrato
de webhook, a autenticação e os custos.

## Decisão

- Tudo que depende do PSP fica atrás da interface `PixProvider`
  (`createCharge`, `cancelCharge`, `parseWebhook`) em `src/lib/pix/`. Os
  serviços nunca importam um provedor concreto: resolvem pelo
  `registry` (`PIX_PROVIDER`).
- Só existe o provedor **`mock`**, que gera um BR Code válido que nenhum banco
  liquida e aceita pagamento por webhook assinado (HMAC-SHA256) ou pela ação
  "Simular pagamento", restrita a OWNER/ADMIN e a provedores com `isTest`.
- O recurso fica **desligado por padrão** em cada workspace
  (`WhatsAppPixSettings.enabled`), para que ninguém cobre com um provedor de
  teste por engano.
- A cobrança é uma linha própria (`WhatsAppPixCharge`) identificada por
  `provider + providerChargeId`. O estado `EXPIRED` é derivado de `expiresAt`
  na leitura; não há job de expiração.
- A baixa é idempotente (`updateMany ... where status != PAID`) e também vale
  para cobranças vencidas ou canceladas, porque o dinheiro entrou.
- A IA cobra pela ação `SEND_PIX` das campanhas (ADR 0045): valor e descrição
  são fixados pelo administrador; a IA só decide se usa a ação.
- O webhook é público (`/api/whatsapp/webhook/pix/{provider}`, dentro do
  prefixo já público de webhooks do WhatsApp) e quem autentica é o provedor.
- Enviamos **duas mensagens** (resumo e código sozinho) para que o cliente
  copie o código com um toque.

## Consequências

- Trocar o `mock` por um PSP é implementar uma interface e registrá-la, sem
  mexer em serviços, rotas nem telas (passos em `docs/whatsapp-pix.md`).
- Enquanto só há o `mock`, ninguém recebe dinheiro de verdade; a tela de
  configurações e o diálogo de cobrança avisam isso.
- Sem confirmação automática ao cliente, aviso no inbox, estorno e
  conciliação: dependem do PSP e ficam para quando ele for escolhido.
- A tabela de cobranças cresce com o uso; a retenção não foi definida porque
  os registros são financeiros.

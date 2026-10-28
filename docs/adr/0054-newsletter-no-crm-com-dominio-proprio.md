# 0054 — Newsletter dentro do CRM, enviada do domínio do próprio cliente

- **Status:** Aceita
- **Data:** 2026-10-28
- **Decisores:** Alexandre (dono do produto), Claude

## Contexto

O CRM já tinha quase tudo de que uma newsletter precisa: editor visual de
e-mail (Steel Canvas, ADR 0026), marca do e-mail, descadastro LGPD com
um clique (RFC 8058), listas de e-mail, campanhas multicanal com webhook do
Resend (ADR 0025), formulários, landing pages e Sites com blog. Faltava o
conceito de **publicação**: uma newsletter com assinantes próprios,
confirmação de inscrição, edições numeradas, arquivo público e preferências
por assunto.

Pesquisa de mercado (28/10/2026): beehiiv, Kit, Substack e Ghost focam em
criador/mídia (indicação, anúncios, assinatura paga); HubSpot e RD Station
focam em empresa → cliente, com tipos de assinatura e central de
preferências. No HubSpot, a confirmação dupla vale para tudo de uma vez;
na RD Station, RSS → e-mail depende de conector de terceiros.

Hoje o Steel envia todo e-mail de marketing pelo domínio da Stratus. Com
volume de newsletter, isso põe a reputação de todos os clientes no mesmo
domínio e esbarra nas regras de remetente em massa do Gmail e do Yahoo
(SPF, DKIM, DMARC alinhados e descadastro com um clique).

## Decisão

1. **Newsletter institucional primeiro.** Uma empresa publica para os
   próprios clientes; várias newsletters por workspace, cada uma com
   assinantes próprios. O modelo de dados não fecha a porta para
   produto/mídia (indicação, assinatura paga), que fica para depois.
2. **Cada cliente envia do próprio domínio verificado.** O workspace
   cadastra o domínio (de preferência um subdomínio dedicado, como
   `news.empresa.com.br`) pela API de domínios do Resend, publica os
   registros DNS e só envia newsletter quando o domínio está `VERIFIED`.
   Abertura e clique são rastreados pelo Resend no domínio do cliente.
   O domínio é único na plataforma (o Resend aceita um por conta).
3. **Limite mensal por plano**, com ajuste por workspace feito pelo admin
   da plataforma (a cobrança está desligada, então o ajuste é o que vale na
   prática): FREE 3.000, PRO 30.000, BUSINESS 150.000 e-mails por mês;
   ENTERPRISE sem limite. Mês no fuso America/Sao_Paulo. Envios de teste
   não contam. O envio é **recusado antes de começar** se a audiência não
   cabe no saldo do mês (`CRM_NEWSLETTER_LIMIT_REACHED`, 402).
4. **Consentimento por newsletter.** Confirmação dupla configurável por
   newsletter (ligada por padrão) e central de preferências onde o leitor
   escolhe de quais newsletters quer sair. O descadastro global do workspace
   (`CrmEmailOptOut`) continua sendo "sair de tudo" e vale também para as
   campanhas. Guardamos prova do consentimento (data, IP, navegador, texto).
5. **Retorno de erro permanente** (hard bounce) desativa o endereço em todas
   as newsletters do workspace; **denúncia de spam** tira o leitor daquela
   newsletter.
6. **Permissões**: newsletter, edições e assinantes usam o recurso `email`
   do módulo CRM (as mesmas regras das campanhas). Domínios de envio:
   OWNER/ADMIN.

Detalhes do contrato em [docs/crm-newsletter/README.md](../crm-newsletter/README.md).

## Consequências

- Reputação de envio separada por cliente; um cliente com lista ruim não
  derruba a entrega dos outros.
- O cliente precisa mexer no DNS. A tela mostra os registros prontos para
  copiar e verifica sozinha; o suporte tem um runbook.
- As campanhas multicanal continuam saindo do endereço informado sem checar
  domínio. Passar a exigir domínio verificado nelas também é o próximo passo
  natural, em outra entrega.
- O webhook do Resend passa a atender campanhas e newsletter: procura a
  mensagem primeiro nas edições e depois nas campanhas.
- Fase 2 (resumo automático do blog, IA, segmentos do CRM, pontuação de lead
  por clique, versão WhatsApp, série de boas-vindas, enquete,
  reengajamento) e fase 3 (indicação, assinatura paga) reaproveitam este
  modelo: `segment` na edição já existe e está vazio.

# 0055 — Campanhas só enviam de domínio verificado ou do domínio da plataforma

- **Status:** Aceita
- **Data:** 2026-10-28
- **Decisores:** Claude (com a autorização do dono do produto para decidir dentro da fase 2 da newsletter)

## Contexto

O [ADR 0054](./0054-newsletter-no-crm-com-dominio-proprio.md) passou a exigir
domínio verificado para a newsletter e deixou registrado, nas consequências,
que as campanhas multicanal (ADR 0025) e as campanhas de e-mail antigas
continuavam saindo de qualquer endereço digitado. Isso mantém o problema que o
0054 resolveu para a newsletter: um remetente sem SPF/DKIM do cliente, que o
Gmail e o Yahoo tratam como não autenticado, e a reputação de todos os
clientes misturada.

## Decisão

O e-mail de uma campanha (multicanal ou antiga) só sai de:

1. um endereço em um domínio de envio **VERIFIED** do próprio workspace
   (mesma regra exata de domínio de `resolveVerifiedSender`); ou
2. qualquer endereço no **domínio da plataforma**, `stratustelecom.com.br`
   (`mailDomain` em `src/lib/mail/senders.ts`, verificado na conta Resend da
   Stratus), para quem ainda não tem domínio próprio. A comparação é exata:
   subdomínios (`news.stratustelecom.com.br`) não contam. Aceitar o domínio
   inteiro, e não só `notificacoes@`, evita quebrar campanhas que já estão em
   uso na homologação com clientes reais e saem de `vendas@`, `contato@` etc.

Onde a regra entra:

- **Assistente multicanal**: o remetente vira um item de "Antes de enviar"
  (`fix: SENDING_DOMAINS`) com link para Ajustes › Domínios de e-mail e
  bloqueia o lançamento.
- **Campanha de e-mail antiga**: o envio é recusado com
  `SENDING_DOMAIN_NOT_VERIFIED` antes de mudar a campanha.
- **Seletor de remetente** nos dois assistentes: parte local + lista com os
  domínios verificados do workspace e o domínio da plataforma
  ("stratustelecom.com.br (Steel)") (`GET /crm/email-senders`, só nomes de
  domínio, visível a quem vê e-mail no CRM).

## Consequências

- Complementa o 0054: a última frase de "Consequências" dele ("as campanhas
  multicanal continuam saindo do endereço informado sem checar domínio")
  deixa de valer.
- **Campanhas já agendadas** com outro remetente não são migradas. Só
  continuam funcionando se usam um endereço do domínio da plataforma; nas
  demais, a
  checagem acontece no disparo: na multicanal, cada e-mail vira falha com o
  motivo e o criador recebe um aviso (uma vez); na antiga, a campanha vira
  `FAILED` e o criador é avisado. O WhatsApp da campanha multicanal não é
  afetado.
- Domínio que perde a verificação depois do lançamento cai na mesma checagem
  do disparo.
- Quem não tem domínio verificado ainda envia pelo domínio da plataforma, que
  segue com a reputação de todos os clientes misturada; vale cadastrar o
  domínio próprio. Qualquer caixa `@stratustelecom.com.br` pode ser usada como
  remetente por um cliente — aceito para não quebrar o que já está em uso.
  Rever (restringir a uma lista de caixas ou tirar o domínio do seletor)
  quando o volume de campanhas por ele crescer.

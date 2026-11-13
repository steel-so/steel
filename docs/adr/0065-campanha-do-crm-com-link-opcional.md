# 0065 — Campanha do CRM com link opcional e conteúdo primeiro

- **Status:** Aceita
- **Data:** 2026-11-13
- **Decisores:** product owner (Stratus Telecom)

## Contexto

O assistente de campanhas do CRM (ADR 0025 e 0029) começava pelo **Destino**:
antes de escrever qualquer coisa, o cliente precisava escolher um site, um
formulário ou uma landing page, e o envio ficava bloqueado sem isso. Na Z-API,
o texto do WhatsApp também era obrigado a carregar `{link}`.

Para o cliente que só quer mandar um aviso ou uma promoção para a própria
lista, essa era a primeira barreira: uma decisão técnica, sobre algo que ele
muitas vezes nem tem. A base legal (LGPD) era pedida por canal e o remetente
era redigitado a cada campanha.

## Decisão

A campanha começa pelo **conteúdo**, e o **link é opcional**.

- Ordem dos passos: Conteúdo → Público → Link (opcional) → Revisar e enviar.
- Uma campanha sem destino pode ser enviada. O destino só é exigido quando o
  conteúdo aponta para o link da campanha: a variável `campaign_link` no
  template de e-mail, `{link}` no texto ou num botão da Z-API, ou uma variável
  de template da Meta mapeada para `link`/`link_code`. Nesse caso o envio fica
  bloqueado com um aviso que manda ao passo Link — um link rastreado sem
  destino levaria o contato a uma página de erro.
- Sem destino, a exigência de `{link}` no texto da Z-API deixa de valer. Com
  destino, nada muda (ADR 0025).
- Um rascunho novo herda o remetente e a base legal da campanha mais recente
  do workspace. A tela pede **uma** base legal, que vale para os dois canais;
  o servidor continua guardando uma por canal e a confirmação no envio
  continua obrigatória.
- Pré-cabeçalho, `utm_medium` e janela de envio ficam em "Opções avançadas".
- Onde falta um site, um formulário, um template de e-mail ou um template da
  Meta, a tela explica o que é e traz o botão que leva à criação.

## Consequências

- O caminho mais comum (e-mail para uma lista) pede assunto, visual e público.
- Campanhas sem link não têm cliques nem conversões: o painel mostra só
  entrega e abertura. É o esperado, não um erro.
- A detecção de uso do link no e-mail é textual (procura a variável no HTML e
  no documento do construtor). Um falso positivo só pede um destino a mais;
  não há falso negativo conhecido.
- Herdar a base legal é uma conveniência: quem lança continua responsável por
  conferir e confirmar. Se isso gerar confirmação "no automático", voltar a
  pedir a escolha a cada campanha.
- Enviar só por WhatsApp (sem e-mail) continua fora: exige um campo novo na
  campanha e mudanças no envio. Fica para uma próxima decisão.

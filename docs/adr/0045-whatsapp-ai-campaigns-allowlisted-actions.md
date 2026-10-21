# 0045 — Campanhas de IA agem só por ações liberadas pelo administrador

- **Status:** Aceita
- **Data:** 2026-10-21
- **Decisores:** produto (Stratus Telecom) e engenharia

## Contexto

O módulo de Comunicação ganhou as **Campanhas de IA**: a campanha envia um
template aprovado da Meta para um grupo de contatos (com as variáveis
preenchidas por valor fixo, campo do contato ou coluna de planilha) e, quando o
contato responde, a IA conversa seguindo as instruções da campanha. O pedido
era que, "com base no retorno", a IA também **fizesse coisas**: transferir para
um humano, fechar com a classificação certa, descadastrar, avisar outro
sistema.

Dar à IA acesso livre (SQL, rotas da API, URLs que ela escolhe) resolveria
qualquer caso, mas um texto do próprio contato poderia induzir a IA a agir fora
do combinado (prompt injection — ver [ADR 0041](./0041-ai-guardrails-pii-injection-auto-reply-limits.md)),
e não haveria como auditar nem limitar o efeito.

A campanha substitui o "Disparo automático" da página de Contatos; a migração
copia cada disparo para uma campanha com o mesmo id.

## Decisão

A IA da campanha só age por **ações liberadas**, configuradas pelo
administrador na própria campanha. Cada ação tem um tipo fixo, um nome, a regra
de "quando usar" escrita em português e **um destino escolhido pelo
administrador** — a IA decide apenas *se* e *quando* usar.

- Tipos: transferir para um atendente, transferir para uma equipe, fechar com
  um dos status de fechamento escolhidos, descadastrar (LGPD), anotar no
  contato, retomar a conversa depois de N horas (1–168), disparar um workflow
  do CRM e chamar um webhook HTTPS com campos nomeados (assinado com HMAC,
  com bloqueio de rede interna).
- Cada ação vira uma ferramenta própria (`acao_campanha_N`) na chamada ao
  modelo. As escolhidas rodam **depois** que a resposta foi enviada, no máximo
  três por resposta e só uma terminal (transferir ou fechar). Se a proteção da
  resposta automática barrar o texto, nenhuma ação roda.
- Toda execução fica registrada (`whatsapp_ai_campaign_action_runs`), vira um
  evento `AI_ACTION` na conversa e entra na auditoria. A tela da campanha
  mostra o histórico com o motivo dado pela IA.
- O envio respeita o horário de atendimento e o intervalo da campanha (20–60s,
  um job encadeado por vez com `runToken`); permissão é a mesma de
  Transmissões (`broadcasts`).

## Consequências

- Atende vários tipos de empresa (cobrança, clínica, vendas, pesquisa,
  reativação) com modelos prontos, sem a IA tocar em dado fora do previsto.
- O efeito de uma resposta maliciosa fica limitado ao que o administrador já
  liberou para aquela campanha, e tudo é rastreável.
- Caso novo (ex.: criar oportunidade, agendar em calendário externo) pede um
  tipo de ação novo no código — ou usar o workflow do CRM/webhook como saída.
- Revisitar se os clientes passarem a precisar de ações com parâmetros livres
  além dos campos do webhook.

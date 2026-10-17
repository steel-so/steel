# Steel MCP — envio aos diretórios de conectores

Tudo o que é pedido para listar o servidor MCP do Steel no **diretório de
conectores do Claude** (Anthropic) e no **diretório de apps do ChatGPT**
(OpenAI), em forma de checklist. O envio **espera a produção**: os
diretórios testam a URL pública, a conta de teste e as páginas legais no
domínio definitivo, não em homologação.

Contrato técnico do servidor: [README.md](README.md). Guia público:
`/dev/mcp`. Manual do usuário: `/docs/steel-ai/conectar-claude-chatgpt-cursor`.

> Os formulários dos dois diretórios mudam com frequência. Antes de enviar,
> confira os requisitos atuais na página de envio de cada um e atualize este
> arquivo com o que mudou.

## 1. Checklist

### Antes de enviar (bloqueios)

- [ ] Onda MCP inteira em produção: `mcp-auth`, `mcp-server`,
      `mcp-governance`, `mcp-workspace-apps`, `mcp-observability`.
- [ ] `secrets/production.enc.env` criado e `BETTER_AUTH_URL` apontando para o
      domínio de produção (é dele que saem o emissor OAuth, o `resource` e os
      links absolutos das ferramentas).
- [ ] Proxy de borda de produção sem buffering em `/api/mcp`
      ([runbook](../runbooks/mcp-edge-proxy.md)).
- [ ] `pnpm mcp:smoke --oauth` passando contra produção (seção 8).
- [ ] Conta de revisão criada em produção (seção 7).
- [ ] Conector testado à mão no Claude (web), no ChatGPT (modo
      desenvolvedor) e no Cursor, com a conta de revisão.
- [ ] Páginas legais revisadas pelo jurídico com o texto de MCP (seção 6).

### Claude (Anthropic)

- [ ] Nome, descrições e ícone (seções 2 e 3).
- [ ] URL do servidor e transporte Streamable HTTP (seção 4).
- [ ] OAuth com registro dinâmico de cliente; callback do Claude aceito
      (seção 5).
- [ ] Toda ferramenta com `title` e as anotações `readOnlyHint` e
      `destructiveHint` (o adaptador sempre manda as quatro dicas).
- [ ] Títulos das ferramentas revisados para o diretório: hoje o `title` é o
      `label` da Steel AI, no gerúndio ("Consultando chamados"), pensado para
      o indicador de progresso do chat. Nos diretórios ele aparece como nome
      da ferramenta; avaliar um `title` próprio para o MCP ("Buscar
      chamados") antes do envio.
- [ ] Política de privacidade, termos, documentação e contato de suporte
      (seção 4).
- [ ] Conta de teste com dados de exemplo e instruções (seção 7).
- [ ] Exemplos de uso (três prompts, seção 2).

### ChatGPT (OpenAI)

- [ ] Organização verificada na plataforma da OpenAI, com a Stratus Telecom
      como responsável pelo app.
- [ ] Nome, descrições, ícone e categoria (seções 2 e 3).
- [ ] URL do servidor MCP e OAuth (seções 4 e 5); callback do ChatGPT aceito.
- [ ] Anotações das ferramentas conferidas: leitura com `readOnlyHint`,
      escrita com `destructiveHint`/`openWorldHint` corretos.
- [ ] Política de privacidade, termos e suporte (seção 4).
- [ ] Credenciais de teste e roteiro de revisão (seção 7).
- [ ] Declaração de dados (seção 6) e países de disponibilidade.

## 2. Nome e descrições

| Campo | Valor |
| --- | --- |
| Nome | Steel |
| Empresa | Stratus Telecom |
| Categoria | Produtividade / Negócios (atendimento, CRM) |
| Idiomas | Português (Brasil); as ferramentas respondem em pt-BR |
| Disponibilidade | Clientes do Steel, em todos os planos; sem custo adicional |

**Descrição curta (pt-BR, até 80 caracteres):**
ServiceDesk, CRM e WhatsApp do seu workspace Steel dentro do assistente.

**Short description (en):**
Your Steel workspace — ServiceDesk, CRM and WhatsApp — inside your assistant.

**Descrição longa (pt-BR):**

> Conecte o seu workspace do Steel e consulte chamados, CRM e conversas do
> WhatsApp sem sair do assistente. Pergunte quais chamados estão para estourar
> o SLA, peça o resumo do pipeline da semana ou a lista de conversas sem
> resposta. O assistente age com o seu usuário e as suas permissões, só no
> workspace e nos módulos que você escolher na autorização. Com a escrita
> liberada pelo administrador, ele também cria leads, atualiza chamados e
> registra notas; nada é excluído, e mensagens a clientes só saem depois de
> confirmadas no Steel. Você revoga o acesso quando quiser.

**Long description (en):**

> Connect your Steel workspace and work with tickets, CRM and WhatsApp
> conversations without leaving your assistant. Ask which tickets are about
> to breach their SLA, get this week's pipeline summary or the list of
> unanswered conversations. The assistant acts as you, with your permissions,
> limited to the workspace and modules you pick on the consent screen. When a
> workspace admin enables writes, it can also create leads, update tickets and
> add notes; nothing is ever deleted, and messages to customers are only sent
> after someone confirms them in Steel. Revoke access at any time.

**Exemplos de uso (pt-BR / en):**

1. "Quais chamados estão com o SLA em risco hoje?" / "Which tickets are at
   risk of breaching their SLA today?"
2. "Resuma o pipeline do CRM desta semana por etapa." / "Summarize this
   week's CRM pipeline by stage."
3. "Quais conversas do WhatsApp estão sem resposta há mais de uma hora?" /
   "Which WhatsApp conversations have gone unanswered for over an hour?"

## 3. Ícone

| Arquivo | Uso |
| --- | --- |
| `public/brand/mcp-icon.svg` | vetor, 512×512, fundo `#0b0b0c` e a marca em `#F1F0EB` |
| `public/brand/mcp-icon.png` | PNG 512×512, o mesmo desenho |

Quadrado, sem texto e com a marca centralizada com margem, para sobreviver ao
recorte redondo ou arredondado que cada diretório aplica. Se um formulário
pedir outro tamanho, gere a partir do SVG (não amplie o PNG). O mesmo ícone
pode ir no campo de logo do cliente OAuth, se o diretório pedir.

## 4. Endereços

`<domínio>` = domínio de produção (`steel.stratustelecom.com.br`, quando
ativo). Confira cada link aberto, sem login, antes de enviar.

| Item | URL |
| --- | --- |
| Servidor MCP | `https://<domínio>/api/mcp` (Streamable HTTP, `POST`, sem estado) |
| Documentação técnica | `https://<domínio>/dev/mcp` |
| Manual do usuário | `https://<domínio>/docs/steel-ai/conectar-claude-chatgpt-cursor` |
| Política de privacidade | `https://<domínio>/legals/privacy` |
| Termos de uso | `https://<domínio>/legals/terms` |
| Segurança | `https://<domínio>/legals/security` |
| Suboperadores | `https://<domínio>/legals/subprocessors` |
| Status | `https://<domínio>/status` |
| Site | `https://<domínio>/` |
| Suporte | `suporte@stratustelecom.com.br` (também em `/dev/suporte`) |
| Privacidade / Encarregado (DPO) | os contatos da seção 12 da política de privacidade |

## 5. OAuth

| Item | Valor |
| --- | --- |
| Descoberta do recurso | `https://<domínio>/.well-known/oauth-protected-resource` (RFC 9728) |
| Emissor | `https://<domínio>/api/auth` |
| Metadados do servidor | `https://<domínio>/.well-known/oauth-authorization-server` (RFC 8414) |
| Fluxo | código de autorização com PKCE `S256` (OAuth 2.1) |
| Registro de cliente | dinâmico (RFC 7591) em `/api/auth/oauth2/register`, sem autenticação; cliente público (`token_endpoint_auth_method: none`) |
| Escopos | `mcp:read`, `mcp:write`, `offline_access` |
| `resource` | `https://<domínio>/api/mcp` (RFC 8707) |
| Tokens | opacos, prefixos `stl_at_` / `stl_rt_`; access 1 h; refresh 30 dias, com `offline_access` |
| Revogação | pelo usuário em **Configurações › Segurança › Apps conectados**, pelo admin nos ajustes do workspace, ou `/api/auth/oauth2/revoke` |
| Consentimento | sempre explícito, na tela `/oauth/consent` (workspace, módulos e escopo); não há aprovação automática |

Callbacks: com registro dinâmico, cada cliente informa o próprio
`redirect_uri` e o Steel não mantém lista fixa. Se um diretório pedir um
cliente pré-registrado (client ID e secret), registre com o callback que o
formulário indicar — hoje, `https://claude.ai/api/mcp/auth_callback` no
Claude e `https://chatgpt.com/connector_platform_oauth_redirect` no ChatGPT
(confira no formulário) — e guarde o secret no SOPS, nunca no repositório.

## 6. Dados e LGPD

**Declaração (pt-BR):**

> O conector do Steel lê e, quando autorizado, altera dados do workspace que o
> usuário escolheu, com as permissões dele: chamados, contatos, empresas e
> conversas, que podem conter dados pessoais de clientes do nosso cliente. A
> Stratus Telecom é operadora desses dados (LGPD, art. 5º, VII); o
> controlador é a empresa dona do workspace. O conteúdo devolvido pelas
> ferramentas é enviado ao provedor do assistente que o usuário conectou e
> passa a seguir a política desse provedor. O Steel não usa o conteúdo para
> treinar modelos, não vende dados e não guarda os argumentos nem as respostas
> das chamadas MCP nos logs: registra só ferramenta, módulo, cliente, duração
> e resultado. Consentimento, revogação e cada alteração ficam na trilha de
> auditoria. Nada é excluído pelo conector, e ações que chegam a um cliente
> final exigem confirmação humana no Steel. O acesso pode ser revogado a
> qualquer momento pelo usuário ou pelo administrador do workspace, e cai
> sozinho quando o usuário deixa o workspace.

**Statement (en):**

> The Steel connector reads and, when authorized, changes data in the
> workspace the user picked, with that user's permissions: tickets, contacts,
> companies and conversations, which may include personal data of our
> customer's own customers. Stratus Telecom acts as processor under Brazil's
> LGPD; the workspace owner is the controller. Content returned by tools is
> sent to the provider of the assistant the user connected and is then
> governed by that provider's policy. Steel does not train models on it,
> does not sell data, and does not log MCP call arguments or results — only
> the tool, module, client, duration and outcome. Consent, revocation and
> every write are recorded in the audit trail. Nothing is deleted through the
> connector, and actions that reach an end customer require human
> confirmation in Steel. Access can be revoked at any time by the user or a
> workspace admin, and ends automatically when the user leaves the workspace.

Revisão jurídica antes do envio:

- [ ] A política de privacidade cita conectores de IA de terceiros (o
      provedor do assistente como destinatário escolhido pelo usuário).
- [ ] A página de suboperadores deixa claro que o provedor do assistente
      **não** é suboperador do Steel: é contratado pelo próprio cliente.
- [ ] Os termos cobrem o uso por assistentes externos com o usuário do
      cliente.

## 7. Conta de revisão

Os revisores dos diretórios conectam com uma conta nossa e precisam de dados
para testar. Em **produção**:

1. Crie o usuário `revisao.mcp@stratustelecom.com.br` (senha forte, guardada
   no cofre da equipe; **sem** segundo fator — os revisores não recebem o
   e-mail do código). Aceite os termos e verifique o e-mail.
2. Crie o workspace **Revisão MCP** com ServiceDesk, CRM e Comunicação
   habilitados e a Steel IA ligada (**Ajustes › Steel IA**). Ligue
   **Permitir escrita via MCP** para que os revisores vejam as ferramentas de
   escrita.
3. Carregue dados fictícios: uns 15 chamados em fases e prioridades
   diferentes (alguns com SLA em risco), 3 artigos publicados na base de
   conhecimento, uma página na Wiki, um pipeline com 10 oportunidades e 10
   leads, e contatos de WhatsApp fictícios. Não conecte número de WhatsApp
   real: as mensagens a clientes ficam como pendentes de confirmação, que é o
   comportamento esperado.
4. Envie aos diretórios:
   - URL do servidor, e-mail e senha da conta;
   - "Na tela de autorização, escolha o workspace **Revisão MCP**, os três
     módulos e **consultar e alterar**";
   - os três exemplos de uso da seção 2;
   - "Exclusões não estão disponíveis; mensagens a clientes devolvem um link
     de confirmação no Steel, por desenho".
5. Depois da revisão, troque a senha. Revogue as conexões da conta em **Apps
   conectados** se o diretório não precisar mais delas.

## 8. Smoke antes do envio

```bash
MCP_SMOKE_URL=https://<domínio> \
MCP_SMOKE_EMAIL=revisao.mcp@stratustelecom.com.br \
MCP_SMOKE_PASSWORD=... \
MCP_SMOKE_WORKSPACE_ID=<id do workspace Revisão MCP> \
MCP_SMOKE_SCOPES=mcp:read,mcp:write \
pnpm mcp:smoke --oauth
```

Faz o registro dinâmico, o login, o consentimento e a troca do código como um
cliente real, roda `initialize`, `tools/list`, três ferramentas de leitura,
`resources/list` e `prompts/list`, e revoga a concessão no fim. Todas as
linhas precisam sair `PASS`. Com um token em mãos, `MCP_SMOKE_TOKEN=...
pnpm mcp:smoke` pula a parte de OAuth. `pnpm mcp:smoke --help` lista as
opções.

## 9. Ferramentas

Retrato do registro da Steel AI em 17/10/2026 (98 ferramentas: 44 de leitura,
44 de escrita e 10 de exclusão). A lista viva fica em `/dev/mcp`, gerada a
cada deploy; regere esta tabela antes de enviar.

- **Leitura:** expostas com `mcp:read`.
- **Escrita** (criar, editar, ação): expostas só com `mcp:write` **e**
  **Permitir escrita via MCP** ligado no workspace.
- **Exclusão:** nunca expostas.
- **Confirmação humana:** ferramentas `customerFacing`; pelo MCP elas criam
  uma ação pendente e devolvem o link para confirmar no Steel.
- O que cada usuário recebe ainda passa pelos módulos concedidos e pelo papel
  dele no workspace.

**Workspace**

| Ferramenta | Rótulo | Tipo | Exposta no MCP | Observação |
| --- | --- | --- | --- | --- |
| `ws_overview` | Consultando o workspace | leitura | sim |  |
| `ws_members` | Consultando membros | leitura | sim |  |
| `ws_notifications` | Consultando sua caixa de entrada | leitura | sim |  |
| `ws_search` | Buscando no workspace | leitura | sim |  |
| `ws_ai_usage` | Consultando o consumo de IA | leitura | sim |  |
| `ws_invitations` | Consultando convites pendentes | leitura | sim |  |
| `steel_get_skill` | Abrindo skill | leitura | sim |  |

**ServiceDesk**

| Ferramenta | Rótulo | Tipo | Exposta no MCP | Observação |
| --- | --- | --- | --- | --- |
| `sd_search_tickets` | Consultando chamados | leitura | sim |  |
| `sd_get_ticket` | Abrindo o chamado | leitura | sim |  |
| `sd_my_queue` | Consultando sua fila | leitura | sim |  |
| `sd_sla_at_risk` | Consultando SLA em risco | leitura | sim |  |
| `sd_ticket_counts` | Calculando indicadores | leitura | sim |  |
| `sd_catalog` | Consultando o catálogo de serviços | leitura | sim |  |
| `sd_search_config_items` | Consultando a CMDB | leitura | sim |  |
| `sd_get_config_item` | Abrindo item de configuração | leitura | sim |  |
| `sd_search_customers` | Consultando clientes e empresas | leitura | sim |  |
| `sd_search_contacts` | Consultando contatos | leitura | sim |  |
| `sd_search_kb` | Buscando na base de conhecimento | leitura | sim |  |
| `sd_get_kb_article` | Lendo artigo da base | leitura | sim |  |
| `sd_create_kb_draft_from_ticket` | Criando rascunho de artigo | escrita (criar) | com `mcp:write` |  |
| `sd_delete_kb_draft` | Descartando rascunho | exclusão | não |  |
| `sd_create_ticket` | Abrindo chamado | escrita (criar) | com `mcp:write` |  |
| `sd_update_ticket` | Atualizando chamado | escrita (editar) | com `mcp:write` | destrutiva |
| `sd_assign_ticket` | Atribuindo chamado | escrita (editar) | com `mcp:write` |  |
| `sd_move_ticket_phase` | Mudando a fase do chamado | escrita (editar) | com `mcp:write` | confirmação humana no Steel |
| `sd_cancel_ticket` | Cancelando chamado | escrita (ação) | com `mcp:write` | confirmação humana no Steel, destrutiva |
| `sd_add_internal_note` | Registrando nota interna | escrita (criar) | com `mcp:write` |  |
| `sd_reply_to_requester` | Respondendo ao solicitante | escrita (ação) | com `mcp:write` | confirmação humana no Steel |
| `sd_create_ticket_task` | Criando tarefa do chamado | escrita (criar) | com `mcp:write` |  |
| `sd_complete_ticket_task` | Concluindo tarefa | escrita (editar) | com `mcp:write` |  |
| `sd_delete_ticket_task` | Excluindo tarefa | exclusão | não |  |
| `sd_request_approval` | Pedindo aprovação | escrita (ação) | com `mcp:write` | confirmação humana no Steel |
| `sd_link_kb_article` | Vinculando artigo da base | escrita (criar) | com `mcp:write` |  |
| `sd_link_config_item` | Vinculando item de configuração | escrita (editar) | com `mcp:write` |  |

**CRM**

| Ferramenta | Rótulo | Tipo | Exposta no MCP | Observação |
| --- | --- | --- | --- | --- |
| `crm_list_pipelines` | Consultando pipelines | leitura | sim |  |
| `crm_list_proposals` | Consultando propostas | leitura | sim |  |
| `crm_get_forecast` | Consultando previsão de receita | leitura | sim |  |
| `crm_get_record` | Consultando registro | leitura | sim |  |
| `crm_get_record_timeline` | Consultando histórico do registro | leitura | sim |  |
| `crm_list_leads` | Consultando leads | leitura | sim |  |
| `crm_create_lead` | Criando lead | escrita (criar) | com `mcp:write` |  |
| `crm_update_lead` | Atualizando lead | escrita (editar) | com `mcp:write` | destrutiva |
| `crm_delete_lead` | Excluindo lead | exclusão | não |  |
| `crm_close_lead_won` | Fechando lead como ganho | escrita (ação) | com `mcp:write` | destrutiva |
| `crm_close_lead_lost` | Fechando lead como perdido | escrita (ação) | com `mcp:write` |  |
| `crm_reopen_lead` | Reabrindo lead | escrita (ação) | com `mcp:write` |  |
| `crm_list_opportunities` | Consultando oportunidades | leitura | sim |  |
| `crm_create_opportunity` | Criando oportunidade | escrita (criar) | com `mcp:write` |  |
| `crm_update_opportunity` | Atualizando oportunidade | escrita (editar) | com `mcp:write` | destrutiva |
| `crm_move_opportunity_stage` | Movendo oportunidade de etapa | escrita (ação) | com `mcp:write` |  |
| `crm_delete_opportunity` | Excluindo oportunidade | exclusão | não |  |
| `crm_list_people` | Consultando pessoas | leitura | sim |  |
| `crm_create_person` | Criando pessoa | escrita (criar) | com `mcp:write` |  |
| `crm_update_person` | Atualizando pessoa | escrita (editar) | com `mcp:write` | destrutiva |
| `crm_delete_person` | Excluindo pessoa | exclusão | não |  |
| `crm_list_companies` | Consultando empresas | leitura | sim |  |
| `crm_create_company` | Criando empresa | escrita (criar) | com `mcp:write` |  |
| `crm_update_company` | Atualizando empresa | escrita (editar) | com `mcp:write` | destrutiva |
| `crm_delete_company` | Excluindo empresa | exclusão | não |  |
| `crm_list_tasks` | Consultando tarefas | leitura | sim |  |
| `crm_create_task` | Criando tarefa | escrita (criar) | com `mcp:write` |  |
| `crm_update_task` | Atualizando tarefa | escrita (editar) | com `mcp:write` | destrutiva |
| `crm_delete_task` | Excluindo tarefa | exclusão | não |  |
| `crm_create_note` | Criando nota | escrita (criar) | com `mcp:write` |  |
| `crm_update_note` | Atualizando nota | escrita (editar) | com `mcp:write` | destrutiva |
| `crm_delete_note` | Excluindo nota | exclusão | não |  |
| `crm_assign_owner` | Atribuindo responsável | escrita (ação) | com `mcp:write` |  |
| `crm_list_competitors` | Consultando concorrentes | leitura | sim |  |
| `crm_get_competitor_growth` | Comparando crescimento do concorrente | leitura | sim |  |
| `crm_get_trending_posts` | Consultando posts em alta | leitura | sim |  |
| `crm_create_dashboard` | Criando dashboard | escrita (criar) | com `mcp:write` |  |
| `crm_create_form` | Criando formulário | escrita (criar) | com `mcp:write` |  |
| `crm_create_proposal_template` | Criando modelo de proposta | escrita (criar) | com `mcp:write` |  |

**Comunicação**

| Ferramenta | Rótulo | Tipo | Exposta no MCP | Observação |
| --- | --- | --- | --- | --- |
| `zap_conversations_list` | Consultando conversas do WhatsApp | leitura | sim |  |
| `zap_conversation_get` | Abrindo conversa do WhatsApp | leitura | sim |  |
| `zap_conversation_summary_context` | Lendo a conversa para resumir | leitura | sim |  |
| `zap_contacts_search` | Buscando contatos do WhatsApp | leitura | sim |  |
| `zap_contact_get` | Abrindo contato do WhatsApp | leitura | sim |  |
| `zap_groups_list` | Consultando grupos do WhatsApp | leitura | sim |  |
| `zap_templates_list` | Consultando modelos de mensagem | leitura | sim |  |
| `zap_quick_replies_list` | Consultando mensagens rápidas | leitura | sim |  |
| `zap_broadcasts_list` | Consultando transmissões | leitura | sim |  |
| `zap_broadcast_get` | Abrindo transmissão | leitura | sim |  |
| `zap_connections_status` | Verificando conexões do WhatsApp | leitura | sim |  |
| `zap_dashboard` | Calculando indicadores do WhatsApp | leitura | sim |  |
| `zap_conversation_assign` | Atribuindo conversa | escrita (editar) | com `mcp:write` |  |
| `zap_conversation_unassign` | Removendo responsável da conversa | escrita (editar) | com `mcp:write` |  |
| `zap_conversation_close` | Encerrando conversa | escrita (editar) | com `mcp:write` |  |
| `zap_conversation_reopen` | Reabrindo conversa | escrita (editar) | com `mcp:write` |  |
| `zap_conversation_set_ai` | Alterando a resposta automática da IA | escrita (editar) | com `mcp:write` |  |
| `zap_contact_create` | Criando contato do WhatsApp | escrita (criar) | com `mcp:write` |  |
| `zap_contact_update` | Atualizando contato do WhatsApp | escrita (editar) | com `mcp:write` | destrutiva |
| `zap_contact_delete` | Excluindo contato do WhatsApp | exclusão | não |  |
| `zap_quick_reply_create` | Criando mensagem rápida | escrita (criar) | com `mcp:write` |  |
| `zap_quick_reply_update` | Atualizando mensagem rápida | escrita (editar) | com `mcp:write` | destrutiva |
| `zap_quick_reply_delete` | Excluindo mensagem rápida | exclusão | não |  |
| `zap_broadcast_create_draft` | Criando rascunho de transmissão | escrita (criar) | com `mcp:write` |  |
| `zap_message_send_text` | Enviando mensagem no WhatsApp | escrita (ação) | com `mcp:write` | confirmação humana no Steel |

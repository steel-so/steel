# 0069 — Linha Z-API da plataforma, gerida no admin, para validar números de qualquer workspace

- **Status:** Aceita
- **Data:** 2026-11-18
- **Decisores:** product owner

## Contexto

A validação "tem WhatsApp?" (`WhatsAppNumberValidation`, `hasWhatsapp` em
`WhatsAppContact`, `skipNoWhatsapp` em transmissões e campanhas de IA, status
`SKIPPED_NO_WHATSAPP`) usa o endpoint `phone-exists` da Z-API. A Meta Cloud API
não tem equivalente, então só workspaces com conexão Z-API própria conseguiam
validar a base.

Em produção, um número Meta (Fidelizza+) teve de 30% a 40% dos envios de
marketing falhando com os erros 131026 (não entregável) e 131049, o que leva a
qualidade do número a RED. Validar a base antes de enviar é a correção, e ela
precisa estar disponível justamente para quem só usa Meta.

O product owner decidiu que "Validar números" é uma **funcionalidade global**: o
número Z-API fica no **admin**, só **admins da plataforma** o conectam (leitura do
QR Code) e **todos os workspaces usam essa mesma conexão** para checar números.

## Decisão

Uma única **linha de verificação** (instância Z-API) é cadastrada e conectada no
painel admin e responde a validação de qualquer workspace, "por baixo dos panos".

- **Onde mora:** tabela `platform_zapi_lines`, uma linha só (id fixo `default`):
  ID da instância, token e Client-Token **criptografados** com `CONNECTION_SECRETS`
  (`encryptConnectionSecret`), nome, número pareado, status
  (`DISCONNECTED`, `AWAITING_QR`, `CONNECTED`, `ERROR`), erro, `connectedAt`,
  `statusCheckedAt` e quem alterou por último. Não usa `WhatsAppConnection`, que é
  por workspace. **Não há variáveis de ambiente** (`ZAPI_VALIDATION_*` nunca
  chegaram à main): trocar de número ou de credenciais é uma ação do admin, sem
  deploy nem edição de `secrets/*.enc.env`.
- **Quem opera:** só admin da plataforma (`assertPlatformAdmin`), em
  `/admin/zapi-line` ("Linha de verificação"), na seção Comunicação do admin. O
  fluxo: salvar as credenciais copiadas do painel da Z-API, ler o QR Code com o
  WhatsApp do celular da linha (a tela consulta o status a cada poucos segundos e
  mostra o número quando conecta) e acompanhar o estado. Há "Reconectar"
  (reinicia a sessão), "Desconectar" (desvincula o celular), "Substituir
  credenciais" e "Remover", as três últimas com motivo na trilha de auditoria. As
  rotas ficam em `app/api/admin/zapi-line/**`; nenhuma devolve token, só o ID da
  instância mascarado e o estado. Quando a linha não está conectada, a tela mostra
  um aviso vermelho.
- **Origem única** (`resolveValidationSource`, usada pelas rotas, pela execução
  inline e pelo worker): sempre a linha da plataforma. A regra anterior, "a
  conexão Z-API própria do workspace primeiro", foi **removida**: conexões de
  mensagens do workspace seguem como estão, mas não são mais usadas na consulta, e
  o `connectionId` do corpo da requisição é ignorado. A execução grava
  `connectionId = 'platform'` na validação (a coluna é obrigatória e não há linha
  de conexão; mantida para não alterar a tabela).
- **Disponibilidade:** `GET /api/workspaces/{id}/whatsapp/number-validation/availability`
  devolve `{ available, source: 'PLATFORM' | null }`, igual para todos os
  workspaces. `available` só é verdadeiro com a linha configurada e `CONNECTED`. O
  estado salvo vale por 5 minutos quando conectada e por 1 minuto quando não (a
  linha pode ter voltado); depois disso a própria consulta pergunta à Z-API
  (`/status`) e regrava. Sem linha conectada, o usuário do workspace lê: "A linha
  de verificação da plataforma está desconectada; peça a um administrador da
  plataforma para reconectar."
- **Linha que cai no meio de uma execução:** ao começar, a execução confirma o
  status na Z-API; se a linha não está conectada, a validação termina `FAILED` sem
  tocar em nenhum contato. Entre um lote e o seguinte (o primeiro já foi
  confirmado) ela confirma de novo; se o celular foi desvinculado, os lotes que
  restam são pulados e viram "não checado" (`failed`), **nunca** "sem WhatsApp", a
  linha é gravada como `DISCONNECTED` e a validação termina limpa (`DONE` com o que
  foi respondido e a mensagem no `errorMessage`, ou `FAILED` se nada foi
  respondido), sem nova tentativa: reconectar é ação de um admin. Falha de rede
  da própria consulta de status não conta como "linha perdida"; o lote é que falha
  e segue a regra de novas tentativas.
- **Proteção da linha compartilhada** (Redis, valendo para todos os workspaces e
  todos os processos): no máximo 2 validações simultâneas (lease por slot) e um
  orçamento global de 3.000 números por minuto, consumido antes de cada lote. Se o
  orçamento não libera a tempo, o lote vira "não checado". Falha do Redis abre o
  limite (fail open).
- **Cache e resiliência:** contatos checados dentro do TTL do workspace (padrão 30
  dias) não são consultados de novo, salvo `force`. Falha ou timeout da Z-API deixa
  o item como "não checado" (`failed`), **nunca** como "sem WhatsApp". O job tenta
  de novo até 5 vezes com backoff exponencial (30 s); a execução zera os contadores
  ao recomeçar e os contatos já checados voltam como cache, então a repetição não
  conta duas vezes. Linha ocupada adia o job sem tocar no estado.
- **Nono dígito:** o lookup usa o número como está salvo e a resposta só grava
  `hasWhatsapp` e o LID; o `waId` do contato nunca é reescrito (o `outputPhone` da
  Z-API é ignorado). O envio por `skipNoWhatsapp` só olha `hasWhatsapp === false`,
  então vale igual para quem foi checado pela plataforma.
- **Privacidade e auditoria:** telefones não vão para log (só máscara `5511****`);
  só o número é enviado à Z-API, nunca o nome. Quem iniciou a validação fica em
  `auditMutation` (`source: PLATFORM`); cada ação do admin na linha (configurar,
  substituir credenciais, reiniciar, desconectar, remover) vai para o Axiom e para
  `admin_audit_logs` (`zapi_line.*`), sem nenhum segredo no payload.
- **Plano:** como hoje, validar não consome limite do plano (não envia mensagem);
  cada validação fica registrada por workspace.

## Consequências

- Workspaces só com Meta passam a validar a base e a usar "pular sem WhatsApp".
- **Risco aberto:** uma única linha Z-API atende todos os clientes. Consultas
  em volume podem levar a limite de taxa ou banimento do número pelo WhatsApp, e
  um banimento derruba a validação de todos. Recomendação: usar um número
  **dedicado**, que só faz consultas e não conversa com ninguém, e acompanhar a
  taxa de `failed` nas validações da plataforma.
- **Ponto único de falha operacional:** enquanto a linha estiver desconectada
  ninguém valida. O aviso na tela do admin e a mensagem aos workspaces existem para
  isso, mas não há alerta ativo (e-mail, Slack) para o admin quando a linha cai;
  seria um próximo passo. O estado só é percebido quando alguém abre a tela, usa a
  validação ou uma execução tenta rodar.
- As credenciais ficam no banco (criptografadas com a mesma chave das conexões):
  quem tem a `CONNECTION_SECRETS` e o banco as lê, como já acontece com as
  conexões dos workspaces e o backup é criptografado pela mesma chave.
- Os limites (2 simultâneas, 3.000 números/min) são constantes em
  `src/lib/rate-limit.ts` e `src/lib/whatsapp/validation-throttle.ts`; ajustar com
  a experiência real.
- O cache é por workspace (privacidade): o mesmo número em dois workspaces é
  consultado duas vezes. Um cache global por número seria otimização futura.

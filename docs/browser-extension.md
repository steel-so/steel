# Extensão de navegador (E2)

Extensão para **Chrome e Edge** (Manifest V3) que abre uma **barra lateral** ao
lado do WhatsApp Web, do Gmail e do LinkedIn. Mostra o contato no CRM, cria lead
com um clique, abre chamado e lista o histórico de chamados do contato. Roadmap:
E2, rótulo `2026.10.11.4`. Código em `extension/`.

## O que faz

| Onde | Como lê o contato | O que mostra |
| --- | --- | --- |
| WhatsApp Web | cabeçalho da conversa (nome ou número) e o JID das mensagens (`<número>@c.us`) | leads com o mesmo telefone; chamados que citam o número |
| Gmail | remetente da conversa aberta (`span.gD[email]`), descartando a conta do próprio usuário (lida do título da aba) | leads com o mesmo e-mail; chamados que citam o e-mail |
| LinkedIn | perfil aberto em `/in/<slug>` (nome, cargo e empresa do título do perfil) | leads com o mesmo perfil; chamados que citam o perfil |

- **Quem ainda não migrou o número para o Steel** também aparece: a leitura é da
  própria tela do navegador, então não depende de a conexão de WhatsApp estar no
  Steel.
- **Criar lead**: formulário já preenchido (nome, e-mail, telefone, empresa,
  cargo, perfil do LinkedIn). Origem `Extensão de navegador`; canal conforme o
  site. Exige ao menos e-mail ou telefone, como o resto do CRM.
- **Abrir chamado**: tipo, título e descrição. A descrição leva o contato em
  texto (`Telefone:`, `E-mail:`, `LinkedIn:`), e é isso que a busca do histórico
  encontra depois.
- **Histórico**: `GET /api/v1/servicedesk/tickets?q=<identificador>` para cada
  identificador do contato (telefone sem o nono dígito, e-mail em minúsculas,
  slug do LinkedIn), incluindo chamados fechados. Os mais novos primeiro.

## Decisões

- **Só a API pública v1** (ADR 0035), autenticada com o **token pessoal**
  `stl_pat_` e o `@steel-so/sdk` publicado (0.1.2, versão exata). Nenhuma rota
  interna, nenhum cookie de sessão. O token fica em `chrome.storage.local`,
  restrito às páginas da extensão (`setAccessLevel`), e só o service worker fala
  com o Steel.
- **Sem CORS e sem alterar o app**: o service worker faz as chamadas com a
  permissão de host concedida pelo usuário. A extensão declara
  `optional_host_permissions` (`https://*/*`, `http://localhost/*`) e **pede só a
  origem do Steel informada**, na hora de conectar. `host_permissions` fica
  vazio. Por isso funciona com produção, homologação ou instalação própria, sem
  um build por cliente.
- **Lead é a "oportunidade de um clique".** A API v1 não tem `POST` de
  oportunidade (só `GET` e mover etapa). A extensão cria o lead; a conversão em
  oportunidade segue no CRM. Se a v1 ganhar a rota, o botão entra no painel sem
  mudar o resto.
- **Encontrar o lead**: a v1 não filtra leads por telefone ou e-mail. A extensão
  lê a lista inteira (páginas de 100, até 2.000 leads) e compara no navegador:
  telefone canônico (código do país, sem o nono dígito), e-mail em minúsculas,
  slug do LinkedIn. Nome só vale como sugestão ("confira"), com pelo menos duas
  palavras e quando nada mais bateu. A lista fica em `chrome.storage.session`
  por 5 minutos (botão **Atualizar** força a releitura).
- **Fuso das datas**: a v1 não informa o fuso do workspace; o painel usa
  `America/Sao_Paulo`.
- **Sem dependência de execução além do SDK**; a interface é DOM puro (sem
  framework), com tema claro e escuro pelo sistema.
- **Seletores frágeis por natureza**: WhatsApp Web, Gmail e LinkedIn mudam o HTML
  sem avisar. A leitura é pequena (`extension/src/content/*.ts`) e a lógica pura
  fica em `extension/src/lib/extract.ts`, com testes. Se um site quebrar, o
  painel só deixa de mostrar o contato; nada é enviado ao Steel sem clique.

## Privacidade (LGPD)

A extensão **não envia nada ao Steel sozinha**. Ler o contato é local; as únicas
chamadas são a busca (leitura) e as ações de criar lead ou chamado, sempre por
clique. Não há telemetria nem servidor próprio. O texto das mensagens do
WhatsApp, o corpo dos e-mails e o resto do perfil do LinkedIn **nunca são lidos**:
só nome, número, e-mail, cargo e empresa.

## Desenvolvimento e build

Tudo roda no GitHub Actions (`.github/workflows/browser-extension.yml`):
`typecheck`, testes com cobertura (`src/lib`, piso de 95%), `build`
(`scripts/build.mjs`, esbuild), `check:package` (arquivos do manifesto, sem
`eval`, sem source map) e o zip.

Para testar a mão, baixe o artefato `steel-browser-extension` da execução,
descompacte e carregue em `chrome://extensions` ▸ **Modo do desenvolvedor** ▸
**Carregar sem compactação**. O ícone é um marcador gerado no build; para usar a
arte final, coloque PNGs `icon-16/32/48/128.png` em `extension/icons/` e o build
passa a copiá-los.

Versão: tag `extension-v<x.y.z>` carimba o `manifest.json` e anexa o zip a uma
release do GitHub. Sem tag, vale a do `package.json`.

O `pnpm-lock.yaml` da extensão ainda **não está commitado** (foi escrita sem
poder rodar `pnpm install`). O workflow instala sem `--frozen-lockfile` e envia o
lockfile resolvido junto do artefato: commite-o e troque por `--frozen-lockfile`.

## Publicar na Chrome Web Store (passos do dono)

A submissão é manual e é do dono. Passo a passo:

1. **Conta de desenvolvedor**: registre em
   <https://chrome.google.com/webstore/devconsole> (taxa única de US$ 5), de
   preferência com uma conta Google da empresa. Para exibir "Stratus Telecom"
   como editor, verifique o domínio na aba **Account**.
2. **Pacote**: baixe o zip do artefato (ou da release da tag
   `extension-v<x.y.z>`). Use sempre uma versão maior que a anterior.
3. **Novo item** ▸ envie o zip. A loja lê o `manifest.json`.
4. **Listagem** (pt-BR): nome "Steel: CRM e ServiceDesk", descrição curta (o
   `description` do manifesto) e longa, categoria **Produtividade**, ícone
   128×128, ao menos 1 captura de tela 1280×800 (use a homologação com a conta de
   smoke e dados fictícios) e, se quiser, o vídeo.
5. **Privacidade** (aba *Privacy*):
   - *Single purpose*: "Mostrar o contato do Steel e criar leads e chamados a
     partir do WhatsApp Web, do Gmail e do LinkedIn."
   - Justificativas de permissão: `sidePanel` (a barra lateral), `storage`
     (guardar o endereço e o token do Steel no navegador),
     `optional_host_permissions` (pedidas só para o endereço do Steel que o
     usuário digita, a fim de chamar a API dele) e *content scripts* nos três
     sites (ler nome, número, e-mail, cargo e empresa do contato aberto).
   - Dados coletados: "Informações de identificação pessoal" (contatos do
     usuário), usados só para a função da extensão, não vendidos nem usados para
     outro fim. Marque que **não** há código remoto.
   - URL da política de privacidade: a do Steel
     (`https://<domínio>/legals/privacy`).
6. **Distribuição**: *Público* ou *Não listado* (link direto, bom para começar).
   Países: todos ou Brasil.
7. **Enviar para revisão.** Os pedidos de host amplo (`https://*/*` opcional)
   costumam atrasar a revisão; a justificativa do item 5 deve dizer que a
   permissão é pedida só para o endereço informado. Se a loja recusar o padrão
   amplo, a alternativa é listar os domínios do Steel em `host_permissions`
   (um build por ambiente).
8. **Edge**: o mesmo zip serve. Envie em
   <https://partner.microsoft.com/dashboard/microsoftedge> com a mesma listagem.

## Fora do escopo desta entrega

- Criar oportunidade (falta a rota na v1, veja Decisões).
- Firefox e Safari.
- Enviar mensagem de WhatsApp ou e-mail pela barra lateral.
- Selecionar quem é o contato em conversas de grupo do WhatsApp (o painel fica
  vazio em grupo).
- Teste automatizado das telas (a lógica pura tem testes; a barra lateral e os
  seletores dos sites são verificados carregando a extensão na homologação).

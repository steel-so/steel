# Geração de site por IA com fidelidade às referências (contrato)

Pedido de 18/11/2026: ao gerar um site a partir de links e imagens de exemplo, o
resultado deve ficar **o mais próximo possível visualmente** das referências,
mesmo que gaste muitos tokens e leve vários minutos.

## Por que hoje não chega perto

A geração escolhe entre 13 seções prontas (`SITE_AI_SECTIONS`) e só reescreve o
texto. A leitura do link é um resumo de texto (regex sobre o HTML); as imagens
só entram na chamada do plano. O teto é o catálogo.

## Regra de conteúdo (mantida)

Aproxima **layout, hierarquia, espaçamento, cores, tipografia, formato dos
botões/cartões, proporção das imagens**. Textos são sempre escritos para a
empresa do briefing; logos, fotos e marcas da referência nunca são copiados
(imagens ficam como espaço reservado com a mesma proporção, ou usam as imagens
da empresa/IA).

## Pipeline alvo

1. **Captura** (worker, Chromium): para cada link, abre a página (desktop 1440 e
   mobile 390), rola até o fim, tira capturas por faixa e extrai do DOM os
   blocos de cima para baixo com estilos computados. Resultado: `ReferenceCapture`.
   Cada pedido de rede do navegador passa pela mesma política de segurança do
   `safe-fetch` (host, DNS, redirecionamentos, portas).
2. **Análise visual**: um modelo com visão recebe as capturas (e as imagens
   enviadas pelo usuário) e devolve uma `DesignSpec` por referência: seções na
   ordem, layout de cada uma, cores exatas, tipografia, botões, raio, sombras.
3. **Plano + blueprints**: em vez de escolher seções prontas, o modelo gera para
   cada seção um `SectionBlueprint` (árvore restrita: seção → linhas/colunas/
   grade → título, texto, botão, imagem, ícone, cartão, com estilos), compilado
   para `NodeSpec` com os helpers de `presets/builder`.
4. **Refino**: o rascunho é renderizado (mesma captura do passo 1), comparado
   com a referência por um modelo com visão, e os blueprints divergentes são
   corrigidos; até `FIDELITY_MAX_ROUNDS` rodadas.
5. As seções prontas continuam como caminho padrão quando não há referência.

## Contrato de dados

`src/lib/site-ai/fidelity/types.ts` (esta pasta pertence a quem fizer o passo).

```ts
export interface CaptureBlock {
  /** Posição vertical e tamanho em px na viewport de captura. */
  y: number; height: number
  tag: string
  /** Estilos computados relevantes (cores #rrggbb, fontes, tamanhos, raio…). */
  style: Record<string, string>
  /** Texto curto do bloco (só para a análise; nunca vira cópia). */
  text: string
  children?: CaptureBlock[]
}
export interface ReferenceCapture {
  url: string                       // origem + caminho
  title: string
  desktop: { width: number; height: number; strips: string[]; blocks: CaptureBlock[] }
  mobile:  { width: number; height: number; strips: string[] }
  fonts: string[]
  /** `strips` são `data:image/jpeg;base64,…` (máx. 1.4M caracteres cada). */
}
```

## Divisão de trabalho

- **Frente A — captura** (`src/lib/site-ai/fidelity/capture/*`, job no worker,
  endpoint de leitura do resultado): entrega `captureReference(url)`.
- **Frente B — blueprints e geração** (`src/lib/site-ai/fidelity/blueprint/*`,
  integração no `site-ai.service.ts` atrás de `fidelity: true`, ligado
  automaticamente quando há link ou imagem): entrega análise visual, blueprint,
  compilador e a geração por seção.
- **Frente C — refino** (depois de A e B): renderiza o rascunho, compara e corrige.

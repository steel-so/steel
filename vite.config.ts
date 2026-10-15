import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          globals: true,
          include: [
            'src/services/**/__tests__/*.test.ts',
            'src/mappers/**/__tests__/*.test.ts',
            'src/schemas/**/__tests__/*.test.ts',
            'src/errors/**/__tests__/*.test.ts',
            'src/openapi/**/__tests__/*.test.ts',
            'src/lib/__tests__/*.test.ts',
            'utils/__tests__/*.test.ts',
            'lib/__tests__/*.test.ts',
          ],
          exclude: ['**/*.integration.test.ts', '**/*.smoke.test.ts'],
          setupFiles: [
            './src/__tests__/setup.ts',
            './src/__tests__/setup.unit.ts',
          ],
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: [
            'src/repositories/**/__tests__/*.test.ts',
            'src/cache/**/__tests__/*.test.ts',
            'src/lib/**/__tests__/*.integration.test.ts',
          ],
          setupFiles: [
            './src/__tests__/setup.ts',
            './src/__tests__/setup.redis.ts',
            './src/__tests__/setup.integration.ts',
          ],
          testTimeout: 15000,
          pool: 'forks',
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          environment: 'node',
          globals: true,
          include: ['app/**/__tests__/*.e2e.test.ts'],
          setupFiles: [
            './src/__tests__/setup.ts',
            './src/__tests__/setup.redis.ts',
            './src/__tests__/setup.e2e.ts',
          ],
          testTimeout: 30000,
          // `afterEach` faz TRUNCATE CASCADE em várias tabelas — o padrão do
          // Vitest (10s) já estourou em CI numa suíte longa, mesmo com o
          // `testTimeout` acima já alargado por ser mais lenta.
          hookTimeout: 30000,
          pool: 'forks',
          maxWorkers: 1,
          // Serviços fazem escritas fire-and-forget (`void recordCrmActivity`,
          // `void dispatchCrmWorkflowRecordEvent`) que não são aguardadas pela
          // resposta HTTP; se ainda estiverem em voo quando o próximo teste
          // roda o TRUNCATE CASCADE do afterEach, o Postgres pode reportar
          // deadlock (40P01) entre o TRUNCATE e a escrita em background.
          // Retry absorve essa corrida rara sem mascarar falha real de asserção.
          retry: 2,
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          globals: true,
          include: ['app/**/__tests__/*.component.test.tsx'],
          setupFiles: [
            './src/__tests__/setup.ts',
            './src/__tests__/setup.component.ts',
          ],
          // Full CRM grids and Base UI dialogs render slowly on a loaded runner;
          // the first render of a file can exceed 5s even though it passes.
          testTimeout: 15000,
          // `@platejs/math` e `@platejs/docx-io` (editor da KB) importam CSS e
          // subpaths CJS sem extensão: processados pelo Vite, não pelo Node.
          server: { deps: { inline: [/@platejs\/(math|docx-io)/] } },
        },
      },
      {
        extends: true,
        test: {
          name: 'redis-tls',
          environment: 'node',
          globals: true,
          include: ['src/lib/__tests__/*.smoke.test.ts'],
          setupFiles: ['./src/__tests__/setup.ts'],
          testTimeout: 15000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Piso global exigido: abaixo de 95% em qualquer métrica o
      // `test:coverage` falha e o job Coverage Tests barra o CI.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
      include: [
        'src/services/**',
        'src/mappers/**',
        'src/schemas/**',
        'src/errors/**',
        'src/repositories/**',
        'src/cache/**',
        'src/lib/auth-session.ts',
        'src/lib/rate-limit.ts',
        'src/lib/rate-limit-helpers.ts',
        'src/lib/result.ts',
        'src/lib/billing.ts',
        'utils/**',
        'lib/abacatepay.ts',
        // Lógica pura e testável das duas integrações de observabilidade. O
        // `lib/posthog/client.ts` fica de fora: é módulo de navegador
        // ('use client'), coberto pelo projeto `component`, que não entra na
        // run de cobertura (unit + integration).
        'lib/sentry/**',
        'lib/posthog/constants.ts',
        'src/lib/ai/**',
        'src/lib/analytics/**',
        'src/lib/servicedesk/**',
        'src/lib/integrations/**',
        'src/lib/queue/processors/**',
        'src/lib/search/**',
        'src/lib/changelog/**',
        'src/lib/docs/**',
        'src/lib/mdx/**',
        'src/lib/pricing/**',
        'src/lib/seo/**',
        'src/lib/shortcuts/**',
        'src/lib/canvas/**',
        'src/lib/canvas-site/**',
      ],
      exclude: [
        'node_modules/**',
        'src/__tests__/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/**',
        'src/generated/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, './src/__tests__/server-only.mock.ts'),
    },
  },
})

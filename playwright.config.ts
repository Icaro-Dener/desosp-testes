import { defineConfig } from '@playwright/test';
import { STORAGE_STATE } from './tests/support/ambiente';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  // Relatório HTML (etapas, prints, trace) em playwright-report/ — abrir com
  //   npx playwright show-report   ou pelo botão "Abrir relatório" do painel
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // O painel liga PAINEL_OCULTO=1 quando o "Mostrar navegador" está desligado.
    // O login (projeto setup) força a janela visível no próprio auth.setup.ts.
    headless: process.env.PAINEL_OCULTO === '1',
    viewport: { width: 1440, height: 900 },
    // goto/waitForURL sem timeout ficam esperando para sempre: limita
    navigationTimeout: 90_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // storageState é sobrescrito por test.use() nos specs que precisam de auth
  },
  projects: [
    {
      // Login manual nas três aplicações (SAE, Auditoria, Transição) → .auth/hml.json
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'testes',
      testMatch: /\.spec\.ts/,
      testIgnore: [/desospitalizacao-e2e\.spec\.ts/, /fluxos[\\/]/],
      dependencies: [], // remove dependência automática; auth é manual
      use: {
        storageState: 'auth.json',
      },
    },
    {
      // Ciclo completo SAE → Auditoria → Transição (homologação)
      name: 'e2e',
      testMatch: /desospitalizacao-e2e\.spec\.ts/,
      use: {
        storageState: STORAGE_STATE, // .auth/hml.json ou .auth/dev.json (PAINEL_AMBIENTE)
        actionTimeout: 30_000,
        // Análise completa de cada execução: linha do tempo, DOM e rede de cada ação.
        // O trace contém dados das telas (e tokens de sessão): manter só local.
        trace: 'on',
        screenshot: 'on',
        video: 'retain-on-failure',
      },
    },
    {
      // Fluxos separados (rodar um por vez, na ordem): 01 criar → 02 desosp → 03 finalizar.
      // A internação em uso fica em .estado/internacao-atual.json (DEV/HML) ou internacao-prd.json (PRD): trava entre fluxos.
      name: 'fluxos',
      testMatch: /fluxos[\\/].*\.spec\.ts/,
      use: {
        storageState: STORAGE_STATE, // .auth/hml.json ou .auth/dev.json (PAINEL_AMBIENTE)
        actionTimeout: 30_000,
        trace: 'on',
        screenshot: 'on',
        video: 'retain-on-failure',
      },
    },
  ],
});

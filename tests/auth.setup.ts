import { test as setup, expect, Page } from '@playwright/test';
import fs from 'fs';
import { URLS, AMBIENTE, STORAGE_STATE, SAE_SESSION_STORAGE, compartilharSessaoSae } from './support/ambiente';

// Login MANUAL: o navegador abre e você entra com o seu usuário em cada aplicação.
// Nenhuma senha passa pelo código. Ao final a sessão fica em .auth/hml.json.
//
//   npx playwright test --project=setup

const DEZ_MINUTOS = 10 * 60_000;

setup.setTimeout(3 * DEZ_MINUTOS);
// Reaproveita a sessão anterior (se houver): só pede login onde ela expirou.
// Primeira vez em DEV: parte da sessão de HML (o SAE é o mesmo, evita logar de novo nele).
const SESSAO_HML = '.auth/hml.json';
const sessaoInicial = [STORAGE_STATE, SESSAO_HML].find((f) => fs.existsSync(f));
setup.use({
  headless: false,
  storageState: sessaoInicial ?? { cookies: [], origins: [] },
});

async function aguardarLoginSae(page: Page) {
  await page.goto(AMBIENTE.sae);
  const senha = page.locator('input[type="password"]');
  // A tela é React: espera o formulário existir antes de esperar o login.
  await expect(senha).toBeVisible({ timeout: 60_000 });
  console.log('\n>>> Faça o login no SAE na janela do navegador.');
  // Depois do ENTRAR, o SAE faz location.replace para a URL devolvida pelo
  // /secure/api/auth/login. Só considera logado quando sai da tela de login.
  // (a página logada tem inputs de senha escondidos: detectar pelo caminho /secure/)
  await page.waitForURL((u) => u.pathname.startsWith('/secure/'), { timeout: DEZ_MINUTOS });
  await page.waitForLoadState('networkidle');
  console.log(`SAE logado: ${page.url()}`);
  // O storageState não guarda sessionStorage; o SAE pode manter o token ali.
  fs.writeFileSync(SAE_SESSION_STORAGE, await page.evaluate(() => JSON.stringify(sessionStorage)));
}

async function aguardarLoginOutSystems(page: Page, url: string, modulo: string) {
  await page.goto(url);
  console.log(`\n>>> Se pedir, faça o login em ${modulo} (Microsoft SSO).`);
  // Logado = de volta ao módulo e com o user_info gravado pelo runtime do ODC.
  await expect
    .poll(
      async () => {
        if (!page.url().startsWith(`${AMBIENTE.outsystems}/${modulo}`)) return false;
        return page.evaluate(() => !!localStorage.getItem('user_info')).catch(() => false);
      },
      { timeout: DEZ_MINUTOS, intervals: [1_000] },
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
  console.log(`${modulo} logado.`);
}

setup('login manual nas três aplicações', async ({ page }) => {
  await aguardarLoginSae(page);
  await aguardarLoginOutSystems(page, URLS.auditoriaInicio, 'CockpitAuditoriaClinica');
  await aguardarLoginOutSystems(page, URLS.transicaoHome, 'TransicaoCuidado');

  await page.context().storageState({ path: STORAGE_STATE });
  compartilharSessaoSae(); // o SAE é o mesmo nos dois ambientes
  console.log(`\nSessão salva em ${STORAGE_STATE}`);
});

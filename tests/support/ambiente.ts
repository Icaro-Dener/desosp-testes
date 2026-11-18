import type { Page } from '@playwright/test';

// Ambientes (o painel escolhe pelo PAINEL_AMBIENTE):
//   dev = DEV (unimedpoa-dev)    + SAE HML01
//   hml = TEST (unimedpoa-test)  + SAE HML01   (DEV e HML compartilham o mesmo SAE)
//   prd = PRODUÇÃO (app.unimedpoa.com.br) + SAE de produção
// Pode sobrescrever as URLs por variável de ambiente.
//
// PRODUÇÃO: os fluxos gravam dados reais (internação no SAE, desosp no Transição,
// protocolo no CRM). Só a paciente de teste ("Mulher Teste") pode ser usada, e
// nada fora dela pode ser alterado: ver EM_PRODUCAO nos page objects.

export type Ambiente = 'hml' | 'dev' | 'prd';
const pedido = process.env.PAINEL_AMBIENTE;
export const AMBIENTE_ATUAL: Ambiente = pedido === 'dev' || pedido === 'prd' ? pedido : 'hml';
export const EM_PRODUCAO = AMBIENTE_ATUAL === 'prd';
export const NOME_AMBIENTE: Record<Ambiente, string> = { hml: 'HML', dev: 'DEV', prd: 'PRD' };

const ODC: Record<Ambiente, string> = {
  hml: 'https://unimedpoa-test.outsystems.app',
  dev: 'https://unimedpoa-dev.outsystems.app',
  prd: 'https://app.unimedpoa.com.br',
};
const SAE: Record<Ambiente, string> = {
  hml: 'https://sae01-hml.unimedpoa.com.br/',
  dev: 'https://sae01-hml.unimedpoa.com.br/',
  prd: 'https://sae.unimedpoa.com.br/',
};
// Gateway da API do SAE (validação opcional por API). Em PRD fica desligado:
// as credenciais do .env são de HML e a conferência é feita pelas telas do SAE.
const API_GATEWAY: Record<Ambiente, string | null> = {
  hml: 'https://api-hml.unimedpoa.com.br',
  dev: 'https://api-hml.unimedpoa.com.br',
  prd: null,
};

export const AMBIENTE = {
  sae: process.env.SAE_URL ?? SAE[AMBIENTE_ATUAL],
  outsystems: process.env.ODC_URL ?? ODC[AMBIENTE_ATUAL],
  apiGateway: EM_PRODUCAO ? null : process.env.API_GATEWAY_URL ?? API_GATEWAY[AMBIENTE_ATUAL],
};

export const URLS = {
  auditoriaInicio: `${AMBIENTE.outsystems}/CockpitAuditoriaClinica/Inicio`,
  auditoriaPainelControle: `${AMBIENTE.outsystems}/CockpitAuditoriaClinica/dev_painelcontrole`,
  auditoriaDesospitalizacao: (internacaoId: string | number) =>
    `${AMBIENTE.outsystems}/CockpitAuditoriaClinica/Desospitalizacao?InternacaoId=${internacaoId}`,
  transicaoHome: `${AMBIENTE.outsystems}/TransicaoCuidado/Home`,
};

// Sessão salva pelo auth.setup.ts (login manual), uma por ambiente. Fora do git.
// O nome do HML continua hml.json (sessões já salvas seguem valendo).
export const STORAGE_STATE = `.auth/${AMBIENTE_ATUAL}.json`;
// sessionStorage do SAE: o de PRD fica separado (outro SAE, outro login)
export const SAE_SESSION_STORAGE = EM_PRODUCAO ? '.auth/sae-session-prd.json' : '.auth/sae-session.json';
// .auth/ fica fora do git: num clone novo a pasta não existe.
(require('fs') as typeof import('fs')).mkdirSync('.auth', { recursive: true });

/** Regrava a sessão (cookies renovados) para a próxima execução não pedir login. */
export async function salvarSessao(page: Page) {
  await page.context().storageState({ path: STORAGE_STATE });
  compartilharSessaoSae();
}

/**
 * DEV e HML usam o mesmo SAE (HML01): copia os cookies e o localStorage dele da
 * sessão deste ambiente para a do outro (se existir). Assim um login no SAE feito
 * em DEV vale em HML e vice-versa. Não mexe na parte do OutSystems.
 * PRD tem outro SAE: nunca recebe nem passa sessão.
 */
export function compartilharSessaoSae() {
  const fs = require('fs') as typeof import('fs');
  const host = new URL(AMBIENTE.sae).hostname;
  const ehSae = (dominio: string) => dominio.replace(/^\./, '') === host;
  const ler = (f: string) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const daqui = ler(STORAGE_STATE);
  if (!daqui) return;
  const mesmoSae = (Object.keys(SAE) as Ambiente[]).filter((a) => a !== AMBIENTE_ATUAL && new URL(SAE[a]).hostname === host);
  for (const outro of mesmoSae) {
    const arq = `.auth/${outro}.json`;
    const ali = ler(arq);
    if (!ali) continue;
    ali.cookies = [...ali.cookies.filter((c: any) => !ehSae(c.domain)), ...daqui.cookies.filter((c: any) => ehSae(c.domain))];
    const origemSae = new URL(AMBIENTE.sae).origin;
    ali.origins = [...(ali.origins ?? []).filter((o: any) => o.origin !== origemSae), ...(daqui.origins ?? []).filter((o: any) => o.origin === origemSae)];
    fs.writeFileSync(arq, JSON.stringify(ali, null, 2));
  }
}

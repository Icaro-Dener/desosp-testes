import type { Page } from '@playwright/test';

// Ambiente das aplicações OutSystems (Auditoria Clínica e Transição de Cuidado):
//   hml = TEST (unimedpoa-test)   dev = DEV (unimedpoa-dev)
// O painel escolhe pelo PAINEL_AMBIENTE. O SAE é sempre o HML01: ele troca dados
// com os dois ambientes. Pode sobrescrever as URLs por variável de ambiente.

export type Ambiente = 'hml' | 'dev';
export const AMBIENTE_ATUAL: Ambiente = process.env.PAINEL_AMBIENTE === 'dev' ? 'dev' : 'hml';
export const NOME_AMBIENTE: Record<Ambiente, string> = { hml: 'HML', dev: 'DEV' };
const ODC: Record<Ambiente, string> = {
  hml: 'https://unimedpoa-test.outsystems.app',
  dev: 'https://unimedpoa-dev.outsystems.app',
};

export const AMBIENTE = {
  sae: process.env.SAE_URL ?? 'https://sae01-hml.unimedpoa.com.br/',
  outsystems: process.env.ODC_URL ?? ODC[AMBIENTE_ATUAL],
  apiGateway: process.env.API_GATEWAY_URL ?? 'https://api-hml.unimedpoa.com.br',
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
export const SAE_SESSION_STORAGE = '.auth/sae-session.json';

/** Regrava a sessão (cookies renovados) para a próxima execução não pedir login. */
export async function salvarSessao(page: Page) {
  await page.context().storageState({ path: STORAGE_STATE });
  compartilharSessaoSae();
}

/**
 * O SAE é o mesmo nos dois ambientes: copia os cookies e o localStorage dele da
 * sessão deste ambiente para a do outro (se existir). Assim um login no SAE feito
 * em DEV vale em HML e vice-versa. Não mexe na parte do OutSystems.
 */
export function compartilharSessaoSae() {
  const fs = require('fs') as typeof import('fs');
  const host = new URL(AMBIENTE.sae).hostname;
  const ehSae = (dominio: string) => dominio.replace(/^\./, '') === host;
  const ler = (f: string) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const daqui = ler(STORAGE_STATE);
  if (!daqui) return;
  for (const outro of (Object.keys(ODC) as Ambiente[]).filter((a) => a !== AMBIENTE_ATUAL)) {
    const arq = `.auth/${outro}.json`;
    const ali = ler(arq);
    if (!ali) continue;
    ali.cookies = [...ali.cookies.filter((c: any) => !ehSae(c.domain)), ...daqui.cookies.filter((c: any) => ehSae(c.domain))];
    const origemSae = new URL(AMBIENTE.sae).origin;
    ali.origins = [...(ali.origins ?? []).filter((o: any) => o.origin !== origemSae), ...(daqui.origins ?? []).filter((o: any) => o.origin === origemSae)];
    fs.writeFileSync(arq, JSON.stringify(ali, null, 2));
  }
}

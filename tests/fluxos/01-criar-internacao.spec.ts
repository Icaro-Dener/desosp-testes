import { test, expect } from '@playwright/test';
import { SaePage } from '../pages/sae.page';
import { AuditoriaPage } from '../pages/auditoria.page';
import { MASSA, gerarCodigoInternacao, hojeBR, hojeISO } from '../support/dados';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from '../support/ambiente';
import { lerInternacao, salvarInternacao, atualizarInternacao } from '../support/estado';
import { anotar } from '../support/fluxo';

/** Quantos dias antes de hoje a internação de teste começa. */
const DIAS_RETROATIVOS = 2;

test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Fluxo 1: cria a internação no SAE, roda a sync e entra nos detalhes dela na
 * Auditoria Clínica. Deixa a internação "em uso" (trava) até o fluxo de finalizar.
 */
test('criar internação: SAE → sync → detalhes na Auditoria', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const emUso = lerInternacao();
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);
  expect(emUso, `Já existe uma internação em uso (código ${emUso?.codigo}). Rode "Finalizar internação" antes de criar outra.`).toBeNull();

  const sae = new SaePage(page);
  const auditoria = new AuditoriaPage(page);
  const codigo = gerarCodigoInternacao();
  // Data retroativa: a inconformidade de Acomodação só aceita datas a partir do
  // dia seguinte à internação, então uma internação de hoje não permite enviá-la.
  const dataInternacao = new Date(Date.now() - DIAS_RETROATIVOS * 86_400_000);
  anotar('codigo-internacao', codigo);
  anotar('data-internacao', hojeBR(dataInternacao));

  await test.step('0. SAE: finalizar internações de teste que ficaram abertas', async () => {
    const finalizadas = await sae.finalizarAbertasDoPacienteDeTeste();
    if (finalizadas === null) anotar('limpeza', 'PRD: limpeza automática desligada (não finaliza internações de outras execuções)');
    else anotar('limpeza', finalizadas.length ? `finalizadas: ${finalizadas.join(', ')}` : 'nenhuma internação aberta');
  });

  await test.step('1. SAE: criar a internação', async () => {
    await sae.abrirAcompanhamento();
    const { atendimento } = await sae.criarInternacao(codigo, dataInternacao);
    // a partir daqui existe uma internação aberta: trava a criação de outra
    salvarInternacao({ codigo, atendimento, criadaEm: new Date().toISOString(), ambiente: AMBIENTE_ATUAL, dataInternacao: hojeISO(dataInternacao) });
    anotar('atendimento-sae', atendimento);

    const linha = await sae.buscarPorAtendimento(atendimento);
    await expect(linha).toContainText(new RegExp(MASSA.pacienteBusca, 'i'));
    await expect(linha).toContainText('Andamento');
  });

  await test.step('2. Auditoria: sync do hospital', async () => {
    const sync = await auditoria.sincronizarHospital();
    anotar('sync', sync.texto.slice(0, 120));
  });

  await test.step('3. Auditoria: localizar e entrar nos detalhes da internação', async () => {
    const linha = await auditoria.localizarInternacao(codigo, dataInternacao);
    const internacaoIdAuditoria = await auditoria.abrirDetalhes(linha);
    atualizarInternacao({ internacaoIdAuditoria });
    anotar('internacao-auditoria', internacaoIdAuditoria);
  });
});

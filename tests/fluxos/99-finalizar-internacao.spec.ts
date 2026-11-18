import { test, expect } from '@playwright/test';
import { SaePage } from '../pages/sae.page';
import { AuditoriaPage } from '../pages/auditoria.page';
import { TransicaoPage, COLUNAS } from '../pages/transicao.page';
import { SaeApi } from '../support/api-sae';
import { hojeISO } from '../support/dados';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from '../support/ambiente';
import { lerInternacao, atualizarInternacao, limparInternacao, InternacaoAtual, conferirAmbiente } from '../support/estado';
import { anotar, aguardarEstado } from '../support/fluxo';

test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Fluxo 3: registra a alta e finaliza a internação em uso no SAE, roda a sync e
 * confere que ela saiu da Auditoria. Se a desospitalização foi aprovada, faz a
 * confirmação final no Transição (só é possível depois da alta).
 * No fim libera a trava, e "Criar internação" volta a ficar disponível.
 */
test('finalizar internação: SAE → sync → sai da Auditoria', async ({ page }) => {
  test.setTimeout(25 * 60_000);
  const em = lerInternacao() as InternacaoAtual;
  conferirAmbiente(em);
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);
  expect(em, 'Nenhuma internação em uso para finalizar.').not.toBeNull();

  const sae = new SaePage(page);
  const auditoria = new AuditoriaPage(page);
  const transicao = new TransicaoPage(page);
  const api = await SaeApi.criar();
  anotar('codigo-internacao', em.codigo);
  anotar('atendimento-sae', em.atendimento);

  await test.step('1. SAE: registrar a alta e finalizar a internação', async () => {
    await sae.abrirAcompanhamento();
    const linha = await sae.buscarPorAtendimento(em.atendimento);
    if ((await linha.innerText()).includes('Finalizada')) {
      anotar('aviso', 'internação já estava finalizada no SAE');
      return;
    }
    const { hora } = await sae.finalizarInternacao(em.atendimento);
    anotar('alta', `${hojeISO()} ${hora}`);

    if (em.desosp) {
      // o Transição lê a alta pela API do SAE
      const e = await aguardarEstado(transicao, em.desosp.idInternacaoSae, (s) => s.sae?.Data_encerramento === hojeISO(), 'alta do SAE não chegou ao Transição');
      expect(e.sae!.Hora_saida).toBe(hora);
      if (api) expect(JSON.stringify(await api.internacoesComAltaDesde(hojeISO()))).toContain(em.desosp.idInternacaoSae);
    }
  });

  await test.step('2. Auditoria: sync e internação fora da lista', async () => {
    const sync = await auditoria.sincronizarHospital();
    anotar('sync', sync.texto.slice(0, 120));
    if (em.internacaoIdAuditoria) await auditoria.esperarSaida(em.internacaoIdAuditoria);
    else anotar('aviso', 'a criação não chegou à Auditoria: saída não conferida');
  });

  await test.step('3. Transição: última coluna e confirmação final', async () => {
    const d = em.desosp;
    if (!d || d.etapa === 'confirmada') {
      anotar('transicao', d ? 'já confirmada' : 'sem desospitalização: nada a confirmar');
      return;
    }
    if (d.etapa !== 'aprovada') {
      anotar('transicao', `desospitalização parou em "${d.etapa}" (não aprovada): sem confirmação`);
      return;
    }
    const e = await aguardarEstado(transicao, d.idInternacaoSae, (s) => s.local?.ColunaDesosp === '4', 'card não avançou para a última coluna');
    expect(e.local!.StatusDesosp).toBe('Pendente');
    const card = await transicao.cardNaColuna(COLUNAS.atendimento, d.idDesosp!);
    await transicao.confirmar(card, em.codigo);
    const fim = await aguardarEstado(transicao, d.idInternacaoSae, (s) => s.local?.StatusDesosp === 'Confirmado', 'confirmação não refletiu', 60_000);
    expect(fim.local!.ColunaDesosp).toBe('4');
    atualizarInternacao({ desosp: { ...d, etapa: 'confirmada' } });
    anotar('transicao', 'confirmada');
  });

  limparInternacao();
  anotar('trava', 'liberada: "Criar internação" disponível');
  await api?.fechar();
});

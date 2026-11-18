import { test, expect } from '@playwright/test';
import { AuditoriaPage } from '../pages/auditoria.page';
import { TransicaoPage, COLUNAS } from '../pages/transicao.page';
import { SaeApi } from '../support/api-sae';
import { MASSA, dadosDesospitalizacao, hojeISO } from '../support/dados';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from '../support/ambiente';
import { lerInternacao, atualizarInternacao, InternacaoAtual, conferirAmbiente } from '../support/estado';
import { anotar, aguardarEstado } from '../support/fluxo';

test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Fluxo 2: na internação em uso, preenche e envia a desospitalização pela
 * Auditoria, valida a persistência no SAE e trata no Transição (atribuir + aprovar).
 * Se uma execução anterior parou no meio, continua de onde parou.
 */
test('desospitalização: enviar pela Auditoria e aprovar no Transição', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const em = lerInternacao() as InternacaoAtual;
  conferirAmbiente(em);
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);
  expect(em, 'Nenhuma internação em uso: rode "Criar internação" primeiro.').not.toBeNull();
  expect(em.internacaoIdAuditoria, 'A criação não chegou aos detalhes na Auditoria: rode "Criar internação" de novo após finalizar esta.').toBeTruthy();
  expect(em.desosp?.etapa ?? 'nenhuma', 'A desospitalização desta internação já foi aprovada').not.toMatch(/aprovada|confirmada/);

  const auditoria = new AuditoriaPage(page);
  const transicao = new TransicaoPage(page);
  const api = await SaeApi.criar();
  anotar('codigo-internacao', em.codigo);
  anotar('internacao-auditoria', em.internacaoIdAuditoria!);

  await test.step('1. Auditoria: preencher e enviar a desospitalização', async () => {
    if (em.desosp) {
      anotar('aviso', 'desospitalização já enviada numa execução anterior: continuando');
      return;
    }
    const linha = await auditoria.localizarPorId(em.internacaoIdAuditoria!);
    await auditoria.abrirDesospitalizacao(linha);
    const dados = dadosDesospitalizacao(em.codigo);
    const { dataAltaProvavel } = await auditoria.preencherDesospitalizacao(dados);
    const { idInternacaoSae } = await auditoria.enviarDesospitalizacao();
    em.desosp = { idInternacaoSae, etapa: 'enviada', dataAltaProvavel: hojeISO(dataAltaProvavel) };
    atualizarInternacao({ desosp: em.desosp });
  });
  const d = em.desosp!;
  anotar('internacao-sae', d.idInternacaoSae);

  let status = '';
  await test.step('2. Validar que a desospitalização foi persistida no SAE', async () => {
    // Pelo ODC: o Transição lê as desospitalizações direto da API do SAE
    const e = await aguardarEstado(transicao, d.idInternacaoSae, (s) => !!s.sae && !!s.local, 'desospitalização não apareceu na API do SAE / no kanban');
    d.idDesosp = e.sae!.Id_internacao_desosp;
    atualizarInternacao({ desosp: d });
    anotar('id-desosp-sae', d.idDesosp);
    expect(e.sae!.Id_hospital).toBe(MASSA.idHospital);
    // Desde 13/11/2026 o SAE grava a alta provável um dia antes da enviada pela Auditoria:
    // registrado como aviso para não travar o resto do fluxo.
    if (e.sae!.data_prevista_alta !== d.dataAltaProvavel)
      anotar('aviso', `data provável de alta: Auditoria enviou ${d.dataAltaProvavel}, SAE gravou ${e.sae!.data_prevista_alta}`);
    expect(e.local?.ColunaDesosp, 'coluna no kanban').toBe('2');
    status = e.local!.StatusDesosp;

    if (api) {
      const resp = await api.desospitalizacao(MASSA.idHospital, d.idInternacaoSae);
      expect(JSON.stringify(resp)).toContain(d.idDesosp);
    } else {
      anotar('aviso', 'Sem SAE_API_CLIENT_ID/SECRET no .env: validação direta na API do SAE não executada.');
    }
  });

  await test.step('3. Transição: atribuir a mim', async () => {
    if (/Em análise$/i.test(status)) {
      anotar('aviso', 'paciente já atribuído numa execução anterior');
    } else {
      const card = await transicao.cardNaColuna(COLUNAS.viverBem, d.idDesosp!);
      await transicao.atribuirAMim(card);
      const e = await aguardarEstado(transicao, d.idInternacaoSae, (s) => /Em análise$/i.test(s.local?.StatusDesosp ?? ''), 'atribuição não refletiu no status', 60_000);
      expect(e.local!.StatusDesosp).toMatch(/Em análise pelo Viver Bem - Em análise/i);
    }
    atualizarInternacao({ desosp: { ...d, etapa: 'atribuida' } });
    const card = await transicao.cardNaColuna(COLUNAS.viverBem, d.idDesosp!);
    expect(await transicao.itensDoMenu(card)).toEqual(expect.arrayContaining(['Aprovar', 'Reprovar']));
  });

  await test.step('4. Transição: aprovar', async () => {
    const card = await transicao.cardNaColuna(COLUNAS.viverBem, d.idDesosp!);
    await transicao.aprovar(card, em.codigo);
    const e = await aguardarEstado(transicao, d.idInternacaoSae, (s) => s.local?.StatusDesosp === 'Aprovado', 'aprovação não refletiu', 60_000);
    expect(e.local!.ColunaDesosp).toBe('3');
    await transicao.cardNaColuna(COLUNAS.concluida, d.idDesosp!);
    atualizarInternacao({ desosp: { ...d, etapa: 'aprovada' } });
  });

  await api?.fechar();
});

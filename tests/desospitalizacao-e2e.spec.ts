import { test, expect } from '@playwright/test';
import { SaePage } from './pages/sae.page';
import { AuditoriaPage } from './pages/auditoria.page';
import { TransicaoPage, COLUNAS, EstadoDesosp } from './pages/transicao.page';
import { SaeApi } from './support/api-sae';
import { MASSA, gerarCodigoInternacao, dadosDesospitalizacao, hojeISO } from './support/dados';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from './support/ambiente';
import { lerInternacao } from './support/estado';

// Mantém a sessão renovada (SAE expira rápido) para a próxima execução
test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Ciclo completo de uma desospitalização em homologação:
 * SAE → Auditoria Clínica → Transição de Cuidado → SAE → Transição de Cuidado.
 *
 * Pré-requisito: sessão salva (login manual)  →  npx playwright test --project=setup
 * Rodar:                                       →  npx playwright test --project=e2e
 */
test('desospitalização: da criação da internação à confirmação final', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  // o passo 0 finalizaria a internação em uso pelos fluxos separados
  const emUso = lerInternacao();
  expect(emUso, `Há uma internação em uso pelos fluxos separados (código ${emUso?.codigo}): rode "Finalizar internação" antes do ciclo completo.`).toBeNull();

  const sae = new SaePage(page);
  const auditoria = new AuditoriaPage(page);
  const transicao = new TransicaoPage(page);
  const api = await SaeApi.criar();
  if (!api) test.info().annotations.push({ type: 'aviso', description: 'Sem SAE_API_CLIENT_ID/SECRET no .env: validação direta na API do SAE não executada (validado pelas chamadas do ODC e pela tela do SAE).' });

  const codigo = gerarCodigoInternacao();
  const desosp = dadosDesospitalizacao(codigo);
  const ctx: { atendimento?: string; internacaoIdAuditoria?: string; idInternacaoSae?: string; idDesosp?: string } = {};
  const anotar = (k: string, v: string) => test.info().annotations.push({ type: k, description: v });
  anotar('codigo-internacao', codigo);
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);

  // Lê o estado no Transição até a condição ser verdadeira (as integrações não são instantâneas)
  const aguardarEstado = async (cond: (e: EstadoDesosp) => boolean, msg: string, timeout = 5 * 60_000) => {
    let ultimo: EstadoDesosp = {};
    await expect
      .poll(async () => cond((ultimo = await transicao.abrirELerEstado(ctx.idInternacaoSae!))), { message: msg, timeout, intervals: [10_000, 20_000] })
      .toBe(true);
    return ultimo;
  };

  await test.step('0. SAE: finalizar internações de teste que ficaram abertas', async () => {
    const finalizadas = await sae.finalizarAbertasDoPacienteDeTeste();
    if (finalizadas === null) anotar('limpeza', 'PRD: limpeza automática desligada (não finaliza internações de outras execuções)');
    else anotar('limpeza', finalizadas.length ? `finalizadas: ${finalizadas.join(', ')}` : 'nenhuma internação aberta');
  });

  await test.step('1. SAE: criar a internação', async () => {
    await sae.abrirAcompanhamento();
    const { atendimento } = await sae.criarInternacao(codigo);
    ctx.atendimento = atendimento;
    anotar('atendimento-sae', atendimento);

    const linha = await sae.buscarPorAtendimento(atendimento);
    await expect(linha).toContainText(new RegExp(MASSA.pacienteBusca, 'i'));
    await expect(linha).toContainText('Andamento');
  });

  await test.step('1. Auditoria: sync do hospital e internação visível', async () => {
    const sync = await auditoria.sincronizarHospital();
    anotar('sync', sync.texto.slice(0, 120));
    await auditoria.localizarInternacao(codigo);
  });

  await test.step('2. Auditoria: preencher e enviar a desospitalização', async () => {
    const linha = await auditoria.localizarInternacao(codigo);
    ctx.internacaoIdAuditoria = await auditoria.abrirDesospitalizacao(linha);
    anotar('internacao-auditoria', ctx.internacaoIdAuditoria);
    await auditoria.preencherDesospitalizacao(desosp);
    const { idInternacaoSae } = await auditoria.enviarDesospitalizacao();
    ctx.idInternacaoSae = idInternacaoSae;
    anotar('internacao-sae', idInternacaoSae);
  });

  await test.step('2. Validar que a desospitalização foi persistida no SAE', async () => {
    // Pelo ODC: o Transição lê as desospitalizações direto da API do SAE
    const e = await aguardarEstado((s) => !!s.sae && !!s.local, 'desospitalização não apareceu na API do SAE / no kanban');
    ctx.idDesosp = e.sae!.Id_internacao_desosp;
    anotar('id-desosp-sae', ctx.idDesosp);
    expect(e.sae!.Id_hospital).toBe(MASSA.idHospital);
    // Desde 13/11/2026 o SAE grava a alta provável um dia antes da enviada: só aviso
    const altaEnviada = hojeISO(new Date(Date.now() + desosp.diasAteAltaProvavel * 86_400_000));
    if (e.sae!.data_prevista_alta !== altaEnviada)
      anotar('aviso', `data provável de alta: Auditoria enviou ${altaEnviada}, SAE gravou ${e.sae!.data_prevista_alta}`);
    expect(e.local?.ColunaDesosp, 'coluna inicial no kanban').toBe('2');

    // Direto na API do SAE (quando houver credenciais)
    if (api) {
      const resp = await api.desospitalizacao(MASSA.idHospital, ctx.idInternacaoSae!);
      expect(JSON.stringify(resp)).toContain(ctx.idDesosp!);
    }
  });

  await test.step('3. Transição: atribuir a mim', async () => {
    await transicao.abrirELerEstado(ctx.idInternacaoSae!);
    const card = await transicao.cardNaColuna(COLUNAS.viverBem, ctx.idDesosp!);
    await transicao.atribuirAMim(card);

    const e = await aguardarEstado((s) => /Em análise$/i.test(s.local?.StatusDesosp ?? ''), 'atribuição não refletiu no status', 60_000);
    expect(e.local!.StatusDesosp).toMatch(/Em análise pelo Viver Bem - Em análise/i);
    const cardAtribuido = await transicao.cardNaColuna(COLUNAS.viverBem, ctx.idDesosp!);
    expect(await transicao.itensDoMenu(cardAtribuido)).toEqual(expect.arrayContaining(['Aprovar', 'Reprovar']));
  });

  await test.step('3. Transição: aprovar', async () => {
    const card = await transicao.cardNaColuna(COLUNAS.viverBem, ctx.idDesosp!);
    await transicao.aprovar(card, codigo);
    const e = await aguardarEstado((s) => s.local?.StatusDesosp === 'Aprovado', 'aprovação não refletiu', 60_000);
    expect(e.local!.ColunaDesosp).toBe('3');
    await transicao.cardNaColuna(COLUNAS.concluida, ctx.idDesosp!);
  });

  await test.step('4. SAE: registrar a alta e finalizar a internação', async () => {
    const { hora } = await sae.finalizarInternacao(ctx.atendimento!);
    anotar('alta', `${hojeISO()} ${hora}`);

    const e = await aguardarEstado((s) => s.sae?.Data_encerramento === hojeISO(), 'alta do SAE não chegou ao Transição');
    expect(e.sae!.Hora_saida).toBe(hora);
    if (api) {
      const altas = await api.internacoesComAltaDesde(hojeISO());
      expect(JSON.stringify(altas)).toContain(ctx.idInternacaoSae!);
    }
  });

  await test.step('5. Transição: paciente na última coluna e confirmação final', async () => {
    const e = await aguardarEstado((s) => s.local?.ColunaDesosp === '4', 'card não avançou para a última coluna');
    expect(e.local!.StatusDesosp).toBe('Pendente');
    const card = await transicao.cardNaColuna(COLUNAS.atendimento, ctx.idDesosp!);
    await transicao.confirmar(card, codigo);

    const fim = await aguardarEstado((s) => s.local?.StatusDesosp === 'Confirmado', 'confirmação não refletiu', 60_000);
    expect(fim.local!.ColunaDesosp).toBe('4');
  });

  await api?.fechar();
});

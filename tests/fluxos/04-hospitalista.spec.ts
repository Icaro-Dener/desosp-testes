import { test, expect } from '@playwright/test';
import { SaePage } from '../pages/sae.page';
import { AuditoriaPage } from '../pages/auditoria.page';
import { dadosHospitalista, p2 } from '../support/dados';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from '../support/ambiente';
import { lerInternacao, atualizarInternacao, InternacaoAtual, conferirAmbiente } from '../support/estado';
import { anotar } from '../support/fluxo';

test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Questionário: Avaliação Hospitalista. Preenche e envia pela Auditoria Clínica
 * na internação em uso e confere no SAE (Visualizar → "Avaliações Hospitalistas")
 * que a avaliação chegou com as mesmas respostas.
 * Pode rodar mais de uma vez na mesma internação (cada envio é uma avaliação nova).
 */
test('hospitalista: enviar pela Auditoria e conferir no SAE', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const em = lerInternacao() as InternacaoAtual;
  conferirAmbiente(em);
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);
  expect(em, 'Nenhuma internação em uso: rode "Criar internação" primeiro.').not.toBeNull();
  expect(em.internacaoIdAuditoria, 'A criação não chegou aos detalhes na Auditoria: finalize esta internação e crie outra.').toBeTruthy();

  const auditoria = new AuditoriaPage(page);
  const sae = new SaePage(page);
  const agora = new Date();
  const marcador = `${em.codigo}.${p2(agora.getHours())}${p2(agora.getMinutes())}`;
  const dados = dadosHospitalista(marcador);
  const marcadorLista = `HOSP E2E ${marcador}`;
  anotar('codigo-internacao', em.codigo);
  anotar('internacao-auditoria', em.internacaoIdAuditoria!);
  anotar('hospitalista', marcadorLista);

  await test.step('1. Auditoria: abrir a avaliação hospitalista da internação', async () => {
    const linha = await auditoria.localizarPorId(em.internacaoIdAuditoria!);
    await auditoria.abrirFormulario(linha, 'Hospitalista', 'AvaliacaoHospitalista');
  });

  await test.step('2. Auditoria: preencher e enviar a avaliação', async () => {
    await auditoria.preencherHospitalista(dados);
    // "/Action" (e não "/DataAction"): a server action de envio do bloco
    const { mensagem } = await auditoria.enviarFormulario('AvaliacaoHospitalista/Action', em.internacaoIdAuditoria!);
    if (mensagem) anotar('retorno-envio', mensagem.slice(0, 160));
    atualizarInternacao({ hospitalista: [...(em.hospitalista ?? []), marcadorLista] });
  });

  await test.step('3. SAE: conferir a avaliação enviada', async () => {
    // Visualizar da internação → "Avaliações Hospitalistas" → detalhe da avaliação
    const { criacao } = await sae.conferirHospitalista(em.atendimento, dados, marcadorLista);
    anotar('sae-hospitalista', `registrada em ${criacao}, ${dados.respostas.length + 1} respostas e os campos conferidos`);
  });
});

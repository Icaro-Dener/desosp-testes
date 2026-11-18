import { test, expect } from '@playwright/test';
import { SaePage } from '../pages/sae.page';
import { AuditoriaPage, DataIndisponivel } from '../pages/auditoria.page';
import { dadosInconformidades, p2 } from '../support/dados';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from '../support/ambiente';
import { lerInternacao, atualizarInternacao, InternacaoAtual, conferirAmbiente } from '../support/estado';
import { anotar } from '../support/fluxo';

test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Questionário: Inconformidade. Envia pela Auditoria Clínica uma inconformidade
 * de cada tipo (Visita, Acomodação, Material, Medicamento) na internação em uso
 * e confere no SAE (Visualizar → "Inconformidades") que as 4 chegaram corretas.
 * Pode rodar mais de uma vez na mesma internação (cada envio é um registro novo).
 */
test('inconformidade: enviar os 4 tipos pela Auditoria e conferir no SAE', async ({ page }) => {
  test.setTimeout(25 * 60_000);
  const em = lerInternacao() as InternacaoAtual;
  conferirAmbiente(em);
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);
  expect(em, 'Nenhuma internação em uso: rode "Criar internação" primeiro.').not.toBeNull();
  expect(em.internacaoIdAuditoria, 'A criação não chegou aos detalhes na Auditoria: finalize esta internação e crie outra.').toBeTruthy();

  const auditoria = new AuditoriaPage(page);
  const sae = new SaePage(page);
  const agora = new Date();
  const marcador = `${em.codigo}.${p2(agora.getHours())}${p2(agora.getMinutes())}`;
  const inconformidades = dadosInconformidades(marcador);
  anotar('codigo-internacao', em.codigo);
  anotar('internacao-auditoria', em.internacaoIdAuditoria!);
  anotar('inconformidade', `INC <tipo> E2E ${marcador}`);

  const enviadas: typeof inconformidades = [];
  for (const [n, inc] of inconformidades.entries()) {
    await test.step(`${n + 1}. Auditoria: enviar inconformidade de ${inc.tipo}`, async () => {
      const linha = await auditoria.localizarPorId(em.internacaoIdAuditoria!);
      await auditoria.abrirFormulario(linha, 'InconformidadeVisita', 'AvaliacaoInconformidade',
        { acaoDados: 'DataActionBuscaIdInternacao', grupoPronto: 'RadioGroupTipoInconformidade' });
      try {
        await auditoria.preencherInconformidade(inc);
      } catch (e) {
        // tipo impossível nesta internação (regra da tela): reprova no fim, mas segue com os outros tipos
        if (!(e instanceof DataIndisponivel)) throw e;
        expect.soft(null, e.message).toBe(inc.tipo);
        anotar('aviso', e.message);
        return;
      }
      const { mensagem } = await auditoria.enviarFormulario('AvaliacaoInconformidade/ActionEnviarAvaliacaoInconformidade', em.internacaoIdAuditoria!);
      if (mensagem) anotar(`retorno-${inc.chave.toLowerCase()}`, mensagem.slice(0, 160));
      const atual = lerInternacao()!;
      atualizarInternacao({ inconformidade: [...(atual.inconformidade ?? []), `INC ${inc.chave} E2E ${marcador}`] });
      enviadas.push(inc);
    });
  }

  await test.step(`${inconformidades.length + 1}. SAE: conferir as inconformidades enviadas`, async () => {
    expect(enviadas.length, 'ao menos uma inconformidade enviada').toBeGreaterThan(0);
    // Visualizar da internação → "Inconformidades" → detalhe de cada uma
    const { conferidas } = await sae.conferirInconformidades(em.atendimento, enviadas);
    anotar('sae-inconformidade', `${conferidas.length} de ${inconformidades.length} tipos conferidos no SAE: ${conferidas.join(', ')}`);
  });
});

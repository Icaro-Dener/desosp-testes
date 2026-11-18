import { test, expect } from '@playwright/test';
import { SaePage } from '../pages/sae.page';
import { AuditoriaPage } from '../pages/auditoria.page';
import { dadosServicoSocial, p2 } from '../support/dados';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from '../support/ambiente';
import { lerInternacao, atualizarInternacao, InternacaoAtual, conferirAmbiente } from '../support/estado';
import { anotar } from '../support/fluxo';

test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Questionário: Avaliação do Serviço Social. Preenche e envia pela Auditoria
 * Clínica na internação em uso e confere no SAE ("Preencher avaliação de serviço
 * social" da internação) que a avaliação chegou com as mesmas respostas.
 * Pode rodar mais de uma vez na mesma internação (cada envio é uma avaliação nova).
 */
test('serviço social: enviar pela Auditoria e conferir no SAE', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const em = lerInternacao() as InternacaoAtual;
  conferirAmbiente(em);
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);
  expect(em, 'Nenhuma internação em uso: rode "Criar internação" primeiro.').not.toBeNull();
  expect(em.internacaoIdAuditoria, 'A criação não chegou aos detalhes na Auditoria: finalize esta internação e crie outra.').toBeTruthy();

  const auditoria = new AuditoriaPage(page);
  const sae = new SaePage(page);
  // marcador único por envio (a mesma internação pode ter várias avaliações)
  const agora = new Date();
  const marcador = `${em.codigo}.${p2(agora.getHours())}${p2(agora.getMinutes())}`;
  const dados = dadosServicoSocial(marcador);
  const marcadorLista = `SS E2E ${marcador}`;
  anotar('codigo-internacao', em.codigo);
  anotar('internacao-auditoria', em.internacaoIdAuditoria!);
  anotar('servico-social', marcadorLista);

  await test.step('1. Auditoria: abrir a avaliação de serviço social da internação', async () => {
    const linha = await auditoria.localizarPorId(em.internacaoIdAuditoria!);
    await auditoria.abrirFormulario(linha, 'ServicoSocial', 'AvaliacaoAssSocial');
  });

  await test.step('2. Auditoria: preencher e enviar a avaliação', async () => {
    await auditoria.preencherServicoSocial(dados);
    const { mensagem } = await auditoria.enviarFormulario('ActionEnviarAvaliacaoServicoSocial', em.internacaoIdAuditoria!);
    if (mensagem) anotar('retorno-envio', mensagem.slice(0, 160));
    atualizarInternacao({ servicoSocial: [...(em.servicoSocial ?? []), marcadorLista] });
  });

  await test.step('3. SAE: conferir a avaliação enviada', async () => {
    // Visualizar da internação → seção "Serviço social" → detalhe da avaliação
    const { criacao, protocoloCrm } = await sae.conferirServicoSocial(em.atendimento, dados, marcadorLista);
    anotar('sae-servico-social', `registrada em ${criacao}, ${dados.respostas.length} respostas conferidas`);
    // O SAE repassa a avaliação ao CRM (Dynamics). Falha lá não é do envio da
    // Auditoria: registra como aviso em vez de reprovar o fluxo.
    if (/erro/i.test(protocoloCrm)) anotar('aviso', `Protocolo CRM com erro: ${protocoloCrm.slice(0, 140)}`);
    else anotar('protocolo-crm', protocoloCrm || '(vazio)');
  });
});

import { test, expect } from '@playwright/test';
import { AuditoriaPage } from '../pages/auditoria.page';
import { salvarSessao, AMBIENTE_ATUAL, NOME_AMBIENTE } from '../support/ambiente';
import { anotar } from '../support/fluxo';

test.afterEach(async ({ page }) => {
  await salvarSessao(page).catch(() => {});
});

/**
 * Conferência (só leitura): em cada filter chip da tela inicial da Auditoria,
 * o número do chip tem que bater com a quantidade de internações listadas
 * (todas as páginas). Não usa nem altera a internação em uso.
 */
test('conferir filter chips da Auditoria', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  anotar('ambiente', NOME_AMBIENTE[AMBIENTE_ATUAL]);
  const auditoria = new AuditoriaPage(page);

  await test.step('0. Auditoria: tela inicial do hospital de teste, sem filtros', async () => {
    anotar('hospital', await auditoria.abrirInicioSemFiltros());
  });

  // Confere um chip; a falha é "soft" para os demais chips também serem conferidos.
  const conferir = async (rotulo: string) => {
    const r = await auditoria.conferirChip(rotulo);
    const rodape = r.totalRodape === null ? '' : `, rodapé ${r.totalRodape}`;
    const ok = r.contadas === r.numeroChip && r.distintas === r.contadas && (r.totalRodape ?? r.numeroChip) === r.numeroChip;
    anotar(ok ? 'chip-ok' : 'chip-divergente', `${rotulo}: chip ${r.numeroChip}, listadas ${r.contadas}${rodape}${ok ? ' (OK)' : ''}`);
    expect.soft(r.contadas, `"${rotulo}": internações listadas = número do chip`).toBe(r.numeroChip);
    expect.soft(r.distintas, `"${rotulo}": internação repetida entre páginas`).toBe(r.contadas);
    if (r.totalRodape !== null) expect.soft(r.totalRodape, `"${rotulo}": total do rodapé = número do chip`).toBe(r.numeroChip);
  };

  await test.step('1. Todos', () => conferir('Todos'));
  await test.step('2. Elegíveis desosp', () => conferir('Elegíveis desosp'));
  await test.step('3. CID inespecífico', () => conferir('CID inespecífico'));
  await test.step('4. Alta UTI', () => conferir('Alta UTI'));
  await test.step('5. 3+ dias UTI', () => conferir('3+ dias UTI'));
  await test.step('6. Alta Ultrapassada', () => conferir('Alta Ultrapassada'));
  await test.step('7. Solic. Avaliação hospitalista', () => conferir('Solic. Avaliação hospitalista'));
});

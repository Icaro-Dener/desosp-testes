import { test, expect } from '@playwright/test';
import { TransicaoPage, EstadoDesosp } from '../pages/transicao.page';

/** Linha na tabela "Resultado" do painel / anotação do relatório HTML. */
export const anotar = (tipo: string, descricao: string) => test.info().annotations.push({ type: tipo, description: descricao });

/** Lê o estado no Transição até a condição ser verdadeira (as integrações não são instantâneas). */
export async function aguardarEstado(
  transicao: TransicaoPage,
  idInternacaoSae: string,
  cond: (e: EstadoDesosp) => boolean,
  msg: string,
  timeout = 5 * 60_000,
): Promise<EstadoDesosp> {
  let ultimo: EstadoDesosp = {};
  await expect
    .poll(async () => cond((ultimo = await transicao.abrirELerEstado(idInternacaoSae))), { message: msg, timeout, intervals: [10_000, 20_000] })
    .toBe(true);
  return ultimo;
}

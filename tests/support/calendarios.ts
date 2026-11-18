import { Locator, Page, expect } from '@playwright/test';

/**
 * Flatpickr (OutSystems UI). O input visível é somente leitura, então a data é
 * escolhida clicando no calendário, como o usuário faz.
 * `inputVisivel` é o campo que o usuário vê (o "fp_..." ou o irmão do input[type=date]).
 */
export async function escolherDataFlatpickr(page: Page, inputVisivel: Locator, alvo: Date) {
  await inputVisivel.click();
  const cal = page.locator('.flatpickr-calendar.open');
  await expect(cal).toBeVisible();
  for (let i = 0; i < 12; i++) {
    const mes = Number(await cal.locator('.flatpickr-monthDropdown-months').inputValue());
    const ano = Number(await cal.locator('.cur-year').inputValue());
    if (mes === alvo.getMonth() && ano === alvo.getFullYear()) break;
    await cal.locator('.flatpickr-next-month').click();
  }
  await cal
    .locator('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)', { hasText: new RegExp(`^${alvo.getDate()}$`) })
    .click();
  const p2 = (n: number) => String(n).padStart(2, '0');
  await expect(inputVisivel).toHaveValue(`${p2(alvo.getDate())}/${p2(alvo.getMonth() + 1)}/${alvo.getFullYear()}`);
}

/**
 * Limites (minDate/maxDate) configurados no flatpickr de um campo. A instância
 * fica no input escondido (id sem o "fp_") ou no próprio input visível.
 */
export async function limitesFlatpickr(inputVisivel: Locator): Promise<{ min: Date | null; max: Date | null }> {
  const r = await inputVisivel.evaluate((e: any) => {
    const vizinho = [...(e.parentElement?.querySelectorAll('input') ?? [])].find((x: any) => x._flatpickr) as any;
    const fp = e._flatpickr || (document.getElementById(e.id.replace(/^fp_/, '')) as any)?._flatpickr || vizinho?._flatpickr;
    const t = (d: any) => (d ? new Date(d).getTime() : null);
    return fp ? { min: t(fp.config.minDate), max: t(fp.config.maxDate) } : { min: null, max: null };
  });
  return { min: r.min ? new Date(r.min) : null, max: r.max ? new Date(r.max) : null };
}

/**
 * Calendário RichFaces do SAE: abre pelo ícone e clica num dia específico
 * (volta um mês pelo "<" do cabeçalho quando a data é do mês anterior).
 */
export async function escolherDiaRichCalendar(page: Page, idBase: string, alvo: Date) {
  const hoje = new Date();
  await page.locator(`[id="${idBase}PopupButton"]`).click();
  const cal = page.locator(`[id="${idBase}"]`);
  const mesesAtras = (hoje.getFullYear() - alvo.getFullYear()) * 12 + hoje.getMonth() - alvo.getMonth();
  for (let i = 0; i < mesesAtras; i++) {
    await cal.locator('td, div').filter({ hasText: /^\s*[<‹]\s*$/ }).last().click();
  }
  await cal.locator('td.rich-calendar-cell:not(.rich-calendar-boundary-dates)', { hasText: new RegExp(`^${alvo.getDate()}$`) }).click();
  const p2 = (n: number) => String(n).padStart(2, '0');
  await expect(page.locator(`[id="${idBase}InputDate"]`)).toHaveValue(`${p2(alvo.getDate())}/${p2(alvo.getMonth() + 1)}/${alvo.getFullYear()}`);
}

/** Calendário RichFaces do SAE: abre pelo ícone e clica no dia de hoje. */
export async function escolherHojeRichCalendar(page: Page, idBase: string) {
  await page.locator(`[id="${idBase}PopupButton"]`).click();
  await page.locator(`[id="${idBase}"] td.rich-calendar-today`).click();
  await expect(page.locator(`[id="${idBase}InputDate"]`)).not.toHaveValue('');
}

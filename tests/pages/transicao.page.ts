import { Page, Locator, expect } from '@playwright/test';
import { URLS } from '../support/ambiente';
import { escolherDataFlatpickr } from '../support/calendarios';
import { MASSA, APROVACAO, CONFIRMACAO } from '../support/dados';

export const COLUNAS = {
  auditoria: 'Em análise pela Auditoria Clínica',
  viverBem: 'Em análise pelo Viver Bem',
  concluida: 'Análise concluída',
  atendimento: 'Em atendimento', // última coluna
} as const;
type Coluna = (typeof COLUNAS)[keyof typeof COLUNAS];

/** Estado do registro: `sae` vem da API do SAE (via ODC); `local` é o kanban do ODC. */
export interface EstadoDesosp {
  sae?: { Id_internacao_desosp: string; Id_internacao: string; Id_hospital: string; data_prevista_alta: string; Data_encerramento: string; Hora_saida: string; Tipo_encerramento: string };
  local?: { ColunaDesosp: string; StatusDesosp: string };
}

export class TransicaoPage {
  constructor(private readonly page: Page) {}

  /**
   * Abre a Home e lê o estado do registro pelas mesmas chamadas que a tela usa
   * (DataActionObterDados = desosps do SAE; GetPacientesByPacienteDesospId = coluna/status).
   * Não loga o corpo: as respostas trazem dados pessoais e tokens.
   */
  async abrirELerEstado(idInternacaoSae: string): Promise<EstadoDesosp> {
    const page = this.page;
    const rDados = page.waitForResponse((r) => r.url().includes('/Home/Home/DataActionObterDados'), { timeout: 90_000 });
    const rLocal = page.waitForResponse((r) => r.url().includes('GetPacientesByPacienteDesospId'), { timeout: 90_000 });
    await page.goto(URLS.transicaoHome, { waitUntil: 'networkidle' });
    const lista: any[] = (await (await rDados).json()).data.OutPacientes.List;
    const sae = lista.find((p) => String(p.Id_internacao) === String(idInternacaoSae));
    let local: EstadoDesosp['local'];
    if (sae) {
      const locais: any[] = (await (await rLocal).json()).data.List.List.map((x: any) => x.Pacientes);
      const l = locais.find((p) => p.PacienteDesospId === sae.Id_internacao_desosp);
      if (l) local = { ColunaDesosp: l.ColunaDesosp, StatusDesosp: l.StatusDesosp };
    }
    return { sae, local };
  }

  /**
   * Filtro do canto superior direito (funil): limpa os filtros e busca pelo nome do
   * paciente de teste. Os checkboxes de status/etiquetas ficam desmarcados (= todos).
   * O hospital é conferido depois pelo texto do card.
   */
  async filtrarPorPaciente() {
    const page = this.page;
    const nome = page.locator('[id$="-Input_PalavraChave"]');
    // Painel lateral: fechado fica fora da tela, mas continua "visível" no DOM
    // Com a Home ainda carregando, o clique no funil pode não abrir: tenta de novo
    const abrir = async () => {
      await expect(async () => {
        const aberto = await nome.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; });
        if (!aberto) await page.locator('[id$="-MostrarFiltros"]').click();
        await expect(nome).toBeInViewport({ timeout: 5_000 });
      }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
    };
    await abrir();
    // "Limpar" recarrega o quadro inteiro (centenas de cards): só quando há OUTROS filtros
    // contador "Filtros (N)" do cabeçalho do painel (o texto é quebrado em mais de um elemento)
    const ativos = await nome.evaluate((e) => {
      let p: HTMLElement | null = e as HTMLElement;
      while (p && !/Filtros\s*\(\d+\)/.test(p.innerText ?? '')) p = p.parentElement;
      return Number(p?.innerText.match(/Filtros\s*\((\d+)\)/)?.[1] ?? 0);
    });
    const soNome = ativos === 1 && (await nome.inputValue()) === MASSA.pacienteNomeTransicao;
    if (ativos > 0 && !soNome) {
      await page.locator('[id$="-BtnLimparFiltros"]').click({ timeout: 90_000 });
      await page.waitForLoadState('networkidle');
      await abrir(); // "Limpar" pode fechar o painel
    }
    await nome.fill(MASSA.pacienteNomeTransicao);
    await page.locator('[id$="-BtnAplicarFiltros2"]').click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[id$="-PacienteGeral"]', { hasText: MASSA.pacienteNomeTransicao }).first()).toBeVisible({ timeout: 60_000 });
  }

  private async colunaDoCard(card: Locator): Promise<string> {
    return card.evaluate((e, nomes) => {
      let x: HTMLElement | null = e as HTMLElement;
      while (x && ![...x.children].some((k) => nomes.includes(((k as HTMLElement).innerText ?? '').split('\n')[0].trim()))) x = x.parentElement;
      const t = x && [...x.children].map((k) => ((k as HTMLElement).innerText ?? '').split('\n')[0].trim()).find((s) => nomes.includes(s));
      return t ?? '?';
    }, Object.values(COLUNAS) as string[]);
  }

  /** Blocos (card + menu ⋮) do paciente de teste, no hospital de teste, numa coluna. */
  private async candidatos(coluna: Coluna): Promise<Locator[]> {
    await this.filtrarPorPaciente();
    const cards = this.page.locator('[id$="-PacienteGeral"]', { hasText: MASSA.pacienteNomeTransicao }).filter({ visible: true });
    const out: Locator[] = [];
    for (let i = 0; i < (await cards.count()); i++) {
      const c = cards.nth(i);
      if ((await c.innerText()).includes(MASSA.hospitalTransicao) && (await this.colunaDoCard(c)) === coluna) out.push(c.locator('xpath=..'));
    }
    return out;
  }

  /**
   * Card desta execução numa coluna. Se houver mais de um card do paciente de
   * teste (execuções anteriores ficam na última coluna), abre "Ver detalhes" de
   * cada um: a página é PacienteDetalhe?InDesospId=<id da desospitalização no SAE>.
   */
  async cardNaColuna(coluna: Coluna, idDesosp: string): Promise<Locator> {
    let lista = await this.candidatos(coluna);
    expect(lista.length, `card de ${MASSA.pacienteNomeTransicao} na coluna "${coluna}"`).toBeGreaterThan(0);
    if (lista.length === 1) {
      // um só: confirma que é o desta execução pela página de detalhe
      if ((await this.idDoCard(lista[0])) === idDesosp) return (await this.candidatos(coluna))[0];
      throw new Error(`o único card na coluna "${coluna}" não é o desta execução (${idDesosp})`);
    }
    for (let i = 0; i < lista.length; i++) {
      lista = await this.candidatos(coluna); // a Home é recarregada ao voltar do detalhe
      if ((await this.idDoCard(lista[i])) === idDesosp) return (await this.candidatos(coluna))[i];
    }
    throw new Error(`nenhum card na coluna "${coluna}" é da desospitalização ${idDesosp}`);
  }

  /** Abre "Ver detalhes", lê o InDesospId da URL e volta para a Home. */
  private async idDoCard(bloco: Locator): Promise<string> {
    await this.clicarNoMenu(bloco, 'Ver detalhes');
    await this.page.waitForURL(/PacienteDetalhe\?InDesospId=/);
    const id = new URL(this.page.url()).searchParams.get('InDesospId') ?? '';
    const recarga = this.page.waitForResponse((r) => r.url().includes('/Home/Home/DataActionObterDados'), { timeout: 90_000 });
    await this.page.getByText('Voltar').first().click();
    await this.page.waitForURL(/\/TransicaoCuidado\/Home/);
    await recarga; // Home recarrega os cards ao voltar
    await this.page.waitForLoadState('networkidle');
    return id;
  }

  private async clicarNoMenu(bloco: Locator, item: string) {
    const link = bloco.locator('a', { hasText: new RegExp(`^\\s*${item}\\s*$`) });
    if (!(await link.isVisible())) await bloco.locator('.osui-overflow-menu__trigger').click();
    await link.click();
  }

  async itensDoMenu(bloco: Locator) {
    return (await bloco.locator('.osui-overflow-menu nav a, a.OSFillParent').allTextContents()).map((t) => t.trim()).filter(Boolean);
  }

  private modal(texto: string) {
    return this.page.locator('[class*=popup], [role=dialog], [class*=modal]').filter({ hasText: texto }).filter({ visible: true }).last();
  }

  /** Confere pelo endereço (que leva o código da execução) que o modal é deste registro. */
  private async conferirRegistro(modal: Locator, marcador: string) {
    await expect(modal.locator('[id$="-Input_Endereco"]').first()).toHaveValue(new RegExp(marcador));
  }

  async atribuirAMim(bloco: Locator) {
    await this.clicarNoMenu(bloco, 'Atribuir a mim');
    const dlg = this.modal('Deseja atribuir este paciente a você?');
    await dlg.locator('button', { hasText: 'Atribuir a mim' }).click();
    await expect(dlg).toBeHidden();
    await this.page.waitForLoadState('networkidle');
  }

  private async escolherDatas(modal: Locator, inicio: Date, fim: Date) {
    const datas = modal.locator('input[type=date][id$="-Input_Data"]');
    await escolherDataFlatpickr(this.page, datas.nth(0).locator('xpath=following-sibling::input[1]'), inicio);
    await escolherDataFlatpickr(this.page, datas.nth(1).locator('xpath=following-sibling::input[1]'), fim);
  }

  async aprovar(bloco: Locator, marcador: string) {
    await this.clicarNoMenu(bloco, 'Aprovar');
    const modal = this.modal('Formulário da Solicitação Atendimento Empresas Terceiras');
    await this.conferirRegistro(modal, marcador);
    const sel = modal.locator('select[id$="-Dropdown_TituloTipoOpcoes"]');
    await sel.nth(0).selectOption({ label: APROVACAO.nucleo });
    await modal.locator('input[id$="-InputTexto"]').first().fill(APROVACAO.medico);
    await sel.nth(1).selectOption({ label: APROVACAO.motivo });
    await sel.nth(2).selectOption({ label: APROVACAO.empresa });
    await sel.nth(3).selectOption({ label: APROVACAO.especialidade });
    await this.escolherDatas(modal, new Date(), new Date(Date.now() + 7 * 86_400_000));
    await sel.nth(4).selectOption({ label: APROVACAO.dataCorte });
    await modal.locator('textarea[id$="-TextArea_Resposta"]').fill(APROVACAO.evolucao);
    await modal.locator('[id$="-Aprovarsolicitacao"]').click();
    await expect(modal).toBeHidden({ timeout: 90_000 });
  }

  async confirmar(bloco: Locator, marcador: string) {
    await this.clicarNoMenu(bloco, 'Confirmar');
    const modal = this.modal('Formulário de Confirmação Atenção Domiciliar');
    await expect(modal.locator('[id$="-ConfirmarDesosp"]')).toBeVisible({ timeout: 60_000 });
    await this.conferirRegistro(modal, marcador);
    await this.escolherDatas(modal, new Date(), new Date(Date.now() + 7 * 86_400_000));
    await modal.locator('select[id$="-Dropdown_TituloTipoOpcoes"]').first().selectOption({ label: CONFIRMACAO.dataCorte });
    await modal.locator('textarea[id$="-TextArea_Resposta"]').fill(CONFIRMACAO.evolucao);
    const resp = this.page.waitForResponse((r) => r.url().includes('ActionSalvarEnviarFormulario'), { timeout: 90_000 });
    await modal.locator('[id$="-ConfirmarDesosp"]').click();
    expect((await resp).status()).toBe(200);
    await expect(modal).toBeHidden({ timeout: 90_000 });
  }
}

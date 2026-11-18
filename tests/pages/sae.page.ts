import { Page, Locator, expect } from '@playwright/test';
import { AMBIENTE, salvarSessao } from '../support/ambiente';
import { escolherHojeRichCalendar, escolherDiaRichCalendar } from '../support/calendarios';
import { MASSA, p2, hojeBR, dataExtenso, dadosServicoSocial, dadosHospitalista, dadosVisita, Inconformidade, resumoInconformidadeSae } from '../support/dados';

// SAE (JSF/RichFaces). Ids com ":" precisam de [id="..."].
const $ = (id: string) => `[id="${id}"]`;

export class SaePage {
  constructor(private readonly page: Page) {}

  private get url() {
    return new URL('secure/operadora/auditoria/acompanhamento/internacao', AMBIENTE.sae).href;
  }

  async abrirAcompanhamento() {
    await this.page.goto(this.url, { waitUntil: 'networkidle' });
    await this.garantirLogin();
    await expect(this.page.locator($('mainForm:adicionarButton'))).toBeVisible();
  }

  /**
   * A sessão do SAE expira e o login tem reCAPTCHA (não automatizável).
   * Se cair na tela de login, espera o usuário entrar na janela do teste e
   * salva a sessão renovada para as próximas execuções.
   */
  private async garantirLogin() {
    // Logado = está em /secure/... (a página logada também tem inputs de senha
    // escondidos, do "alterar senha" do menu, então não serve para detectar login)
    if (new URL(this.page.url()).pathname.startsWith('/secure/')) return;
    // Sem janela (navegador oculto) não há onde logar: para logo, em vez de esperar 10 min
    if (process.env.PAINEL_OCULTO === '1')
      throw new Error('Sessão do SAE expirada. Clique na engrenagem do painel e em "Renovar login" e rode o fluxo de novo.');
    console.log('\n>>> Sessão do SAE expirada: faça o login no SAE na janela do navegador (até 10 min).');
    await this.page.waitForURL((u) => u.pathname.startsWith('/secure/'), { timeout: 10 * 60_000 });
    await this.page.waitForLoadState('networkidle');
    await salvarSessao(this.page);
    await this.page.goto(this.url, { waitUntil: 'networkidle' });
  }

  /** Autocomplete RichFaces: digita como usuário e clica na sugestão. */
  private async autocomplete(campo: Locator, termo: string, sugestao: string | RegExp) {
    await campo.click();
    await campo.fill('');
    await campo.pressSequentially(termo, { delay: 80 });
    const item = this.page.locator('.richfaces_suggestionEntry').filter({ visible: true }).filter({ hasText: sugestao }).first();
    await item.click({ timeout: 30_000 });
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Campo de hora com máscara "__:__": limpar, levar o cursor ao início e digitar
   * só os números. Com o clique no meio do campo, os dígitos caem depois do ":".
   */
  private async digitarHora(campo: Locator, digitos: string) {
    await campo.click();
    await campo.fill('');
    await campo.press('Home');
    await campo.pressSequentially(digitos, { delay: 80 });
    await expect(campo).toHaveValue(`${digitos.slice(0, 2)}:${digitos.slice(2)}`);
  }

  /**
   * Cria a internação pela tela e devolve o Nº de Atendimento gerado pelo SAE.
   * dataInternacao: hoje por padrão; os fluxos separados usam uma data retroativa
   * (algumas telas da Auditoria só aceitam datas a partir do dia seguinte à internação).
   */
  async criarInternacao(codigo: string, dataInternacao = new Date()): Promise<{ atendimento: string }> {
    const page = this.page;
    await page.locator($('mainForm:adicionarButton')).click();
    await page.waitForLoadState('networkidle');

    await this.autocomplete(page.locator($('formAddUpdate:prestador')), MASSA.prestadorBusca, MASSA.prestadorCodigo);
    await this.autocomplete(page.locator($('formAddUpdate:profissional')), MASSA.medicoBusca, /CRM/);
    await this.autocomplete(page.locator($('formAddUpdate:paciente')), MASSA.pacienteBusca, MASSA.pacienteBusca);

    await expect(page.locator($('formAddUpdate:pacienteInternadoDataPopupButton'))).toBeVisible();
    const atendimento = (await page.locator('body').innerText()).match(/N[º°] Atendimento\s+(\d+)/)?.[1];
    expect(atendimento, 'Nº de Atendimento exibido no cabeçalho').toBeTruthy();

    await this.autocomplete(page.locator($('formAddUpdate:cidInternacao')), MASSA.cidBusca, MASSA.cidCodigo);
    await escolherDiaRichCalendar(page, 'formAddUpdate:pacienteInternadoData', dataInternacao);

    // Hora com máscara __:__ : digitar só os números. Um pouco no passado (a hora vale para qualquer dia).
    const h = new Date(Math.max(Date.now() - 5 * 60_000, new Date().setHours(0, 0, 0, 0)));
    const hora = page.locator($('formAddUpdate:pacienteInternadoHora'));
    await this.digitarHora(hora, `${p2(h.getHours())}${p2(h.getMinutes())}`);
    const cod = page.locator($('formAddUpdate:CodigoPrestador'));
    await cod.click(); // blur da hora dispara ajax e re-renderiza o form
    await page.waitForLoadState('networkidle');
    await cod.fill(codigo);
    await expect(hora).toHaveValue(`${p2(h.getHours())}:${p2(h.getMinutes())}`);

    await page.locator('a', { hasText: 'Salvar' }).filter({ visible: true }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Internação criada com sucesso').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    return { atendimento: atendimento! };
  }

  private linhasResultado() {
    return this.page.locator('table.rich-table > tbody > tr');
  }

  /** Aba "Procura por internações" com "Unidade de atendimento = Todas". */
  private async abrirProcura() {
    const page = this.page;
    await this.abrirAcompanhamento();
    await page.getByRole('link', { name: 'Procura por internações', exact: true }).filter({ visible: true }).first().click();
    // A aba é trocada por ajax: espera o formulário dela (campo de paciente só existe aqui)
    await expect(page.locator($('mainForm:pacientePesquisa'))).toBeVisible();
    await page.waitForLoadState('networkidle');
    // O filtro padrão "Intercâmbio custo" esconde internações próprias
    await page.locator($('mainForm:pesquisa-string-internacao-intercambio')).selectOption({ label: 'Todas' });
  }

  private async pesquisar() {
    await this.page.locator($('mainForm:pesquisaButton')).click();
    // pesquisa do SAE é lenta: espera a tabela ou o aviso de vazio
    await expect(this.linhasResultado().first().or(this.page.getByText('Nenhuma internação encontrada').filter({ visible: true })))
      .toBeVisible({ timeout: 150_000 });
  }

  /** Procura por internações pelo Nº de Atendimento e devolve a linha do resultado. */
  async buscarPorAtendimento(atendimento: string): Promise<Locator> {
    await this.abrirProcura();
    await this.page.locator($('mainForm:pesquisa-param-codigo8')).fill(atendimento);
    await this.pesquisar();
    const linha = this.linhasResultado().filter({ hasText: atendimento }).first();
    await expect(linha).toBeVisible();
    return linha;
  }

  /**
   * Ação "Finalizar" (engrenagem da linha): registra o encerramento (tipo, data,
   * hora) e finaliza a análise, tirando a internação da fila de pendências.
   */
  private async finalizarLinha(linha: Locator, observacao: string): Promise<{ hora: string }> {
    const page = this.page;
    await linha.locator('img[id$=":acoesInternacao"]').click();
    await page.locator('[id$=":finalizarLink"]').filter({ visible: true }).first().click();
    const modal = page.locator($('finalizarInternacaoModalPanelContentDiv'));
    await expect(modal).toBeVisible();

    await modal.locator('select[id$=":TipoEncerramento"]').selectOption({ label: MASSA.tipoEncerramento });
    await page.waitForLoadState('networkidle');
    const botaoCal = modal.locator('img[id$=":DataSaidaPopupButton"]');
    await escolherHojeRichCalendar(page, (await botaoCal.getAttribute('id'))!.replace(/PopupButton$/, ''));
    const agora = new Date();
    const hora = `${p2(agora.getHours())}:${p2(agora.getMinutes())}`;
    await this.digitarHora(modal.locator('input[id$=":pacienteInternadoHoraEncerramento"]'), hora.replace(':', ''));
    await modal.locator('textarea[id$=":finalizarInternacaoObservacao"]').fill(observacao);

    await modal.locator('input[id$=":finalizarInternacaoModalPanelButton"]').click();
    await expect(page.getByText('Internação finalizada com sucesso').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(modal).toBeHidden();
    return { hora };
  }

  /**
   * Abre a internação em modo leitura (menu da linha → "Visualizar"). O menu
   * de contexto às vezes não abre no 1º clique: tenta de novo.
   */
  async visualizarInternacao(atendimento: string) {
    const page = this.page;
    const linha = await this.buscarPorAtendimento(atendimento);
    await page.waitForLoadState('networkidle');
    const visualizar = page.locator('.rich-menu-item', { hasText: /^\s*Visualizar\s*$/ }).filter({ visible: true });
    await expect(async () => {
      await linha.locator('img[id$=":acoesInternacao"]').click();
      await expect(visualizar).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] });
    await visualizar.click();
    await page.waitForLoadState('networkidle');
  }

  /**
   * Confere no Visualizar da internação uma avaliação enviada pela Auditoria:
   * abre a seção (ex.: "Serviço social 2", "Avaliações Hospitalistas 1"), acha a
   * linha pelo marcador (origem, data) e, ao selecioná-la, confere no detalhe cada
   * par "pergunta resposta" e os textos livres. Só leitura.
   */
  async conferirAvaliacao(atendimento: string, o: {
    secao: RegExp; origem: string; marcador: string;
    respostas: { perguntaSae: string; respostaSae: string }[]; textos: string[];
  }) {
    const page = this.page;
    await this.visualizarInternacao(atendimento);
    await page.locator('a', { hasText: o.secao }).filter({ visible: true }).first().click();
    await page.waitForLoadState('networkidle');

    // tr mais interno com o marcador (colunas: origem, responsável, criação, observação, protocolo CRM)
    const registro = page.locator('tr').filter({ hasText: o.marcador }).filter({ hasNot: page.locator('tr') });
    await expect(registro, `avaliação "${o.marcador}" no SAE`).toHaveCount(1, { timeout: 60_000 });
    const cols = (await registro.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    expect(cols[0], 'origem').toBe(o.origem);
    expect(cols.join(' | '), 'data de criação').toContain(hojeBR());

    // detalhe: "Clique aqui para selecionar a visita"
    await registro.locator('input[type=image], a, img').last().click();
    await page.waitForLoadState('networkidle');
    const painel = page.locator('[id*="panelNovo"]').filter({ visible: true }).filter({ hasText: o.marcador }).last();
    await expect(painel, 'detalhe da avaliação (panelNovo…)').toBeVisible({ timeout: 30_000 });
    const detalhe = (await painel.innerText()).replace(/\s+/g, ' ');
    const divergencias = o.respostas
      .filter((r) => !detalhe.includes(`${r.perguntaSae} ${r.respostaSae}`))
      .map((r) => `${r.perguntaSae}: esperado "${r.respostaSae}"`);
    // na falha, mostra o detalhe (só respostas do teste) para ajustar o mapeamento
    expect(divergencias, `respostas no SAE iguais às enviadas. Detalhe do SAE: ${detalhe.slice(0, 1500)}`).toEqual([]);
    for (const t of o.textos) expect(detalhe, 'texto livre no detalhe').toContain(t);
    return { cols, detalhe };
  }

  async conferirServicoSocial(atendimento: string, d: ReturnType<typeof dadosServicoSocial>, marcador: string) {
    const { cols } = await this.conferirAvaliacao(atendimento, {
      secao: /^\s*Servi[cç]o social\s*\d*\s*$/i, origem: 'Serviço Social', marcador,
      respostas: d.respostas, textos: [`Observação hospital ${d.observacaoHospital}`, d.observacao],
    });
    return { criacao: cols[2], protocoloCrm: cols[4] ?? '' };
  }

  /**
   * Confere no Visualizar → "Avaliações Hospitalistas" a avaliação enviada.
   * A lista só tem Responsável e Criação: abre as linhas de hoje até achar a
   * que tem o marcador na revisão do caso; aí confere rádios e campos. Só leitura.
   */
  async conferirHospitalista(atendimento: string, d: ReturnType<typeof dadosHospitalista>, marcador: string) {
    const page = this.page;
    await this.visualizarInternacao(atendimento);
    await page.locator('a', { hasText: /^\s*Avalia[cç][oõ]es Hospitalistas\s*\d*\s*$/i }).filter({ visible: true }).first().click();
    await page.waitForLoadState('networkidle');

    // Linhas: só Responsável e Criação. Selecionar uma linha redesenha a tabela
    // (o índice muda), então cada linha é localizada pelo horário de criação.
    const linhas = page.locator('[id$="panelTodosAvaliacaoHospitalista"] tr')
      .filter({ has: page.locator('input[type=image]') }).filter({ hasNot: page.locator('tr') });
    await expect(linhas.filter({ hasText: hojeBR() }).first(), 'avaliação hospitalista de hoje no SAE').toBeVisible({ timeout: 60_000 });
    const horarios = [...new Set((await linhas.allInnerTexts())
      .map((t) => t.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)?.[0] ?? '')
      .filter((h) => h.startsWith(hojeBR())))]
      .sort().reverse(); // mais recente primeiro (a desta execução, em geral)
    const painel = page.locator('[id$="panelNovaAvaliacaoHospitalista"]').first();
    const revisao = painel.locator('[id$=":descricaoRevisaoCaso"]');
    let criacao = '';
    for (const h of horarios) {
      const antes = await revisao.inputValue().catch(() => '');
      await linhas.filter({ hasText: h }).first().locator('input[type=image]').last().click();
      await page.waitForLoadState('networkidle');
      // espera o painel trocar de avaliação (senão compara com a anterior)
      await expect.poll(() => revisao.inputValue().catch(() => ''), { timeout: 30_000 }).not.toBe(antes);
      if ((await revisao.inputValue()).includes(marcador)) { criacao = h; break; }
    }
    expect(criacao, `avaliação "${marcador}" entre as de hoje no SAE (${horarios.join(', ')})`).toBeTruthy();

    // rádios marcados: name do grupo → rótulo
    const marcados: Record<string, string> = await painel.locator('input[type=radio]:checked').evaluateAll((els) => Object.fromEntries(els.map((e) => [
      (e as HTMLInputElement).name.replace(/^.*:/, ''),
      (document.evaluate('following::label[1]', e, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue?.textContent ?? '').trim(),
    ])));
    const texto = (await painel.innerText()).replace(/\s+/g, ' ');
    const divergencias = [...d.respostas, d.recomendacao.adesao]
      .filter((r) => (r.saeRadio ? marcados[r.saeRadio] !== r.respostaSae : !texto.includes(`${r.perguntaSae} ${r.respostaSae}`)))
      .map((r) => `${r.perguntaSae}: esperado "${r.respostaSae}", SAE "${r.saeRadio ? marcados[r.saeRadio] ?? 'nenhum' : '(texto)'}"`);
    expect(divergencias, 'respostas no SAE iguais às enviadas').toEqual([]);

    const valor = (sufixo: string) => painel.locator(`[id$=":${sufixo}"]`).first();
    await expect(revisao, 'revisão do caso').toHaveValue(d.revisaoCaso);
    await expect(valor('descricaoRecomendacaoAoMedicoAssistente'), 'descrição da recomendação').toHaveValue(d.recomendacao.descricao);
    await expect(valor('dataVisitaInputDate'), 'data da visita').toHaveValue(hojeBR());
    await expect(valor('dataAltaEstimadaInputDate'), 'data de alta estimada').toHaveValue(d.dataAltaEstimadaBR);
    await expect(painel.locator(`input[type=text][value="${d.diasAdicionais}"]`).first(), 'dias adicionais').toBeAttached();
    return { criacao };
  }

  /**
   * Confere no Visualizar → "Visitas" a avaliação de visita enviada: a linha
   * (origem Enfermagem, data, observação com o marcador) e, ao selecioná-la,
   * os textos "pergunta resposta", as caixas e o rádio marcados. Só leitura.
   */
  async conferirVisita(atendimento: string, d: ReturnType<typeof dadosVisita>, marcador: string) {
    const page = this.page;
    await this.visualizarInternacao(atendimento);
    await page.locator('a', { hasText: /^\s*Visitas\s*\d*\s*$/i }).filter({ visible: true }).first().click();
    await page.waitForLoadState('networkidle');

    // colunas: origem, responsável, criação, observação
    const registro = page.locator('tr').filter({ hasText: marcador }).filter({ hasNot: page.locator('tr') });
    await expect(registro, `visita "${marcador}" no SAE`).toHaveCount(1, { timeout: 60_000 });
    const cols = (await registro.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    expect(cols[0], 'origem').toBe('Enfermagem');
    expect(cols.join(' | '), 'data de criação').toContain(hojeBR());
    const criacao = cols.find((c) => /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(c)) ?? '';

    await registro.locator('input[type=image]').last().click();
    await page.waitForLoadState('networkidle');
    const painel = page.locator('[id$=":panelVisitas"]').first();
    await expect(painel, 'detalhe da visita').toContainText(d.observacao, { timeout: 30_000 });
    await expect(painel, 'detalhe da visita').toContainText('Evolução', { timeout: 30_000 });
    const texto = (await painel.innerText()).replace(/\s+/g, ' ');
    const marcados = await painel.locator('input:checked').evaluateAll((els) => els.map((e) => ({
      tipo: (e as HTMLInputElement).type,
      nome: (e as HTMLInputElement).name.replace(/^.*:/, ''),
      rotulo: (document.evaluate('following::label[1]', e, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue?.textContent ?? '').trim(),
    })));

    const divergencias: string[] = [];
    if (!texto.includes(d.acomodacaoSae)) divergencias.push(`esperado "${d.acomodacaoSae}"`);
    for (const r of d.radios) {
      const ok = r.saeRadio
        ? marcados.some((m) => m.tipo === 'radio' && m.nome === r.saeRadio && m.rotulo === r.respostaSae)
        : texto.includes(`${r.perguntaSae} ${r.respostaSae}`);
      if (!ok) divergencias.push(`${r.perguntaSae}: esperado "${r.respostaSae}"`);
    }
    const caixasSae = marcados.filter((m) => m.tipo === 'checkbox').map((m) => m.rotulo).sort();
    const caixasEsperadas = d.caixas.map((c) => c.opcao).sort();
    if (JSON.stringify(caixasSae) !== JSON.stringify(caixasEsperadas)) divergencias.push(`Quadro clínico: esperado [${caixasEsperadas}], SAE [${caixasSae}]`);
    for (const e of d.encaminhamentos) if (!texto.includes(`Encaminhamento ${e}`)) divergencias.push(`Encaminhamento: esperado "${e}"`);
    expect(divergencias, 'respostas no SAE iguais às enviadas').toEqual([]);
    expect(texto, 'evolução').toContain(`Evolução ${d.observacao}`);
    return { criacao, conferidos: 1 + d.radios.length + d.caixas.length + d.encaminhamentos.length };
  }

  /**
   * Confere no Visualizar → "Inconformidades" cada inconformidade enviada. A lista
   * mostra Responsável | Tipo | resumo (data e itens / tipo da visita), sem a
   * observação: filtra as linhas pelo resumo esperado e abre ("Selecionar
   * inconformidade") até achar a que tem o marcador na observação. Só leitura.
   */
  async conferirInconformidades(atendimento: string, lista: Inconformidade[]) {
    const page = this.page;
    await this.visualizarInternacao(atendimento);
    await page.locator('a', { hasText: /^\s*Inconformidades\s*\d*\s*$/i }).filter({ visible: true }).first().click();
    await page.waitForLoadState('networkidle');

    const tabela = page.locator('th', { hasText: /^\s*Tipo\s*$/ }).filter({ visible: true }).first().locator('xpath=ancestor::table[1]');
    await expect(tabela, 'lista de inconformidades no SAE').toBeVisible({ timeout: 60_000 });
    const painel = page.locator('[id$=":panelNovoInconformidadeDiaria"]').first();
    const texto = async () => (await painel.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const conferidas: string[] = [];

    for (const inc of lista) {
      // linhas do tipo com o resumo esperado (a tabela é redesenhada a cada seleção: relocaliza sempre)
      let candidatas = tabela.locator('tbody tr').filter({ hasNot: page.locator('tr') }).filter({ hasText: inc.tipo });
      for (const r of resumoInconformidadeSae(inc)) candidatas = candidatas.filter({ hasText: r });
      const n = await candidatas.count();
      expect(n, `inconformidade de ${inc.tipo} com o resumo esperado na lista do SAE`).toBeGreaterThan(0);

      let achou = false;
      for (let k = 0; k < n && !achou; k++) { // a mais recente vem primeiro
        const antes = await texto();
        await candidatas.nth(k).locator('input[title="Selecionar inconformidade"]').click();
        await page.waitForLoadState('networkidle');
        await expect.poll(texto, { timeout: 30_000 }).not.toBe(antes);
        achou = (await texto()).includes(inc.observacao);
      }
      expect(achou, `inconformidade de ${inc.tipo} com a observação "${inc.observacao.slice(0, 45)}…" no SAE`).toBe(true);

      const det = await texto();
      expect(det, 'tipo no detalhe').toContain(`Tipo ${inc.tipo}`);
      if (inc.tipo === 'Visita') expect(det, 'tipo da visita').toContain(`Tipo da visita ${inc.tipoVisita}`);
      if (inc.tipo === 'Acomodação') {
        expect(det, 'período').toContain(`De ${dataExtenso(inc.de)} Até ${dataExtenso(inc.ate)}`);
        expect(det.toLowerCase(), 'acomodação').toContain(`inconformidade de acomodação ${inc.acomodacao.toLowerCase()}`);
      }
      conferidas.push(inc.tipo);
    }
    return { conferidas };
  }

  /** Etapa 4: alta + finalização da internação desta execução. */
  async finalizarInternacao(atendimento: string): Promise<{ hora: string }> {
    const linha = await this.buscarPorAtendimento(atendimento);
    const r = await this.finalizarLinha(linha, '[Exemplo] Alta registrada pelo teste E2E de desospitalização.');
    const depois = await this.buscarPorAtendimento(atendimento);
    await expect(depois).toContainText('Finalizada');
    await expect(depois).toContainText(MASSA.tipoEncerramento);
    return r;
  }

  /**
   * Limpeza antes de criar: finaliza as internações do paciente de teste que
   * ficaram em "Andamento" (execuções anteriores), para não lotar a fila.
   * Só atua no paciente de teste selecionado pelo autocomplete.
   */
  async finalizarAbertasDoPacienteDeTeste(): Promise<string[]> {
    const page = this.page;
    const finalizadas: string[] = [];
    for (let i = 0; i < 20; i++) {
      await this.abrirProcura();
      await page.locator($('mainForm:pesquisa-param-internacao-status')).selectOption({ label: 'Andamento' });
      await this.autocomplete(page.locator($('mainForm:pacientePesquisa')), MASSA.pacienteBusca, MASSA.pacienteBusca);
      await this.pesquisar();
      const linha = this.linhasResultado().filter({ hasText: MASSA.pacienteBusca }).filter({ hasText: 'Andamento' }).first();
      if (!(await linha.count())) break;
      const atendimento = (await linha.innerText()).match(/\b0\d{7}\b/)?.[0] ?? '?';
      await this.finalizarLinha(linha, '[Exemplo] Limpeza automática de internação de teste E2E.');
      finalizadas.push(atendimento);
    }
    return finalizadas;
  }
}

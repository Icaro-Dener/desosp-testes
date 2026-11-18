import { Page, Locator, expect, test } from '@playwright/test';
import path from 'path';
import { URLS } from '../support/ambiente';
import { escolherDataFlatpickr, limitesFlatpickr } from '../support/calendarios';
import { MASSA, dadosDesospitalizacao, dadosServicoSocial, dadosHospitalista, dadosVisita, Inconformidade, hojeBR } from '../support/dados';

/** Campo de data sem nenhum dia permitido pela tela (regra de negócio, não falha do teste). */
export class DataIndisponivel extends Error {}

type DadosDesosp = ReturnType<typeof dadosDesospitalizacao>;

export class AuditoriaPage {
  constructor(private readonly page: Page) {}

  // ---------------------------------------------------------------- Sync
  private linhaSync() {
    return this.page.locator('tr', { hasText: MASSA.hospitalPainelSync }).first();
  }

  /** A tabela de sync é paginada: filtra pelo hospital com a busca do painel. */
  private async filtrarTabelaSync() {
    const page = this.page;
    await page.locator('#Input_Regras_SearchKeyword6').fill(MASSA.hospitalPainelSync);
    await page.locator('#Input_Regras_SearchKeyword6').locator('xpath=following::button[normalize-space()="Buscar"][1]').click();
    await page.waitForLoadState('networkidle');
    await expect(this.linhaSync()).toBeVisible({ timeout: 30_000 });
  }

  private async lerSync() {
    const txt = (await this.linhaSync().innerText()).replace(/\s+/g, ' ');
    // "12 Nov 2026 12:10 → 12:11 Completed 2 ..." (primeiro bloco = sync de internações)
    // em andamento: "12 Nov 2026 12:10 → 1 Jan 00:00 Running 0 ..."
    const m = txt.match(/(\d{1,2} \w{3} \d{4} \d{2}:\d{2}) → (\d{2}:\d{2}|\d{1,2} \w{3} \d{2}:\d{2}) (\w+)/);
    return { inicio: m?.[1] ?? '', status: m?.[3] ?? '', texto: txt };
  }

  /** Painel de controle: coloca o hospital na fila, roda o Sincronizador e espera concluir. */
  async sincronizarHospital() {
    const page = this.page;
    // No 1º acesso da sessão o app redireciona para o Início (carga de preferências):
    // reabre o painel até ele ficar na tela.
    await expect(async () => {
      await page.goto(URLS.auditoriaPainelControle, { waitUntil: 'networkidle' });
      await expect(page).toHaveURL(/dev_painelcontrole/i, { timeout: 5_000 });
      await expect(page.locator('#Input_Regras_SearchKeyword6')).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 90_000 });
    await this.filtrarTabelaSync();
    const antes = await this.lerSync();

    await page.locator('#Dropdown1').selectOption({ label: MASSA.hospitalPainelSync });
    await page.locator('button', { hasText: 'Adicionar a fila' }).click();
    await expect(page.getByText('Hospital adicionado a fila de sincronização').first()).toBeVisible();
    await page.locator('button', { hasText: 'Rodar timer Sincronizador' }).click();
    await expect(page.getByText('Timer executado').first()).toBeVisible();

    let depois = antes;
    await expect
      .poll(
        async () => {
          await page.locator('button.btn', { hasText: 'Refresh' }).click();
          await page.waitForLoadState('networkidle');
          await this.filtrarTabelaSync();
          depois = await this.lerSync();
          return depois.inicio !== antes.inicio && /Completed|Error/.test(depois.status) ? depois.status : 'aguardando';
        },
        { message: 'sync do hospital não terminou', timeout: 10 * 60_000, intervals: [15_000] },
      )
      .toBe('Completed');
    return depois;
  }

  // ------------------------------------------------------------ Início
  private async selecionarHospital() {
    const page = this.page;
    const atual = page.locator('.dropdown-display-content span').first();
    if (MASSA.hospitalAuditoria.test((await atual.innerText()).trim())) return;
    await page.locator('.dropdown-display').first().click();
    await page.getByText(MASSA.hospitalAuditoria).filter({ visible: true }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(atual).toHaveText(MASSA.hospitalAuditoria);
  }

  /**
   * Localiza a internação na tela inicial pelo nome do paciente de teste
   * (+ data de hoje + CID). O passo 0 finaliza as internações de teste anteriores
   * e as finalizadas saem da lista, então deve sobrar exatamente uma. O vínculo
   * exato com o SAE é validado depois pelo id da internação (Internacao_IdInternacaoAPI).
   */
  /** Tela inicial, hospital de teste, filtrada pelo nome do paciente de teste. */
  private async filtrarPacienteDeTeste() {
    const page = this.page;
    await page.goto(URLS.auditoriaInicio, { waitUntil: 'networkidle' });
    await this.selecionarHospital();

    // Os filtros ficam salvos na sessão: limpa antes de filtrar
    const campoNome = page.locator('#Input_Nome');
    // Painel lateral: fechado ele fica fora da tela, mas continua "visível" no DOM
    const painelAberto = () =>
      campoNome.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth; });
    const abrirPainel = async () => {
      if (!(await painelAberto())) await page.locator('button', { hasText: 'Filtros Avançados' }).click();
      await expect(campoNome).toBeInViewport();
    };
    await abrirPainel();
    await page.locator('button', { hasText: 'Limpar filtros' }).filter({ visible: true }).click();
    await page.waitForLoadState('networkidle');
    await abrirPainel(); // "Limpar" pode fechar o painel
    await campoNome.fill(MASSA.pacienteBusca);
    // espera a tabela recarregar (senão uma lista vazia "passa" antes da hora)
    const tabela = page.waitForResponse((r) => r.url().includes('DataActionBuscarDadosTabela'), { timeout: 90_000 });
    await page.locator('button', { hasText: 'Aplicar filtros' }).filter({ visible: true }).click();
    await tabela;
    await page.waitForLoadState('networkidle');
  }

  /** Linha da internação pelo InternacaoId (os links do menu terminam com ele). */
  private linhaPorId(internacaoId: string) {
    return this.page.locator('table tbody tr').filter({ has: this.page.locator(`a[href$="InternacaoId=${internacaoId}"]`) });
  }

  async localizarPorId(internacaoId: string): Promise<Locator> {
    await this.filtrarPacienteDeTeste();
    const linha = this.linhaPorId(internacaoId);
    await expect(linha, `internação ${internacaoId} na tela inicial da Auditoria`).toHaveCount(1, { timeout: 60_000 });
    return linha;
  }

  /** Depois da finalização + sync a internação sai da tela inicial. */
  async esperarSaida(internacaoId: string) {
    await expect
      .poll(async () => { await this.filtrarPacienteDeTeste(); return this.linhaPorId(internacaoId).count(); },
        { message: `internação ${internacaoId} continua na Auditoria`, timeout: 5 * 60_000, intervals: [15_000, 30_000] })
      .toBe(0);
  }

  /** InternacaoId da linha, pelo link de Desospitalização do menu. */
  async idDaLinha(linha: Locator): Promise<string> {
    const href = (await linha.locator('.osui-overflow-menu nav a', { hasText: 'Desospitalização' }).getAttribute('href')) ?? '';
    const id = new URL(href, URLS.auditoriaInicio).searchParams.get('InternacaoId');
    expect(id, 'InternacaoId no menu da linha').toBeTruthy();
    return id!;
  }

  /** Entra nos detalhes da internação (clique na linha → /Internacao?InternacaoId=). */
  async abrirDetalhes(linha: Locator): Promise<string> {
    const id = await this.idDaLinha(linha);
    // as células a partir da 3ª têm onclick → detalhes (a última é o menu ⋮)
    await linha.locator('td').nth(2).click();
    await this.page.waitForURL(new RegExp(`/Internacao\\?.*InternacaoId=${id}\\b`), { timeout: 60_000 });
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.getByText(new RegExp(MASSA.pacienteBusca, 'i')).first()).toBeVisible({ timeout: 60_000 });
    return id;
  }

  async localizarInternacao(codigo: string, dataInternacao = new Date()): Promise<Locator> {
    const page = this.page;
    await this.filtrarPacienteDeTeste();

    const linhas = page
      .locator('table tbody tr')
      .filter({ hasText: new RegExp(MASSA.pacienteBusca, 'i') })
      .filter({ hasText: hojeBR(dataInternacao) })
      .filter({ hasText: MASSA.cidCodigo });
    await expect(linhas.first()).toBeVisible({ timeout: 60_000 });
    await expect(linhas, 'apenas a internação desta execução deve estar aberta').toHaveCount(1);
    // O "Atendimento" recebe o código do SAE só numa sincronização posterior (logo
    // após criar vem 0). Não falha por isso: registra no relatório.
    // 1ª coluna com número = Atendimento (a 1ª célula da linha é vazia)
    const atendimento = (await linhas.first().innerText()).match(/^\s*(\d+)/)?.[1] ?? '?';
    const anotacoes = test.info().annotations;
    if (!anotacoes.some((a) => a.type === 'auditoria-atendimento')) {
      anotacoes.push({
        type: 'auditoria-atendimento',
        description: atendimento === codigo ? `= código do SAE (${codigo})` : `${atendimento} (código ${codigo} ainda não sincronizado)`,
      });
    }
    return linhas.first();
  }

  /** Abre o formulário pelo menu da linha e devolve o InternacaoId da Auditoria. */
  async abrirDesospitalizacao(linha: Locator): Promise<string> {
    const menu = linha.locator('.osui-overflow-menu');
    const item = menu.locator('nav a', { hasText: 'Desospitalização' });
    const internacaoId = await this.idDaLinha(linha);
    await menu.locator('.osui-overflow-menu__trigger').click();
    await item.click();
    await this.page.waitForURL(/Desospitalizacao\?InternacaoId=/);
    await expect(this.campo('-Input_Endereco')).toBeVisible({ timeout: 60_000 });
    return internacaoId!;
  }

  // ------------------------------------------- Questionários (/Formularios)
  /**
   * Abre um questionário pelo menu ⋮ da linha (/Formularios?FormType=X&InternacaoId=)
   * e espera o bloco carregar os dados (a tela marca os padrões depois disso).
   * bloco = nome do bloco do ODC (ex.: AvaliacaoAssSocial, AvaliacaoHospitalista).
   * acaoDados / grupoPronto: a data action que o bloco chama ao abrir e o grupo de
   * rádio que indica a tela pronta (variam no formulário de inconformidade).
   */
  async abrirFormulario(linha: Locator, formType: string, bloco: string,
    { acaoDados = 'DataActionBuscarDados', grupoPronto = 'RadioGroupTipoVisita' } = {}) {
    const menu = linha.locator('.osui-overflow-menu');
    const dados = this.page.waitForResponse((r) => r.url().includes(`${bloco}/${acaoDados}`), { timeout: 90_000 });
    await menu.locator('.osui-overflow-menu__trigger').click();
    await menu.locator(`nav a[href*="FormType=${formType}&"]`).click();
    await this.page.waitForURL(new RegExp(`Formularios\\?FormType=${formType}&InternacaoId=`), { waitUntil: 'commit', timeout: 60_000 });
    await dados;
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator(`input[type=radio][name$="-${grupoPronto}"]`).first()).toBeVisible({ timeout: 60_000 });
  }

  /** Marca a opção de um grupo de rádio pelo texto do rótulo (o <label> vem logo depois do input). */
  private async marcarRadio(grupo: string, opcao: string) {
    const radios = this.page.locator(`input[type=radio][name$="-${grupo}"]`);
    const idx = await radios.evaluateAll((els, op) => els.findIndex((e) => {
      const lab = document.evaluate('following::label[1]', e, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      return (lab?.textContent ?? '').replace(/\s+/g, ' ').trim() === op;
    }), opcao);
    expect(idx, `opção "${opcao}" no grupo ${grupo}`).toBeGreaterThanOrEqual(0);
    await radios.nth(idx).check({ force: true });
    await expect(radios.nth(idx)).toBeChecked();
  }

  async preencherServicoSocial(d: ReturnType<typeof dadosServicoSocial>) {
    await this.marcarRadio(d.necessitaVisita.auditoria, d.necessitaVisita.opcao);
    for (const r of d.respostas) await this.marcarRadio(r.auditoria, r.opcao);
    await this.campo('-TextArea_ObservacaoHospital').fill(d.observacaoHospital);
    await this.campo('-TextArea_Observacao').fill(d.observacao);
  }

  async preencherHospitalista(d: ReturnType<typeof dadosHospitalista>) {
    // Data da visita (hoje) e CID atual já vêm preenchidos: só confere
    await expect(this.campo('-Input_Data_visita')).toHaveValue(hojeBR());
    await this.campo('-TextArea_DescricaoRevisaoCaso').fill(d.revisaoCaso);
    for (const r of d.respostas) await this.marcarRadio(r.auditoria, r.opcao);

    // "Recomendação ao médico assistente" = Sim abre dois campos obrigatórios
    const rec = d.recomendacao;
    await this.page.getByText('Descrição da recomendação', { exact: true }).locator('xpath=following::textarea[1]').fill(rec.descricao);
    const grupoAdesao = await this.page.locator('input[type=radio]').evaluateAll((els, opcao) => {
      const r = els.find((e) => (document.evaluate('following::label[1]', e, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue?.textContent ?? '').trim() === opcao);
      return (r as HTMLInputElement | undefined)?.name.split('-').pop() ?? '';
    }, rec.opcaoQueIdentificaOGrupo);
    expect(grupoAdesao, 'grupo "Adesão do cooperado às recomendações"').toBeTruthy();
    await this.marcarRadio(grupoAdesao, rec.adesao.opcao);

    await this.campo('-Input_DiasAdicionaisPermanencia').fill(d.diasAdicionais);
    // a data de alta estimada é calculada pela tela (hoje + dias adicionais) e fica desabilitada
    await expect(this.page.locator('[id$="-Input_Data_alta_estimada"]').first()).toHaveValue(d.dataAltaEstimadaISO);
  }

  /**
   * Caixa de marcação "<span><input checkbox></span><span>Opção</span>". Com
   * categoria, procura só no bloco cujo título (…-Titulo) é a categoria.
   */
  private async marcarCaixa(opcao: string, categoria?: string) {
    const escopo = categoria
      ? `//div[contains(@id,'-Titulo') and normalize-space()='${categoria}']/following-sibling::div`
      : '';
    // só as visíveis: opções como "Outros" se repetem em blocos escondidos
    const cb = this.page.locator(`xpath=${escopo}//span[normalize-space()='${opcao}']/preceding-sibling::span/input[@type='checkbox']`).filter({ visible: true }).first();
    await cb.check({ force: true });
    await expect(cb, `caixa "${categoria ? categoria + ' › ' : ''}${opcao}"`).toBeChecked();
  }

  /** Inconformidade: escolhe o tipo (rádio) e preenche os campos que ele mostra. */
  async preencherInconformidade(i: Inconformidade) {
    const page = this.page;
    await this.marcarRadio('RadioGroupTipoInconformidade', i.tipo);
    await page.waitForLoadState('networkidle');
    // Campo de data visível: o input de texto ao lado do input[type=date] escondido, no mesmo
    // span.input-date. Quando o "De" muda, o "Até" é recriado (vira "Input_Data_Ate2" e o
    // visível fica sem id), então não dá para localizar o visível pelo id.
    const data = (sufixo: string) => page.locator('span.input-date')
      .filter({ has: page.locator(`input[type=date][id*="-${sufixo}"]`) })
      .locator('input[type=text]').filter({ visible: true }).first();
    switch (i.tipo) {
      case 'Visita':
        await this.campo('-Dropdown1').selectOption({ label: i.tipoVisita });
        break;
      case 'Acomodação': {
        // A tela só aceita "De" a partir do dia seguinte à internação (e até hoje):
        // numa internação criada hoje não há data válida.
        const { min, max } = await limitesFlatpickr(data('Input_Data_De'));
        if (min && max && min > max) {
          throw new DataIndisponivel(`Inconformidade de Acomodação: o campo "De" só aceita de ${hojeBR(min)} até ${hojeBR(max)} ` +
            '(a partir do dia seguinte à internação). Use uma internação com data anterior a hoje.');
        }
        // período: do 1º dia permitido até o último (hoje); guardado em i para a conferência no SAE
        i.de ??= min ?? new Date();
        await escolherDataFlatpickr(page, data('Input_Data_De'), i.de);
        i.ate ??= (await limitesFlatpickr(data('Input_Data_Ate'))).max ?? new Date();
        await escolherDataFlatpickr(page, data('Input_Data_Ate'), i.ate);
        await this.campo('-DropdownAcomodacao').selectOption({ label: i.acomodacao });
        break;
      }
      case 'Material':
      case 'Medicamento':
        await escolherDataFlatpickr(page, data('Input_Data_Inconformidade'), i.data);
        for (const item of i.itens) await this.marcarCaixa(item);
        break;
    }
    await this.campo('-TextArea_Observacao').fill(i.observacao);
  }

  async preencherVisita(d: ReturnType<typeof dadosVisita>) {
    // Data da visita (hoje) e CID atual já vêm preenchidos
    await expect(this.campo('-Input_Data_visita')).toHaveValue(hojeBR());
    await this.campo('-DropdownAcomodacaoAtual').selectOption({ label: d.acomodacao });
    for (const r of d.radios) await this.marcarRadio(r.auditoria, r.opcao);
    for (const c of d.caixas) await this.marcarCaixa(c.opcao, c.categoria);
    for (const e of d.encaminhamentos) await this.marcarCaixa(e);
    await this.campo('-TextArea_Observacao').fill(d.observacao);
  }

  /**
   * "Enviar formulário" de um questionário: valida a resposta do servidor
   * (acao = trecho da URL da server action; o ODC devolve 200 com o erro no corpo)
   * e a volta para os detalhes da internação.
   */
  async enviarFormulario(acao: string, internacaoId: string) {
    const page = this.page;
    const resp = page.waitForResponse((r) => r.url().includes(acao), { timeout: 90_000 });
    const obrigatorios = page.getByText('Verifique os campos obrigatórios').filter({ visible: true }).first();
    await page.locator('button', { hasText: 'Enviar formulário' }).click();
    // pode haver um modal de confirmação (como na desospitalização)
    const confirmar = page.locator('button', { hasText: /^\s*Confirmar/ }).filter({ visible: true }).first();
    if (await confirmar.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await confirmar.click();
    const envio = await Promise.race([
      resp.then((r) => r.json()),
      obrigatorios.waitFor({ timeout: 90_000 }).then(() => { throw new Error('a tela pediu campos obrigatórios que o teste não preencheu'); }),
    ]);
    const val = envio?.data?.OutValidacao;
    expect(val?.IsSucesso, `Envio (${acao}): ${val?.MensagemRetorno}`).toBe(true);
    await page.waitForURL(new RegExp(`/Internacao\\?.*InternacaoId=${internacaoId}\\b`), { waitUntil: 'commit', timeout: 60_000 });
    return { mensagem: String(val?.MensagemRetorno ?? '') };
  }

  // ---------------------------------------------------- Formulário Desosp
  // Os ids do OutSystems mudam de prefixo (b8-, b10-...): usar o sufixo.
  private campo(sufixo: string) {
    return this.page.locator(`[id$="${sufixo}"]`).filter({ visible: true }).first();
  }

  private async marcarOpcao(texto: string) {
    const cb = this.page
      .locator('div, label, span')
      .filter({ hasText: new RegExp(`^${texto.replace(/[/()]/g, '\\$&')}$`) })
      .last()
      .locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]')
      .locator('input[type=checkbox]')
      .first();
    await cb.check();
    await expect(cb).toBeChecked();
  }

  async preencherDesospitalizacao(d: DadosDesosp) {
    const page = this.page;
    await this.campo('-Input_Endereco').fill(d.endereco);
    await this.campo('-b6-InputMask').click();
    await this.campo('-b6-InputMask').pressSequentially(d.telefoneContato, { delay: 40 });
    await this.campo('-Input_ObsContato').fill(d.obsContato);
    await this.campo('-InputMedidoassist2').fill(d.medicoSolicitante);
    await this.campo('-b32-InputMask').click();
    await this.campo('-b32-InputMask').pressSequentially(d.telefoneMedicoSolicitante, { delay: 40 });

    for (const t of [...d.tiposDesospitalizacao, ...d.tiposCuidado]) await this.marcarOpcao(t);

    const alta = new Date(Date.now() + d.diasAteAltaProvavel * 86_400_000);
    await escolherDataFlatpickr(page, page.locator('[id^="fp_"][id$="-Input_Data_Inicio"]').first(), alta);
    await this.campo('-TextArea_Observacao').fill(d.observacao);

    await page.locator('input[type=file]').first().setInputFiles(path.resolve(d.anexo));
    await expect(page.getByText(path.basename(d.anexo)).first()).toBeVisible();
    await page.locator('.vscomp-ele-wrapper').last().click();
    await page.locator('.vscomp-option', { hasText: d.tipoAnexo }).filter({ visible: true }).first().click();
    await expect(page.locator('.vscomp-ele-wrapper').last()).toContainText(d.tipoAnexo);
    return { dataAltaProvavel: alta };
  }

  /** Envia e valida a resposta do servidor (o ODC devolve 200 com o erro no corpo). */
  async enviarDesospitalizacao(): Promise<{ idInternacaoSae: string }> {
    const page = this.page;
    await page.locator('button', { hasText: 'Enviar formulário' }).click();
    const respEnvio = page.waitForResponse((r) => r.url().includes('ActionProcessaDesospitalizacao'), { timeout: 90_000 });
    const respDados = page.waitForResponse((r) => r.url().includes('/Internacao/DataActionBuscaDados'), { timeout: 90_000 });
    await page.locator('button', { hasText: 'Confirmar envio' }).filter({ visible: true }).click();

    const envio = await (await respEnvio).json();
    const val = envio?.data?.OutValidacao;
    expect(val?.IsSucesso, `Envio da desospitalização: ${val?.MensagemRetorno}`).toBe(true);

    await page.waitForURL(/AvaliacaoEnviada=Desospitalizacao/);
    await expect(page.getByText('Desospitalização enviada com sucesso!')).toBeVisible();

    const dados = (await (await respDados).json()).data.QueryResultInternacaoPage.QueryResultInternacaoPage;
    expect(dados.Hospital_ApiInternacaoId).toBe(MASSA.idHospital);
    expect(dados.Internacao_IdInternacaoAPI, 'id da internação no SAE').toMatch(/^\d+$/);
    return { idInternacaoSae: dados.Internacao_IdInternacaoAPI };
  }
}

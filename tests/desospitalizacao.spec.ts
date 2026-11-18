import { test, expect, Page } from '@playwright/test';

const INTERNACAO_ID = '86617';

const DESOSP_URL =
  `https://unimedpoa-test.outsystems.app/CockpitAuditoriaClinica/Desospitalizacao?InternacaoId=${INTERNACAO_ID}`;

const DADOS = {
  endereco: 'Rua das Flores, 123, Bairro Centro, Porto Alegre - RS',
  telefoneContato: '51999998888',
  obsContato: 'Ligar após 18h',
  nomeMedicoSolicitante: 'Dra. Fernanda Lima',
  telefoneMedicoSolicitante: '51988887777',
  dataProvavelAlta: '30/06/2026',
  observacao:
    'Paciente orientado quanto aos cuidados pós-alta. Familiar ciente do plano de desospitalização.',
};

async function aguardarFormulario(page: Page) {
  await page.waitForSelector('#b8-Form1', {
    state: 'visible',
    timeout: 30000,
  });
}

async function preencherData(
  page: Page,
  inputId: string,
  data: string,
) {
  await page.evaluate(
    ({ id, date }) => {
      const el = document.getElementById(id) as any;

      if (el && el._flatpickr) {
        el._flatpickr.setDate(date, true, 'd/m/Y');
      }
    },
    { id: inputId, date: data },
  );
}

test.describe('Desospitalização', () => {

  test('Preencher e enviar formulário', async ({ page }) => {
    await page.goto(DESOSP_URL);

    await aguardarFormulario(page);

    // Endereço
    await page.fill(
      '#b8-Input_Endereco',
      DADOS.endereco,
    );

    // Telefone contato
    const telefoneContato = page.locator('#b8-b6-InputMask');
    await telefoneContato.click();
    await telefoneContato.pressSequentially(
      DADOS.telefoneContato,
      { delay: 50 },
    );

    // Observação contato
    await page.fill(
      '#b8-Input_ObsContato',
      DADOS.obsContato,
    );

    // Médico solicitante
    await page.fill(
      '#b8-InputMedidoassist2',
      DADOS.nomeMedicoSolicitante,
    );

    // Telefone médico
    const telefoneMedico = page.locator('#b8-b32-InputMask');
    await telefoneMedico.click();
    await telefoneMedico.pressSequentially(
      DADOS.telefoneMedicoSolicitante,
      { delay: 50 },
    );

    // Caixas pelo rótulo (a posição muda quando a lista de opções muda)
    const marcar = async (rotulo: string) => {
      const cb = page.locator(`xpath=//input[@type="checkbox"][ancestor::*[position()<=4][normalize-space(.)="${rotulo}"]]`).first();
      await cb.check();
      await expect(cb).toBeChecked();
    };

    // Tipos de desospitalização
    await marcar('Reabilitação Fonoaudiologia');

    // Tipos do cuidado
    await marcar('Visita enfermagem');
    await marcar('Procedimentos de Enfermagem');

    // Data provável de alta
    await preencherData(
      page,
      'b8-b84-Input_Data_Inicio',
      DADOS.dataProvavelAlta,
    );

    // Observação
    await page.fill(
      '#b8-TextArea_Observacao',
      DADOS.observacao,
    );

    //upload
    await page
      .locator('input[type="file"]')
      .setInputFiles('tests/fotocinza.png');

    //tipoanexo
    await page.locator('.vscomp-ele-wrapper').last().click();
    await page.getByText('Descrição Cirúrgica', {
      exact: true
    }).click();

    // Enviar formulário
    await page.locator(
      'button[type="submit"]:has-text("Enviar formulário")'
    ).click();

    // Modal de confirmação
    await page.locator(
      'button:has-text("Confirmar envio")'
    ).click();
    await page.waitForTimeout(5000);

    // Aguarda conclusão
    await page.waitForLoadState('networkidle');
  });
});
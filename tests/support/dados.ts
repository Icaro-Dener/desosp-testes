// Massa de teste do E2E de desospitalização (homologação).
// Tudo que o teste digita leva o prefixo [Exemplo] e um marcador único da execução.

export const MASSA = {
  // SAE: prestador e paciente de teste já existentes em HML
  prestadorBusca: 'Deus',
  prestadorCodigo: '004800100140', // Hosp. Mae de Deus - Internacao (id 100140 nas demais apps)
  medicoBusca: 'Silva',
  pacienteBusca: 'Mulher Teste',
  cidBusca: 'I50',
  cidCodigo: 'I500',
  tipoEncerramento: 'Alta melhorado',

  // Nome do hospital em cada aplicação
  hospitalPainelSync: 'Hospital Mãe de Deus',
  hospitalAuditoria: /^Hospital M.{1,2}e De Deus$/i,
  hospitalTransicao: 'Hospital Mãe de Deus',
  idHospital: '100140',

  pacienteNomeTransicao: 'MULHER TESTE',
};

/**
 * Código da internação no prestador (campo do SAE), único por execução e
 * repetido no endereço da desospitalização para identificar o registro no
 * Transição de Cuidado. 9 dígitos: 9 + dia + hora + minuto + segundo.
 */
export function gerarCodigoInternacao(agora = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `9${p2(agora.getDate())}${p2(agora.getHours())}${p2(agora.getMinutes())}${p2(agora.getSeconds())}`;
}

export function dadosDesospitalizacao(codigo: string) {
  return {
    // o código vai no endereço para identificar ESTE registro nas telas seguintes
    endereco: `[Exemplo] Rua E2E ${codigo}, Centro, Porto Alegre - RS`,
    telefoneContato: '51999998888',
    obsContato: '[Exemplo] Ligar após 18h',
    medicoSolicitante: '[Exemplo] Dra. Fernanda Lima',
    telefoneMedicoSolicitante: '51988887777',
    tiposDesospitalizacao: ['Reabilitação Fonoaudiologia'],
    // rótulos exatos da tela (13/11/2026 "Avaliação e/ou Visita Enfermagem" virou "Visita enfermagem")
    tiposCuidado: ['Visita enfermagem', 'Procedimentos de Enfermagem'],
    diasAteAltaProvavel: 2,
    observacao: `[Exemplo] Teste E2E automatizado de desospitalização (${codigo}).`,
    anexo: 'tests/fotocinza.png',
    tipoAnexo: 'Descrição Cirúrgica',
  };
}

export const APROVACAO = {
  nucleo: 'CRÔNICOS',
  medico: '[Exemplo] Dr. Teste E2E',
  motivo: 'DESOSPITALIZAÇÃO',
  empresa: 'ATS',
  especialidade: 'ENFERMAGEM',
  dataCorte: 'Não se aplica',
  evolucao: '[Exemplo] Aprovação automatizada E2E.',
};

export const CONFIRMACAO = {
  dataCorte: 'Não se aplica',
  evolucao: '[Exemplo] Confirmação automatizada E2E.',
};

export const p2 = (n: number) => String(n).padStart(2, '0');
export const hojeBR = (d = new Date()) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
export const hojeISO = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
/** Data como o SAE escreve: "12 de Novembro de 2026". */
export const dataExtenso = (d = new Date()) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

/**
 * Avaliação do Serviço Social. Cada resposta liga o grupo de rádio da Auditoria
 * (name termina com "-RadioGroupX", opção pelo texto do rótulo) ao par
 * "pergunta resposta" que o SAE mostra no Visualizar da internação.
 */
export function dadosServicoSocial(marcador: string) {
  const r = (auditoria: string, opcao: string, perguntaSae: string, respostaSae = opcao) => ({ auditoria, opcao, perguntaSae, respostaSae });
  return {
    necessitaVisita: r('RadioGroupNecessitaVisita', 'Não', ''), // só existe na Auditoria
    respostas: [
      r('RadioGroupTipoVisita', 'Prontuário', 'Qual o tipo de visita ?'),
      r('RadioGroupOcupacao', 'Aposentado (a)', 'Ocupação', 'Aposentado(a)'),
      r('RadioGroupResidencia', 'Com familiares', 'Residência'),
      r('RadioGroupEscolaridade', 'Nivel médio', 'Escolaridade', 'Nível médio'),
      r('RadioGroupFamilia', 'Familiares atuantes', 'Família/Responsável'),
      r('RadioGroupRecursospublicos', 'Não', 'Recursos públicos'),
      r('RadioGroupCobrancaParticular', 'Não', 'Cobrança particular'),
      r('RadioGroupAcomodacaoAtual', 'De acordo com contrato', 'Acomodação atual'),
      r('RadioGroupInternacaoEmergencia', 'Adequado', 'Internação na Emergência'),
      r('RadioGroupHigienizacao', 'Adequado', 'Higienização'),
      r('RadioGroupNutricao', 'Adequado', 'Nutrição Paciente'),
      r('RadioGroupRefeicoesAcompanhantes', 'Inadequado', 'Refeições Acompanhante'),
      r('RadioGroupInstalacoesGerais', 'Adequado', 'Mobiliário/enxoval/instalações gerais'),
      r('RadioGroupQualidadeAssistencial', 'Adequado', 'Qualidade assistencial'),
      r('RadioGroupClassificacaoGeral', 'Muito bom', 'Classificacao geral'),
      r('RadioGroupApoioSocial', 'Risco Baixo (vínculo familar / amigo presente)', 'Apoio social'),
      r('RadioGroupAutopercepcaodesaude', 'Risco médio (entende ter a doença / não vê necessidade de se cuidar)', 'Auto percepção da saúde'),
      r('RadioGroupMedicoReferencia', 'Programado', 'Médico de referência'),
    ],
    // a lista do SAE corta a observação em ~30 caracteres: o marcador vai no começo
    observacao: `[Exemplo] SS E2E ${marcador} - avaliação de serviço social gerada pelo teste automatizado.`,
    observacaoHospital: `[Exemplo] Observação do hospital - teste E2E ${marcador}.`,
  };
}

/**
 * Avaliação Hospitalista. No SAE (Visualizar → "Avaliações Hospitalistas") o
 * detalhe é um formulário: cada resposta é conferida pelo rádio marcado
 * (saeRadio = name do grupo no SAE; respostaSae = rótulo) ou, sem rádio, pelo texto.
 */
export function dadosHospitalista(marcador: string) {
  const r = (auditoria: string, opcao: string, perguntaSae: string, saeRadio = '', respostaSae = opcao) => ({ auditoria, opcao, perguntaSae, saeRadio, respostaSae });
  const diasAdicionais = 2;
  const alta = new Date(Date.now() + diasAdicionais * 86_400_000);
  return {
    respostas: [
      r('RadioGroupPacienteEstavel', 'Sim', 'Paciente estável', 'pacienteEstavel'),
      r('RadioGroupTipoVisita', 'Beira leito', 'Qual o tipo de visita ?'), // no SAE vem como texto
      r('RadioGroupAlternativaAmbulatorial', 'Não', 'Alternativa ambulatorial para pendências de alta', 'alternativaAmbulatorialPendenciaAlta'),
      r('RadioGroupRecomendacaoMedAssist', 'Sim', 'Recomendação ao médico assistente', 'recomendacaoAoMedicoAssistente'),
    ],
    // aparecem quando "Recomendação ao médico assistente" = Sim (ambos obrigatórios)
    recomendacao: {
      descricao: `[Exemplo] Recomendação ao médico assistente - teste E2E ${marcador}.`,
      // grupo sem nome conhecido na Auditoria: localizado pela opção exclusiva dele
      adesao: r('', 'Sim', 'Adesão do cooperado às recomendações', 'tipoAdesaoRecomendacaoAoMedicoAssistente'),
      opcaoQueIdentificaOGrupo: 'Não conseguiu contato com o cooperado',
    },
    revisaoCaso: `[Exemplo] HOSP E2E ${marcador} - revisão do caso gerada pelo teste automatizado.`,
    diasAdicionais: String(diasAdicionais),
    dataAltaEstimadaISO: hojeISO(alta),
    dataAltaEstimadaBR: hojeBR(alta),
  };
}

/**
 * Avaliação de Visita (bloco AvaliacaoEnfermagem). Só o questionário: o
 * "Registro de Procedimentos", as condições adquiridas e as análises críticas
 * (listas com "Inserir") ficam de fora.
 */
export function dadosVisita(marcador: string) {
  // saeRadio: no SAE a resposta é um rádio (name); sem ele, vem como texto "pergunta resposta"
  const r = (auditoria: string, opcao: string, perguntaSae: string, saeRadio = '', respostaSae = opcao) => ({ auditoria, opcao, perguntaSae, saeRadio, respostaSae });
  return {
    acomodacao: 'PRIVATIVO',
    acomodacaoSae: 'Acomodação atual Privativo',
    radios: [
      r('RadioGroupIsolamento', 'Não', 'Isolamento'),
      r('RadioGroupTipoVisita', 'Beira leito', 'Qual o tipo de visita ?'),
      r('RadioGroupNivelConsciencia', 'Lúcido', 'Nível de consciência'),
      r('RadioGroupAguardandoAutorizacao', 'Não', 'Aguardando autorização', 'aguardandoAutorizacaoVisita'),
    ],
    // Quadro clínico: caixa = categoria (título do bloco) + opção; no SAE, caixa marcada com o mesmo rótulo
    caixas: [
      { categoria: 'Digestivo', opcao: 'VO' },
      { categoria: 'Acessos', opcao: 'AVP' },
      { categoria: 'Eliminações', opcao: 'Espontânea' },
      { categoria: 'Nivel de cuidados', opcao: 'Autonomia preservada' },
      { categoria: 'Mobilidade', opcao: 'Sem limitações' },
      { categoria: 'Terminalidade', opcao: 'Suporte ativo' },
    ],
    encaminhamentos: ['Medicina preventiva'],
    observacao: `[Exemplo] VISITA E2E ${marcador} - avaliação de visita gerada pelo teste automatizado.`,
  };
}

/**
 * Inconformidades: um registro de cada um dos 4 tipos. O marcador (com o tipo)
 * vai no começo da observação, para achar cada uma no SAE.
 */
export type Inconformidade = { chave: string; observacao: string } & (
  | { tipo: 'Visita'; tipoVisita: string }
  | { tipo: 'Acomodação'; de?: Date; ate?: Date; acomodacao: string } // datas: escolhidas na tela dentro dos limites dela
  | { tipo: 'Material'; data: Date; itens: string[] }
  | { tipo: 'Medicamento'; data: Date; itens: string[] }
);

export function dadosInconformidades(marcador: string): Inconformidade[] {
  const hoje = new Date();
  const obs = (chave: string) => `[Exemplo] INC ${chave} E2E ${marcador} - inconformidade gerada pelo teste automatizado.`;
  return [
    { tipo: 'Visita', chave: 'VISITA', tipoVisita: 'Atendimento do intensivista diarista', observacao: obs('VISITA') },
    { tipo: 'Acomodação', chave: 'ACOMODACAO', acomodacao: 'UTI GERAL', observacao: obs('ACOMODACAO') },
    { tipo: 'Material', chave: 'MATERIAL', data: hoje, itens: ['Cardio', 'Outros'], observacao: obs('MATERIAL') },
    { tipo: 'Medicamento', chave: 'MEDICAMENTO', data: hoje, itens: ['ATB', 'Antifúngico'], observacao: obs('MEDICAMENTO') },
  ];
}

/**
 * Como a linha da inconformidade aparece na lista do SAE (Visualizar →
 * "Inconformidades"): Responsável | Tipo | resumo. Ex.: "12 de Novembro de 2026 -Cardio,Outros".
 */
export function resumoInconformidadeSae(i: Inconformidade): (string | RegExp)[] {
  switch (i.tipo) {
    case 'Visita': return [i.tipoVisita];
    // "11 de Novembro de 2026 -12 de Novembro de 2026 -Uti geral" (o SAE muda a caixa do nome)
    case 'Acomodação': return [`${dataExtenso(i.de)} -${dataExtenso(i.ate)} -`, new RegExp(`-${i.acomodacao}\\s*$`, 'i')];
    case 'Material':
    case 'Medicamento': return [dataExtenso(i.data), `-${i.itens.join(',')}`];
  }
}

import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';
import { Ambiente, AMBIENTE_ATUAL, NOME_AMBIENTE } from './ambiente';

/**
 * Internação "em uso" pelos fluxos separados (criar → questionários → finalizar).
 * Funciona como trava: enquanto o arquivo existir, "Criar internação" não roda
 * de novo; só "Finalizar internação" apaga o arquivo.
 * Guarda só códigos/ids (nada de dado pessoal).
 */
export const ARQUIVO_ESTADO = path.resolve(__dirname, '..', '..', '.estado', 'internacao-atual.json');

export interface InternacaoAtual {
  codigo: string;
  atendimento: string;
  criadaEm: string;
  /** ambiente das apps OutSystems onde ela foi criada (sem o campo = hml, estados antigos) */
  ambiente?: Ambiente;
  /** data da internação no SAE (ISO); retroativa nos fluxos separados */
  dataInternacao?: string;
  /** preenchido quando o fluxo de criação chega aos detalhes na Auditoria */
  internacaoIdAuditoria?: string;
  desosp?: {
    idInternacaoSae: string;
    idDesosp?: string;
    etapa: 'enviada' | 'atribuida' | 'aprovada' | 'confirmada';
    dataAltaProvavel: string; // ISO
  };
  /** marcadores das avaliações de serviço social enviadas (pode haver várias) */
  servicoSocial?: string[];
  /** marcadores das avaliações de visita enviadas */
  visita?: string[];
  /** marcadores das inconformidades enviadas (um por tipo) */
  inconformidade?: string[];
  /** marcadores das avaliações hospitalistas enviadas */
  hospitalista?: string[];
}

export function lerInternacao(): InternacaoAtual | null {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  } catch {
    return null;
  }
}

export function salvarInternacao(i: InternacaoAtual) {
  fs.mkdirSync(path.dirname(ARQUIVO_ESTADO), { recursive: true });
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(i, null, 2));
}

export function atualizarInternacao(parcial: Partial<InternacaoAtual>) {
  const atual = lerInternacao();
  if (!atual) throw new Error('nenhuma internação em uso');
  salvarInternacao({ ...atual, ...parcial });
}

/**
 * A internação em uso pertence ao ambiente em que foi criada: o id na Auditoria
 * e o kanban do Transição são de lá. Rodar em outro ambiente falharia no meio.
 */
export function conferirAmbiente(i: InternacaoAtual | null) {
  if (!i) return;
  const dela = i.ambiente ?? 'hml';
  expect(dela, `A internação em uso (código ${i.codigo}) foi criada em ${NOME_AMBIENTE[dela]}. ` +
    `Troque o ambiente para ${NOME_AMBIENTE[dela]} para usá-la ou finalizá-la.`).toBe(AMBIENTE_ATUAL);
}

export function limparInternacao() {
  fs.rmSync(ARQUIVO_ESTADO, { force: true });
}

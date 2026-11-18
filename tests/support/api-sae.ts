import { APIRequestContext, request } from '@playwright/test';
import fs from 'fs';
import { AMBIENTE } from './ambiente';

/**
 * Validação direta na API do SAE (gateway Sensedia), com as mesmas rotas da
 * collection "Jornada Assistencial". Opcional: só roda se existir um .env com
 *   SAE_API_CLIENT_ID=...
 *   SAE_API_CLIENT_SECRET=...
 * Os valores nunca são impressos.
 */
function lerEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (fs.existsSync('.env')) {
    for (const linha of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

export class SaeApi {
  private constructor(private readonly ctx: APIRequestContext) {}

  /** Devolve null quando não há credenciais (a validação por API é pulada). */
  static async criar(): Promise<SaeApi | null> {
    const env = lerEnv();
    const id = env.SAE_API_CLIENT_ID, segredo = env.SAE_API_CLIENT_SECRET;
    if (!id || !segredo) return null;
    const basic = Buffer.from(`${id}:${segredo}`).toString('base64');
    const tokenCtx = await request.newContext();
    const r = await tokenCtx.post(`${AMBIENTE.apiGateway}/oauth2/v1/access-token`, {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'grant_type=client_credentials',
    });
    if (!r.ok()) throw new Error(`Token do gateway falhou: HTTP ${r.status()}`);
    const { access_token } = await r.json();
    await tokenCtx.dispose();
    const ctx = await request.newContext({
      baseURL: AMBIENTE.apiGateway,
      extraHTTPHeaders: { Authorization: `Bearer ${access_token}`, client_id: id },
    });
    return new SaeApi(ctx);
  }

  private async get(caminho: string, params: Record<string, string>) {
    const r = await this.ctx.get(caminho, { params });
    if (!r.ok()) throw new Error(`GET ${caminho} → HTTP ${r.status()}`);
    return r.json();
  }

  /** GET /sae/v1/desospitalizacao?p_hospital=&p_internacao_desosp= */
  async desospitalizacao(idHospital: string, idInternacaoSae: string) {
    return this.get('/sae/v1/desospitalizacao', { p_hospital: idHospital, p_internacao_desosp: idInternacaoSae });
  }

  /** GET /sae/v1/internacoes?p_dataAlta=AAAA-MM-DD ("a partir de"), paginado por hasMore. */
  async internacoesComAltaDesde(dataISO: string) {
    const itens: any[] = [];
    for (let offset = 0; ; ) {
      const j = await this.get('/sae/v1/internacoes', { p_dataAlta: dataISO, limit: '10000', offset: String(offset) });
      const lote: any[] = j.items ?? j.data ?? [];
      itens.push(...lote);
      if (!j.hasMore || !lote.length) break;
      offset += lote.length;
    }
    return itens;
  }

  async fechar() {
    await this.ctx.dispose();
  }
}

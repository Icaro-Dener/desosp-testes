// Painel local para rodar o E2E de desospitalização com um clique.
//   npm run painel      →  http://localhost:4600
// Escuta só em 127.0.0.1. Roda um teste por vez. Não aceita comandos livres:
// só os fluxos de FLUXOS (specs fixos do projeto).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { prepararFontes, servirFontes } = require('./fontes');

const RAIZ = path.resolve(__dirname, '..');
const PORTA = Number(process.env.PORTA) || 4600;
const CLI = path.join(RAIZ, 'node_modules', '@playwright', 'test', 'cli.js');
const ULTIMA = path.join(__dirname, 'ultima-execucao.json');
const ESTADO = path.join(RAIZ, '.estado', 'internacao-atual.json');
// Ambiente das apps OutSystems (o SAE é sempre o HML01). Guardado para sobreviver a reinícios.
const PREFS = path.join(RAIZ, '.estado', 'painel.json');
const AMBIENTES = { dev: 'DEV', hml: 'HML', prd: 'PRD' };
let ambiente = (() => { try { const a = JSON.parse(fs.readFileSync(PREFS, 'utf8')).ambiente; return AMBIENTES[a] ? a : 'hml'; } catch { return 'hml'; } })();
const sessaoDe = (a) => path.join(RAIZ, '.auth', `${a}.json`);

// O que o painel pode rodar. Não aceita comandos livres: só estes.
const FLUXOS = {
  criar: { nome: 'Criar internação', tipo: 'Início', projeto: 'fluxos', spec: 'tests/fluxos/01-criar-internacao.spec.ts' },
  desosp: { nome: 'Desospitalização', tipo: 'Questionário', projeto: 'fluxos', spec: 'tests/fluxos/02-desospitalizacao.spec.ts' },
  servicoSocial: { nome: 'Avaliação de serviço social', tipo: 'Questionário', projeto: 'fluxos', spec: 'tests/fluxos/03-servico-social.spec.ts' },
  inconformidade: { nome: 'Inconformidades (4 tipos)', tipo: 'Questionário', projeto: 'fluxos', spec: 'tests/fluxos/06-inconformidade.spec.ts' },
  visita: { nome: 'Avaliação de visita', tipo: 'Questionário', projeto: 'fluxos', spec: 'tests/fluxos/05-visita.spec.ts' },
  hospitalista: { nome: 'Avaliação hospitalista', tipo: 'Questionário', projeto: 'fluxos', spec: 'tests/fluxos/04-hospitalista.spec.ts' },
  finalizar: { nome: 'Finalizar internação', tipo: 'Encerramento', projeto: 'fluxos', spec: 'tests/fluxos/99-finalizar-internacao.spec.ts' },
  e2e: { nome: 'Ciclo completo', tipo: 'Teste completo', projeto: 'e2e', spec: 'tests/desospitalizacao-e2e.spec.ts' },
  chips: { nome: 'Conferir filter chips', tipo: 'Conferência', projeto: 'fluxos', spec: 'tests/fluxos/10-filter-chips.spec.ts' },
  setup: { nome: 'Renovar login', tipo: '', projeto: 'setup', spec: null },
};

function internacaoAtual() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { return null; }
}

/** Trava entre fluxos: devolve o motivo de bloqueio ou null (os specs conferem de novo). */
function bloqueio(id, i = internacaoAtual()) {
  const etapa = i?.desosp?.etapa;
  const nome = AMBIENTES[ambiente];
  if (id !== 'setup' && !fs.existsSync(sessaoDe(ambiente))) return `Sem login salvo em ${nome}. Clique na engrenagem e em "Renovar login" primeiro.`;
  // a internação em uso é do ambiente em que foi criada (id na Auditoria, kanban do Transição)
  const dela = i ? (i.ambiente || 'hml') : null;
  if (dela && dela !== ambiente && id !== 'criar' && id !== 'e2e' && id !== 'setup')
    return `A internação em uso foi criada em ${AMBIENTES[dela]}. Volte para ${AMBIENTES[dela]} para usá-la ou finalizá-la.`;
  switch (id) {
    case 'criar': return i ? `Já existe uma internação em uso (código ${i.codigo}). Finalize-a antes de criar outra.` : null;
    case 'desosp':
      if (!i) return 'Crie uma internação primeiro.';
      if (!i.internacaoIdAuditoria) return 'A criação não chegou aos detalhes na Auditoria. Finalize esta internação e crie outra.';
      return etapa === 'aprovada' || etapa === 'confirmada' ? 'A desospitalização desta internação já foi aprovada.' : null;
    case 'servicoSocial':
    case 'hospitalista':
    case 'visita':
    case 'inconformidade':
      if (!i) return 'Crie uma internação primeiro.';
      return i.internacaoIdAuditoria ? null : 'A criação não chegou aos detalhes na Auditoria. Finalize esta internação e crie outra.';
    case 'finalizar': return i ? null : 'Nenhuma internação em uso.';
    case 'e2e': return i ? 'Há uma internação em uso pelos fluxos separados. Finalize-a antes do ciclo completo.' : null;
    default: return null;
  }
}

let execucao = carregarUltima(); // { id, projeto, inicio, fim, status, eventos[] }
let filho = null;
const clientes = new Set();

function carregarUltima() {
  try { return JSON.parse(fs.readFileSync(ULTIMA, 'utf8')); } catch { return null; }
}

function emitir(ev) {
  ev.t = Date.now();
  execucao.eventos.push(ev);
  const linha = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clientes) c.write(linha);
}

/** Títulos das etapas, lidos do próprio spec (a página mostra a lista antes de rodar). */
function etapas(spec) {
  if (!spec) return [];
  const src = fs.readFileSync(path.join(RAIZ, spec), 'utf8');
  return [...src.matchAll(/test\.step\(\s*'([^']+)'/g)].map((m) => m[1]);
}

function rodar(fluxo, mostrar) {
  const { projeto, spec } = FLUXOS[fluxo];
  // o login precisa da janela: sempre visível
  const oculto = projeto !== 'setup' && !mostrar;
  const amb = ambiente;
  // "projeto" no evento = id do fluxo (a página usa para escolher a lista de etapas)
  execucao = { id: Date.now(), projeto: fluxo, inicio: Date.now(), fim: null, status: 'rodando', oculto, ambiente: amb, eventos: [] };
  emitir({ tipo: 'execucao', projeto: fluxo, status: 'rodando', oculto, ambiente: amb });

  // reporter do painel (etapas ao vivo) + relatório HTML do Playwright (análise completa)
  const args = [CLI, 'test', `--project=${projeto}`, `--reporter=${path.join(__dirname, 'reporter-painel.js')},html`];
  if (spec) args.push(path.basename(spec)); // filtro pelo nome do arquivo
  filho = spawn(process.execPath, args, { cwd: RAIZ, env: { ...process.env, FORCE_COLOR: '0', PLAYWRIGHT_HTML_OPEN: 'never', PAINEL_OCULTO: oculto ? '1' : '0', PAINEL_AMBIENTE: amb } });

  let resto = '';
  const ler = (buf, erro) => {
    resto += buf.toString('utf8');
    const linhas = resto.split(/\r?\n/);
    resto = linhas.pop();
    for (const l of linhas) {
      if (l.startsWith('@@PAINEL ')) {
        try { emitir(JSON.parse(l.slice(9))); } catch { emitir({ tipo: 'log', texto: l }); }
      } else if (l.trim()) {
        emitir({ tipo: 'log', texto: l, erro });
      }
    }
  };
  filho.stdout.on('data', (b) => ler(b, false));
  filho.stderr.on('data', (b) => ler(b, true));
  filho.on('close', (code) => {
    if (resto.trim()) emitir({ tipo: 'log', texto: resto });
    execucao.fim = Date.now();
    if (execucao.status === 'rodando') execucao.status = code === 0 ? 'passou' : execucao.status === 'parado' ? 'parado' : 'falhou';
    emitir({ tipo: 'execucao', projeto: fluxo, status: execucao.status, codigo: code, internacao: internacaoAtual() });
    filho = null;
    try { fs.writeFileSync(ULTIMA, JSON.stringify(execucao)); } catch {}
  });
}

function parar() {
  if (!filho) return false;
  execucao.status = 'parado';
  // Windows: derruba a árvore (runner + navegador)
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(filho.pid), '/T', '/F'], () => {});
  else filho.kill('SIGTERM');
  return true;
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/api/estado') {
    const temRelatorio = fs.existsSync(path.join(RAIZ, 'playwright-report', 'index.html'));
    const internacao = internacaoAtual();
    const fluxos = Object.fromEntries(Object.entries(FLUXOS).map(([id, f]) => [id, { nome: f.nome, tipo: f.tipo, etapas: etapas(f.spec), bloqueio: bloqueio(id, internacao) }]));
    return json(res, 200, { fluxos, internacao, rodando: !!filho, execucao, temRelatorio, ambiente, ambientes: AMBIENTES });
  }

  if (req.method === 'GET' && url.pathname === '/api/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    clientes.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); clientes.delete(res); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/rodar') {
    // só aceita chamadas da própria página (evita disparo por outro site)
    if (req.headers['x-painel'] !== '1') return json(res, 403, { erro: 'origem não permitida' });
    const fluxo = url.searchParams.get('fluxo') || '';
    if (!FLUXOS[fluxo]) return json(res, 400, { erro: 'fluxo inválido' });
    if (filho) return json(res, 409, { erro: 'já existe uma execução em andamento' });
    const motivo = bloqueio(fluxo);
    if (motivo) return json(res, 409, { erro: motivo });
    rodar(fluxo, url.searchParams.get('mostrar') !== '0');
    return json(res, 202, { ok: true, id: execucao.id });
  }

  if (req.method === 'POST' && url.pathname === '/api/ambiente') {
    if (req.headers['x-painel'] !== '1') return json(res, 403, { erro: 'origem não permitida' });
    const valor = url.searchParams.get('valor') || '';
    if (!AMBIENTES[valor]) return json(res, 400, { erro: 'ambiente inválido' });
    if (filho) return json(res, 409, { erro: 'Espere a execução atual terminar para trocar de ambiente.' });
    ambiente = valor;
    try { fs.mkdirSync(path.dirname(PREFS), { recursive: true }); fs.writeFileSync(PREFS, JSON.stringify({ ambiente })); } catch {}
    return json(res, 200, { ambiente });
  }

  if (req.method === 'POST' && url.pathname === '/api/parar') {
    if (req.headers['x-painel'] !== '1') return json(res, 403, { erro: 'origem não permitida' });
    return json(res, 200, { parado: parar() });
  }

  if (req.method === 'GET' && url.pathname === '/api/print') {
    // só PNGs gerados pelo Playwright em test-results
    const alvo = path.resolve(url.searchParams.get('caminho') || '');
    const base = path.join(RAIZ, 'test-results') + path.sep;
    if (!alvo.startsWith(base) || !alvo.endsWith('.png') || !fs.existsSync(alvo)) return json(res, 404, { erro: 'não encontrado' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return fs.createReadStream(alvo).pipe(res);
  }

  if (req.method === 'GET' && url.pathname.startsWith('/fontes/')) return servirFontes(req, res, url.pathname);

  if (req.method === 'GET' && url.pathname.startsWith('/relatorio/')) {
    // relatório HTML do Playwright (estático), só de dentro de playwright-report/
    const base = path.join(RAIZ, 'playwright-report');
    const rel = decodeURIComponent(url.pathname.slice('/relatorio/'.length)) || 'index.html';
    const alvo = path.resolve(base, rel);
    if (!alvo.startsWith(base + path.sep) || !fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) {
      return json(res, 404, { erro: 'relatório não encontrado — rode o teste primeiro' });
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return fs.createReadStream(alvo).pipe(res);
  }

  json(res, 404, { erro: 'rota inexistente' });
});

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webm': 'video/webm', '.zip': 'application/zip', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

prepararFontes(); // fontes Unimed do tema Cockpit (em segundo plano)
servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`Painel do E2E em http://localhost:${PORTA}`);
});

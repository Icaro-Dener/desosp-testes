// Fontes Unimed (Unimed Sans 2020 / Unimed Slab 2020) para o tema Cockpit.
//
// As fontes são as mesmas que a Cockpit de Auditoria Clínica carrega. Elas NÃO
// vão para o git: o servidor baixa da própria Cockpit (arquivos públicos) para
// .estado/fontes/ e serve em /fontes/. O navegador não pode buscar direto lá
// (a Cockpit não manda cabeçalho CORS) e os nomes dos arquivos mudam a cada
// publicação do app, então o caminho é descoberto pelo moduleinfo do módulo.
// Sem rede ou se algo mudar, o painel segue com a fonte do sistema.

const fs = require('fs');
const path = require('path');
const https = require('https');

const MODULO = 'https://unimedpoa-test.outsystems.app/CockpitAuditoriaClinica/';
const PASTA = path.join(__dirname, '..', '.estado', 'fontes');
const CSS_LOCAL = path.join(PASTA, 'fontes.css');
const VALIDADE = 30 * 24 * 3600 * 1000; // rebaixa a cada 30 dias
const NOME_ARQUIVO = /^[A-Za-z0-9-]+\.(woff2|woff)$/;

function baixar(url, limite = 5 * 1024 * 1024) {
  return new Promise((ok, falha) => {
    const req = https.get(url, { timeout: 20_000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return falha(new Error(`${res.statusCode} em ${url}`)); }
      const partes = []; let total = 0;
      res.on('data', (p) => { total += p.length; if (total > limite) req.destroy(new Error('arquivo grande demais')); else partes.push(p); });
      res.on('end', () => ok(Buffer.concat(partes)));
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', falha);
  });
}

/** Lê os @font-face das famílias Unimed de um CSS (família, peso, URL woff2/woff). */
function lerFontFaces(css, base) {
  const out = [];
  for (const bloco of css.match(/@font-face\s*{[^}]*}/g) || []) {
    const familia = (bloco.match(/font-family:\s*["']?([^"';]+)["']?/) || [])[1];
    if (!/^Unimed (Sans|Slab)2020$/.test(familia || '')) continue;
    const peso = (bloco.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
    const urls = [...bloco.matchAll(/url\(["']?([^"')]+)["']?\)\s*format\(["']?(woff2?|woff)["']?\)/g)].map((m) => ({ url: m[1], fmt: m[2] }));
    const escolhida = urls.find((u) => u.fmt === 'woff2') || urls[0];
    if (escolhida) out.push({ familia, peso, url: new URL(escolhida.url, base).href, fmt: escolhida.fmt });
  }
  return out;
}

async function atualizarFontes() {
  const info = (await baixar(MODULO + 'moduleservices/moduleinfo')).toString('utf8');
  const csss = [...new Set(info.match(/[\w\-/.]+\.css/g) || [])].filter((c) => /UnimedUITheme|CockpitAuditoriaClinica\.CockpitAuditoriaClinica/.test(c));
  let faces = [];
  for (const c of csss) {
    const url = new URL(c, MODULO).href;
    faces = faces.concat(lerFontFaces((await baixar(url)).toString('utf8'), url));
  }
  // uma por família+peso
  const unicas = [...new Map(faces.map((f) => [`${f.familia}-${f.peso}`, f])).values()];
  if (!unicas.length) throw new Error('nenhuma fonte Unimed encontrada no tema da Cockpit');
  fs.mkdirSync(PASTA, { recursive: true });
  const regras = [];
  for (const f of unicas) {
    const arquivo = `${f.familia.replace(/\s+/g, '')}-${f.peso}.${f.fmt}`;
    fs.writeFileSync(path.join(PASTA, arquivo), await baixar(f.url));
    regras.push(`@font-face { font-family: "${f.familia}"; src: url("/fontes/${arquivo}") format("${f.fmt}"); font-weight: ${f.peso}; font-style: normal; font-display: swap; }`);
  }
  fs.writeFileSync(CSS_LOCAL, `/* baixado da Cockpit de Auditoria Clínica em ${new Date().toISOString()} */\n${regras.join('\n')}\n`);
  return unicas.length;
}

/** Baixa em segundo plano se ainda não tem (ou se ficou velho). Nunca derruba o servidor. */
function prepararFontes(log = console.log) {
  let precisa = true;
  try { precisa = Date.now() - fs.statSync(CSS_LOCAL).mtimeMs > VALIDADE; } catch {}
  if (!precisa) return;
  atualizarFontes()
    .then((n) => log(`Fontes Unimed prontas (${n} arquivos em .estado/fontes).`))
    .catch((e) => log(`Fontes Unimed indisponíveis (${e.message}); o painel usa a fonte do sistema.`));
}

/** Rota /fontes/*: o CSS gerado e os arquivos baixados (só nomes simples, só desta pasta). */
function servirFontes(req, res, pathname) {
  const nome = decodeURIComponent(pathname.slice('/fontes/'.length));
  if (nome === 'fontes.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.existsSync(CSS_LOCAL) ? fs.createReadStream(CSS_LOCAL).pipe(res) : res.end('/* fontes Unimed ainda não baixadas */');
  }
  const alvo = path.join(PASTA, nome);
  if (!NOME_ARQUIVO.test(nome) || !fs.existsSync(alvo)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': nome.endsWith('.woff2') ? 'font/woff2' : 'font/woff', 'Cache-Control': 'max-age=86400' });
  return fs.createReadStream(alvo).pipe(res);
}

module.exports = { prepararFontes, servirFontes };

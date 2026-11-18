// Reporter do Playwright para o painel: emite cada evento como uma linha
// "@@PAINEL {json}" no stdout, que o painel/servidor.js lê e repassa à página.

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const limpar = (s) => String(s ?? '').replace(ANSI, '');
const emitir = (o) => process.stdout.write('@@PAINEL ' + JSON.stringify(o) + '\n');

class ReporterPainel {
  onBegin(_config, suite) {
    emitir({ tipo: 'inicio', testes: suite.allTests().map((t) => t.title) });
  }

  onTestBegin(test) {
    emitir({ tipo: 'teste-inicio', titulo: test.title, projeto: test.parent.project()?.name });
  }

  onStepBegin(_test, _result, step) {
    if (step.category === 'test.step') emitir({ tipo: 'etapa-inicio', titulo: step.title });
  }

  onStepEnd(_test, _result, step) {
    if (step.category !== 'test.step') return;
    emitir({
      tipo: 'etapa-fim',
      titulo: step.title,
      ms: step.duration,
      erro: step.error ? limpar(step.error.message).split('\n').slice(0, 12).join('\n') : null,
    });
  }

  onStdOut(chunk) {
    emitir({ tipo: 'log', texto: limpar(chunk) });
  }

  onStdErr(chunk) {
    emitir({ tipo: 'log', texto: limpar(chunk), erro: true });
  }

  onTestEnd(test, result) {
    emitir({
      tipo: 'teste-fim',
      status: result.status,
      ms: result.duration,
      erro: result.error ? limpar(result.error.message).split('\n').slice(0, 25).join('\n') : null,
      anotacoes: test.annotations,
      prints: result.attachments.filter((a) => a.path && a.contentType === 'image/png').map((a) => a.path),
    });
  }

  onEnd(result) {
    emitir({ tipo: 'fim', status: result.status });
  }

  printsToStdio() {
    return false;
  }
}

module.exports = ReporterPainel;

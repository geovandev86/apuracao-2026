// Painel de apuração das Eleições 2026.
// Servidor local sem dependências: entrega a página e repassa as consultas
// ao site oficial de resultados do TSE (resultados.tse.jus.br), com um cache curto.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORTA = Number(process.env.PORT) || 8026;
const TSE = 'https://resultados.tse.jus.br/';
const cache = new Map(); // caminho -> { ate, corpo, tipo }
const emAndamento = new Map(); // caminho -> Promise

function validade(caminho) {
  if (caminho.includes('/fotos/')) return 24 * 60 * 60 * 1000;
  if (caminho.includes('/config/')) return 10 * 60 * 1000;
  return 10 * 1000;
}

async function buscarNoTSE(caminho) {
  const r = await fetch(TSE + caminho, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) {
    const erro = new Error('TSE respondeu ' + r.status);
    erro.status = r.status;
    throw erro;
  }
  const item = {
    ate: Date.now() + validade(caminho),
    corpo: Buffer.from(await r.arrayBuffer()),
    tipo: r.headers.get('content-type') || 'application/octet-stream',
  };
  cache.set(caminho, item);
  return item;
}

async function obter(caminho) {
  const salvo = cache.get(caminho);
  if (salvo && salvo.ate > Date.now()) return salvo;
  if (!emAndamento.has(caminho)) {
    emAndamento.set(caminho, buscarNoTSE(caminho).finally(() => emAndamento.delete(caminho)));
  }
  try {
    return await emAndamento.get(caminho);
  } catch (erro) {
    // Se o TSE oscilar, devolve o último dado bom em vez de deixar a tela vazia.
    if (salvo && erro.status !== 404) return { ...salvo, antigo: true };
    throw erro;
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    return;
  }

  if (/^\/logos\/[\w-]+\.png$/.test(url.pathname)) {
    const arquivo = path.join(__dirname, url.pathname);
    if (!fs.existsSync(arquivo)) { res.writeHead(404).end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
    fs.createReadStream(arquivo).pipe(res);
    return;
  }

  if (url.pathname.startsWith('/tse/')) {
    const caminho = url.pathname.slice(5);
    if (!/^oficial\/[\w\-./]+$/.test(caminho) || caminho.includes('..')) {
      res.writeHead(400).end('Caminho inválido');
      return;
    }
    try {
      const item = await obter(caminho);
      const cabecalhos = { 'Content-Type': item.tipo, 'Cache-Control': 'no-store' };
      if (item.antigo) cabecalhos['X-Dado-Antigo'] = '1';
      res.writeHead(200, cabecalhos).end(item.corpo);
    } catch (erro) {
      res.writeHead(erro.status === 404 ? 404 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(erro.message);
    }
    return;
  }

  res.writeHead(404).end('Não encontrado');
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(`A porta ${PORTA} já está em uso. O painel provavelmente já está aberto em http://localhost:${PORTA}`);
  } else {
    console.error(erro);
  }
  process.exit(1);
});

servidor.listen(PORTA, '127.0.0.1', () => {
  const endereco = `http://localhost:${PORTA}`;
  console.log('Painel de apuração 2026 rodando em ' + endereco);
  console.log('Deixe esta janela aberta. Para encerrar, feche a janela ou aperte Ctrl+C.');
  if (process.argv.includes('--abrir')) exec(`start "" "${endereco}"`);
});

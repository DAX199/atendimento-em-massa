import http from 'node:http';
import QRCode from 'qrcode-terminal/vendor/QRCode/index.js';
import QRErrorCorrectLevel from 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js';

// shortcut: draws the QR with the encoder bundled in qrcode-terminal; switch to the `qrcode` package if that path moves.
export function qrSvg(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules[r][c]) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" width="320" height="320" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}"/></svg>`;
}

export function panelPage({ open, qr, code }) {
  const body = open
    ? '<p class="big">✅ WhatsApp conectado. Não precisa escanear nada.</p>'
    : code
      ? `<p>No celular do robô: <b>Linked devices &gt; Link a device &gt; Link with phone number instead</b>, e digite:</p><p class="code">${code}</p>`
      : qr
        ? `<p>No celular do robô: <b>Linked devices &gt; Link a device</b>, e aponte a câmera:</p>${qrSvg(qr)}`
        : '<p class="big">Conectando ao WhatsApp…</p>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>Robô de WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;text-align:center;color:#111;background:#fff}.big{font-size:1.2em}.code{font-size:2em;font-weight:700;letter-spacing:.15em}svg{display:block;margin:16px auto}small{color:#666}</style></head>
<body><h1>Robô de WhatsApp</h1>${body}<small>Esta página se atualiza sozinha a cada 5 segundos.</small></body></html>`;
}

// Whoever sees the QR can link the WhatsApp account, so the panel only listens on this machine.
export function startPanel({ port, wa, log = console }) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(panelPage(wa.status()));
    })
    .on('error', (e) => log.error(`Painel do QR não abriu na porta ${port}: ${e.message}`))
    .listen(port, '127.0.0.1', () => log.log(`Painel do QR: http://127.0.0.1:${port}`));
}

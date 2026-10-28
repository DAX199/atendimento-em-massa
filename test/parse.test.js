import assert from 'node:assert/strict';
import test from 'node:test';
import { claudeReplier, toTurns } from '../src/ai.js';
import { panelPage, qrSvg } from '../src/panel.js';
import { parseMessage } from '../src/whatsapp.js';

test('parseMessage ignora grupos, status e reações', () => {
  assert.equal(parseMessage({ key: { remoteJid: '1203@g.us', id: '1' }, message: { conversation: 'oi' } }), null);
  assert.equal(parseMessage({ key: { remoteJid: 'status@broadcast', id: '2' }, message: { conversation: 'oi' } }), null);
  assert.equal(parseMessage({ key: { remoteJid: '5511999990000@s.whatsapp.net', id: '3' }, message: { reactionMessage: { text: '👍' } } }), null);
});

test('parseMessage lê texto, número de contato LID e legenda de mídia', () => {
  const key = { remoteJid: '5511999990000@s.whatsapp.net', id: 'A', fromMe: false };
  assert.deepEqual(parseMessage({ key, pushName: 'Ana', message: { extendedTextMessage: { text: 'oi' } } }), {
    id: 'A',
    jid: '5511999990000@s.whatsapp.net',
    phone: '+5511999990000',
    name: 'Ana',
    fromMe: false,
    text: 'oi',
    media: null,
  });
  const lid = parseMessage({ key: { remoteJid: '123456@lid', remoteJidAlt: '5511888880000@s.whatsapp.net', id: 'B' }, message: { ephemeralMessage: { message: { conversation: 'olá' } } } });
  assert.equal(lid.phone, '+5511888880000');
  assert.equal(lid.text, 'olá');
  const img = parseMessage({ key: { ...key, id: 'C' }, message: { imageMessage: { caption: 'foto do produto' } } });
  assert.deepEqual([img.media, img.text], ['imagem', '[imagem] foto do produto']);
});

test('toTurns junta mensagens seguidas, ignora notas e atividades e começa pelo cliente', () => {
  const turns = toTurns([
    { message_type: 3, content: 'Bem-vindo!' },
    { message_type: 0, content: 'oi' },
    { message_type: 0, content: 'tudo bem?' },
    { message_type: 1, content: 'nota interna', private: true },
    { message_type: 2, content: 'Bia assumiu a conversa' },
    { message_type: 1, content: 'Tudo ótimo!' },
  ]);
  assert.deepEqual(turns, [
    { role: 'user', content: 'oi\ntudo bem?' },
    { role: 'assistant', content: 'Tudo ótimo!' },
  ]);
});

test('claudeReplier monta o pedido, liga o fallback fora do Haiku e trata recusa', async () => {
  let req;
  const client = {
    beta: {
      messages: {
        create: async (r) => {
          req = r;
          return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Olá!' }] };
        },
      },
    },
  };
  const reply = claudeReplier({ model: 'claude-opus-5-5', business: 'Pizzaria do Zé', timezone: 'America/Sao_Paulo', client });
  const turns = [{ role: 'user', content: 'oi' }];
  assert.equal(await reply(turns), 'Olá!');
  assert.deepEqual(turns, [{ role: 'user', content: 'oi' }]);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.match(req.system, /<informacoes_do_negocio>\nPizzaria do Zé\n<\/informacoes_do_negocio>/);
  assert.match(req.messages[0].content, /^\[Agora: .+\]\noi$/);

  await claudeReplier({ model: 'claude-haiku-5-5', business: 'X', timezone: 'UTC', client })(turns);
  assert.equal(req.fallbacks, undefined);

  client.beta.messages.create = async () => ({ stop_reason: 'refusal', stop_details: { category: 'bio' }, content: [] });
  await assert.rejects(reply(turns), /recusou \(bio\)/);
});

test('painel mostra o QR, o código ou "conectado"', () => {
  assert.match(qrSvg('2@exemplo,de,qr'), /^<svg [^>]*viewBox="0 0 (\d+) \1"[^>]*>.*<path d="M\d/);
  assert.match(panelPage({ open: false, qr: '2@exemplo', code: null }), /<svg /);
  assert.match(panelPage({ open: false, qr: '2@exemplo', code: 'ABCD-EFGH' }), /ABCD-EFGH/);
  const connected = panelPage({ open: true, qr: '2@exemplo', code: null });
  assert.match(connected, /WhatsApp conectado/);
  assert.doesNotMatch(connected, /<svg /);
});

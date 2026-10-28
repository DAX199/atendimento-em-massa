import assert from 'node:assert/strict';
import test from 'node:test';
import { createBot } from '../src/bot.js';
import { loadState } from '../src/state.js';

const BOT = 99;
const AGENT = 7;
const JID = '5511999990000@s.whatsapp.net';

// In-memory stand-in for the slice of the Chatwoot API the bot uses.
function fakeChatwoot() {
  let nextMsg = 1;
  let nextConv = 1;
  const convs = new Map();
  const add = (c, m) => {
    const msg = { id: nextMsg++, private: false, ...m };
    c.messages.push(msg);
    return msg;
  };
  const view = (c) => ({
    id: c.id,
    labels: [...c.labels],
    created_at: c.createdAt / 1000,
    meta: { sender: { id: c.id + 100, phone_number: c.phone } },
    messages: c.messages.length ? [c.messages.at(-1)] : [],
  });
  return {
    convs,
    // An agent starts a conversation from Chatwoot ("New conversation").
    start(phone, content) {
      const c = { id: nextConv++, labels: [], messages: [], phone, createdAt: Date.now() };
      convs.set(c.id, c);
      return add(c, { message_type: 1, content, sender_type: 'User', sender_id: AGENT });
    },
    human: (id, content) => add(convs.get(id), { message_type: 1, content, sender_type: 'User', sender_id: AGENT }),
    async incoming({ contact, content, conversation_id }) {
      let c = conversation_id ? convs.get(conversation_id) : contact.phone_number && [...convs.values()].find((x) => x.phone === contact.phone_number);
      if (!c) {
        c = { id: nextConv++, labels: [], messages: [], phone: contact.phone_number ?? null, createdAt: Date.now() };
        convs.set(c.id, c);
      }
      return { conversation: view(c), message: add(c, { message_type: 0, content, sender_type: 'Contact' }) };
    },
    conversations: async () => [...convs.values()].map(view),
    async messages(id, query) {
      const c = convs.get(id);
      const q = new URLSearchParams(query.slice(1));
      const rows = q.has('after') ? c.messages.filter((m) => m.id > Number(q.get('after'))) : c.messages.slice(-Number(q.get('limit')));
      return { payload: rows, meta: { labels: [...c.labels] } };
    },
    send: async (id, content, isPrivate = false) => add(convs.get(id), { message_type: 1, content, private: isPrivate, sender_type: 'User', sender_id: BOT }),
    conversationLabels: async (id) => [...convs.get(id).labels],
    async setLabels(id, labels) {
      convs.get(id).labels = [...labels];
    },
  };
}

function setup({ reply = async () => 'Olá! Custa R$ 50.', ...cfg } = {}) {
  const cw = fakeChatwoot();
  const wa = { sent: [], open: true, isOpen: () => wa.open, sendText: async (jid, text) => wa.sent.push({ jid, text }), resolve: async (p) => (p === '5511000000000' ? null : `${p}@s.whatsapp.net`) };
  const calls = [];
  const bot = createBot({
    cfg: { inboxId: 1, label: 'humano', replyDelayMs: 10, maxRepliesPerHour: 20, ...cfg },
    cw,
    wa,
    reply: async (turns) => {
      calls.push(structuredClone(turns));
      return reply(turns);
    },
    state: loadState('/nonexistent/state.json'),
    save: () => {},
    botUserId: BOT,
    log: { error: () => {} },
  });
  return { cw, wa, bot, calls, texts: () => wa.sent.map((s) => s.text) };
}

const settle = async (bot) => {
  await new Promise((r) => setTimeout(r, 40));
  await bot.flush();
};
let n = 0;
const msg = (over = {}) => ({ id: `w${n++}`, jid: JID, phone: '+5511999990000', name: 'Ana', fromMe: false, text: 'Oi, quanto custa?', media: null, ...over });
const notes = (cw) => cw.convs.get(1).messages.filter((m) => m.private).map((m) => m.content);

test('responde o cliente pela IA e registra a resposta no Chatwoot', async () => {
  const { cw, wa, bot, calls } = setup();
  await bot.onMessage(msg());
  await settle(bot);
  assert.deepEqual(calls, [[{ role: 'user', content: 'Oi, quanto custa?' }]]);
  assert.deepEqual(wa.sent, [{ jid: JID, text: 'Olá! Custa R$ 50.' }]);
  assert.deepEqual(cw.convs.get(1).messages.at(-1), { id: 2, private: false, message_type: 1, content: 'Olá! Custa R$ 50.', sender_type: 'User', sender_id: BOT });
});

test('várias mensagens seguidas recebem uma resposta só', async () => {
  const { bot, calls, texts } = setup();
  await bot.onMessage(msg({ text: 'oi' }));
  await bot.onMessage(msg({ text: 'quero fazer um pedido' }));
  await settle(bot);
  assert.deepEqual(calls, [[{ role: 'user', content: 'oi\nquero fazer um pedido' }]]);
  assert.equal(texts().length, 1);
});

test('ignora mensagem repetida', async () => {
  const { bot, calls } = setup();
  const m = msg();
  await bot.onMessage(m);
  await bot.onMessage(m);
  await settle(bot);
  assert.equal(calls.length, 1);
});

test('conversa com a etiqueta humano não recebe resposta do robô', async () => {
  const { cw, bot, calls } = setup();
  await bot.onMessage(msg());
  await settle(bot);
  cw.convs.get(1).labels = ['humano'];
  await bot.onMessage(msg({ text: 'e aí?' }));
  await settle(bot);
  assert.equal(calls.length, 1);
});

test('marcador [[HUMANO]] avisa o cliente, etiqueta e deixa nota privada que não vai ao WhatsApp', async () => {
  const { cw, bot, texts } = setup({ reply: async () => 'Vou chamar um atendente.\n[[HUMANO]] quer desconto no pacote' });
  await bot.onMessage(msg());
  await settle(bot);
  await bot.poll();
  assert.deepEqual(texts(), ['Vou chamar um atendente.']);
  assert.deepEqual(cw.convs.get(1).labels, ['humano']);
  assert.deepEqual(notes(cw), ['🤖 Robô passou para atendimento humano: quer desconto no pacote']);
});

test('se a IA falhar o cliente recebe a mensagem padrão e a conversa vai para humano', async () => {
  const { cw, bot, texts } = setup({
    reply: async () => {
      throw new Error('sem crédito');
    },
  });
  await bot.onMessage(msg());
  await settle(bot);
  assert.deepEqual(texts(), ['Recebi sua mensagem! Um atendente vai te responder em instantes.']);
  assert.deepEqual(cw.convs.get(1).labels, ['humano']);
  assert.match(notes(cw)[0], /a IA falhou \(sem crédito\)/);
});

test('mídia vai direto para humano sem chamar a IA', async () => {
  const { cw, bot, calls, texts } = setup();
  await bot.onMessage(msg({ media: 'áudio', text: '[áudio]' }));
  await settle(bot);
  assert.equal(calls.length, 0);
  assert.match(texts()[0], /só consigo ler mensagens de texto/);
  assert.deepEqual(cw.convs.get(1).labels, ['humano']);
});

test('resposta de atendente no Chatwoot vai ao WhatsApp uma vez e cala o robô', async () => {
  const { cw, bot, calls, texts } = setup();
  await bot.onMessage(msg());
  await settle(bot);
  cw.human(1, 'Oi Ana, aqui é a Bia!');
  await bot.poll();
  await bot.poll();
  assert.deepEqual(texts(), ['Olá! Custa R$ 50.', 'Oi Ana, aqui é a Bia!']);
  assert.deepEqual(cw.convs.get(1).labels, ['humano']);
  await bot.onMessage(msg({ text: 'obrigada' }));
  await settle(bot);
  assert.equal(calls.length, 1);
});

test('com o WhatsApp desconectado a mensagem do atendente espera a reconexão', async () => {
  const { cw, wa, bot, texts } = setup();
  await bot.onMessage(msg());
  await settle(bot);
  cw.human(1, 'Já te atendo');
  wa.open = false;
  await bot.poll();
  wa.open = true;
  await bot.poll();
  assert.deepEqual(texts(), ['Olá! Custa R$ 50.', 'Já te atendo']);
});

test('limite de respostas por hora passa a conversa para humano', async () => {
  const { cw, bot, calls } = setup({ maxRepliesPerHour: 1 });
  await bot.onMessage(msg());
  await settle(bot);
  await bot.onMessage(msg({ text: 'de novo' }));
  await settle(bot);
  assert.equal(calls.length, 1);
  assert.deepEqual(cw.convs.get(1).labels, ['humano']);
  assert.match(notes(cw)[0], /limite de 1 respostas/);
});

test('mensagem enviada pelo celular do dono cala o robô', async () => {
  const { cw, bot } = setup();
  await bot.onMessage(msg());
  await settle(bot);
  await bot.onMessage(msg({ fromMe: true, text: 'Pode vir às 15h' }));
  assert.deepEqual(cw.convs.get(1).labels, ['humano']);
});

test('cliente sem número visível (LID) continua na mesma conversa', async () => {
  const { cw, bot } = setup();
  const lid = { jid: '123456@lid', phone: null };
  await bot.onMessage(msg({ ...lid, text: 'oi' }));
  await settle(bot);
  cw.convs.get(1).labels = ['humano'];
  await bot.onMessage(msg({ ...lid, text: 'alguém aí?' }));
  await settle(bot);
  assert.equal(cw.convs.size, 1);
  assert.deepEqual(cw.convs.get(1).messages.filter((m) => m.message_type === 0).map((m) => m.content), ['oi', 'alguém aí?']);
});

test('conversa iniciada pelo atendente no Chatwoot vai para o WhatsApp do número', async () => {
  const { cw, wa, bot } = setup();
  cw.start('+5531988887777', 'Oi! Seu pedido chegou.');
  await bot.poll();
  assert.deepEqual(wa.sent, [{ jid: '5531988887777@s.whatsapp.net', text: 'Oi! Seu pedido chegou.' }]);
  assert.deepEqual(cw.convs.get(1).labels, ['humano']);
});

test('número que não está no WhatsApp vira nota no Chatwoot', async () => {
  const { cw, wa, bot } = setup();
  cw.start('+5511000000000', 'Oi');
  await bot.poll();
  assert.equal(wa.sent.length, 0);
  assert.deepEqual(notes(cw), ['⚠️ Mensagem não enviada ao WhatsApp: este número não está no WhatsApp']);
});

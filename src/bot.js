import { HANDOFF, toTurns } from './ai.js';

const HOUR = 3600e3;
const FALLBACK_REPLY = 'Recebi sua mensagem! Um atendente vai te responder em instantes.';
const MEDIA_REPLY = 'Por aqui eu só consigo ler mensagens de texto. Um atendente vai ver o que você enviou e já te responde!';
const TRANSFER_REPLY = 'Vou chamar um atendente para te ajudar, só um instante!';

/**
 * WhatsApp <-> Chatwoot bridge with an AI first responder. The bot stays quiet in any conversation
 * carrying cfg.label; a human reply in Chatwoot or from the phone adds it, removing it hands the chat back.
 */
export function createBot({ cfg, cw, wa, reply, state, save, botUserId, log = console, now = Date.now }) {
  const timers = new Map();
  const busy = new Map();
  state.since ??= now();

  // One job at a time per conversation, so two answers never race.
  function queue(convId, fn) {
    const p = (busy.get(convId) || Promise.resolve()).then(fn).catch((e) => log.error(`[conversa ${convId}] ${e.message}`));
    busy.set(convId, p);
    p.then(() => busy.get(convId) === p && busy.delete(convId));
    return p;
  }

  async function addLabel(convId) {
    const labels = await cw.conversationLabels(convId);
    if (!labels.includes(cfg.label)) await cw.setLabels(convId, [...labels, cfg.label]);
  }

  async function say(convId, jid, text) {
    await wa.sendText(jid, text);
    (state.replies[jid] ||= []).push(now());
    save();
    await cw.send(convId, text).catch((e) => log.error(`[conversa ${convId}] enviada no WhatsApp, mas não registrada no Chatwoot: ${e.message}`));
  }

  async function handoff(convId, jid, customerText, note) {
    await addLabel(convId);
    await cw.send(convId, `🤖 Robô passou para atendimento humano: ${note}`, true);
    if (customerText) await say(convId, jid, customerText);
  }

  function overLimit(jid) {
    const recent = (state.replies[jid] || []).filter((t) => now() - t < HOUR);
    state.replies[jid] = recent;
    return recent.length >= cfg.maxRepliesPerHour;
  }

  async function answer(convId, jid) {
    const { payload, meta } = await cw.messages(convId, '?limit=20');
    if (meta.labels.includes(cfg.label)) return;
    const turns = toTurns(payload);
    if (turns.at(-1)?.role !== 'user') return; // someone already answered
    if (overLimit(jid)) return handoff(convId, jid, null, `limite de ${cfg.maxRepliesPerHour} respostas automáticas por hora atingido`);
    let text;
    try {
      text = await reply(turns);
    } catch (e) {
      log.error(`[conversa ${convId}] IA falhou: ${e.message}`);
      return handoff(convId, jid, FALLBACK_REPLY, `a IA falhou (${e.message})`);
    }
    const cut = text.indexOf(HANDOFF);
    try {
      await say(convId, jid, (cut === -1 ? text : text.slice(0, cut)).trim() || TRANSFER_REPLY);
    } catch (e) {
      return handoff(convId, jid, null, `não consegui enviar a resposta no WhatsApp (${e.message})`);
    }
    if (cut !== -1) await handoff(convId, jid, null, text.slice(cut + HANDOFF.length).trim() || 'cliente pediu atendimento');
  }

  async function onMessage(m) {
    if (state.seen[m.id]) return;
    state.seen[m.id] = now();
    save();
    // The owner answered from the phone: the bot steps aside.
    if (m.fromMe) return state.convByJid[m.jid] && addLabel(state.convByJid[m.jid]);
    const known = state.contactByJid[m.jid];
    const who = m.phone
      ? { contact: { name: m.name || m.phone, phone_number: m.phone } }
      : known
        ? { contact_id: known, conversation_id: state.convByJid[m.jid] } // without a phone Chatwoot can't find the conversation itself
        : { contact: { name: m.name || 'Cliente WhatsApp' } };
    const { conversation: c } = await cw.incoming({ inbox_id: cfg.inboxId, content: m.text, ...who });
    state.jidByConv[c.id] = m.jid;
    state.convByJid[m.jid] = c.id;
    state.contactByJid[m.jid] = c.meta?.sender?.id;
    save();
    if (c.labels.includes(cfg.label)) return;
    if (m.media) return queue(c.id, () => handoff(c.id, m.jid, MEDIA_REPLY, `cliente enviou ${m.media}`));
    // Wait a few seconds so several quick messages get one answer, and so replies don't look instant.
    clearTimeout(timers.get(c.id));
    timers.set(
      c.id,
      setTimeout(() => {
        timers.delete(c.id);
        queue(c.id, () => answer(c.id, m.jid));
      }, cfg.replyDelayMs),
    );
  }

  async function forward(c, msg) {
    if (msg.private || ![1, 3].includes(msg.message_type)) return;
    const human = msg.sender_type === 'User';
    if (human && msg.sender_id === botUserId) return;
    try {
      const phone = c.meta?.sender?.phone_number?.replace(/\D/g, '');
      const jid = state.jidByConv[c.id] || (phone && (await wa.resolve(phone)));
      if (!jid) throw new Error('este número não está no WhatsApp');
      if (msg.content) await wa.sendText(jid, msg.content);
      if (msg.attachments?.length) await cw.send(c.id, '⚠️ Anexos ainda não são enviados para o WhatsApp; envie pelo celular.', true);
    } catch (e) {
      await cw.send(c.id, `⚠️ Mensagem não enviada ao WhatsApp: ${e.message}`, true);
    }
    if (human && !c.labels.includes(cfg.label)) {
      await addLabel(c.id);
      c.labels.push(cfg.label);
    }
  }

  // Forwards to WhatsApp what agents (and Chatwoot templates) post in the inbox.
  async function poll() {
    if (!wa.isOpen()) return;
    for (const c of await cw.conversations(cfg.inboxId)) {
      const lastId = c.messages?.[0]?.id ?? 0;
      state.cursor[c.id] ??= c.created_at * 1000 >= state.since ? 0 : lastId;
      if (lastId <= state.cursor[c.id]) continue;
      const { payload } = await cw.messages(c.id, `?after=${state.cursor[c.id]}&limit=100`);
      for (const msg of payload) {
        state.cursor[c.id] = msg.id; // advance first: a message is never sent twice, a failure becomes a private note
        save();
        await forward(c, msg).catch((e) => log.error(`[conversa ${c.id}] ${e.message}`));
      }
    }
  }

  return { onMessage, poll, flush: () => Promise.all(busy.values()) };
}

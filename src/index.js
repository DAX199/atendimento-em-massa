import { claudeReplier } from './ai.js';
import { createBot } from './bot.js';
import { startPanel } from './panel.js';
import { chatwootClient } from './chatwoot.js';
import { loadConfig } from './config.js';
import { loadState, saveState } from './state.js';
import { startWhatsApp } from './whatsapp.js';

const cfg = loadConfig();
const cw = chatwootClient(cfg.chatwoot);
const me = await cw.profile();
if (!(await cw.labels()).some((l) => l.title === cfg.label)) {
  // Chatwoot silently drops unknown labels, and without this one the bot would never stop for a human.
  console.error(`Crie a etiqueta "${cfg.label}" no Chatwoot (Settings > Labels) e rode de novo.`);
  process.exit(3);
}
const state = loadState(cfg.stateFile);
// Without a key the bot still records, acknowledges and hands every conversation to a human.
const reply = process.env.ANTHROPIC_API_KEY
  ? claudeReplier(cfg)
  : async () => {
      throw new Error('sem ANTHROPIC_API_KEY no .env');
    };
let bot;
const wa = await startWhatsApp({ authDir: cfg.authDir, pairingPhone: cfg.pairingPhone, onMessage: (m) => bot.onMessage(m) });
startPanel({ port: cfg.panelPort, wa });
bot = createBot({
  cfg,
  cw,
  wa,
  reply,
  state,
  save: () => saveState(cfg.stateFile, state),
  botUserId: me.id,
});
console.log(`Robô "${me.name}" (usuário ${me.id}) na caixa ${cfg.inboxId}, ${process.env.ANTHROPIC_API_KEY ? `modelo ${cfg.model}` : 'sem IA (falta ANTHROPIC_API_KEY): confirma o recebimento e passa para humano'}.`);

let polling = false;
setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    await bot.poll();
  } catch (e) {
    console.error(`Leitura do Chatwoot falhou: ${e.message}`);
  } finally {
    polling = false;
  }
}, cfg.pollMs);

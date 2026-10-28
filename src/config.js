import fs from 'node:fs';
import path from 'node:path';

// One folder per client (.env, negocio.md, auth/, data/); defaults to the current directory.
export function loadConfig(dir = process.env.BOT_DIR || process.cwd()) {
  const envFile = path.join(dir, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const env = process.env;
  const need = (k) => {
    if (!env[k]) throw new Error(`Falta ${k} no .env (veja .env.example)`);
    return env[k];
  };
  return {
    dir,
    authDir: path.join(dir, 'auth'),
    stateFile: path.join(dir, 'data', 'state.json'),
    business: fs.readFileSync(path.join(dir, 'negocio.md'), 'utf8'),
    chatwoot: { url: need('CHATWOOT_URL').replace(/\/$/, ''), accountId: need('CHATWOOT_ACCOUNT_ID'), token: need('CHATWOOT_BOT_TOKEN') },
    inboxId: Number(need('CHATWOOT_INBOX_ID')),
    panelPort: Number(env.PANEL_PORT || 3300),
    pairingPhone: env.PAIRING_PHONE?.replace(/\D/g, '') || null,
    model: env.CLAUDE_MODEL || 'claude-opus-5-5',
    timezone: env.BOT_TIMEZONE || 'America/Sao_Paulo',
    label: 'humano',
    pollMs: 3000,
    replyDelayMs: 4000,
    maxRepliesPerHour: 20,
  };
}

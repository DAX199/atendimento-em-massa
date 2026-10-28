import fs from 'node:fs';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  jidDecode,
  normalizeMessageContent,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const MEDIA = {
  audioMessage: 'áudio',
  imageMessage: 'imagem',
  videoMessage: 'vídeo',
  documentMessage: 'documento',
  locationMessage: 'localização',
  liveLocationMessage: 'localização',
  contactMessage: 'contato',
  contactsArrayMessage: 'contato',
};

const phoneOf = (jid) => (jid?.endsWith('@s.whatsapp.net') ? `+${jidDecode(jid).user}` : null);

/** Baileys message -> { id, jid, phone, name, fromMe, text, media }, or null if it is not a one-to-one chat message. */
export function parseMessage(msg) {
  const jid = msg.key?.remoteJid;
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return null;
  const content = normalizeMessageContent(msg.message);
  const type = getContentType(content);
  const media = MEDIA[type] || null;
  const text = content?.conversation || content?.extendedTextMessage?.text || null;
  if (!text && !media) return null; // reactions, stickers, edits, deletions, protocol messages
  const caption = content[type]?.caption;
  return {
    id: msg.key.id,
    jid,
    phone: phoneOf(jid) || phoneOf(msg.key.remoteJidAlt),
    name: msg.pushName || null,
    fromMe: !!msg.key.fromMe,
    text: media ? `[${media}]${caption ? ` ${caption}` : ''}` : text,
    media,
  };
}

/** Connects (printing a QR code until paired), reconnects on drops and hands each parsed message to onMessage. */
export async function startWhatsApp({ authDir, pairingPhone = null, onMessage, log = console }) {
  fs.mkdirSync(authDir, { recursive: true });
  fs.chmodSync(authDir, 0o700); // the WhatsApp session lives here
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sent = new Map(); // our own messages: answers Baileys retry requests and filters our echoes
  let sock;
  let open = false;
  let qrText = null; // what the local panel shows
  let pairCode = null;

  function connect() {
    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'warn' }),
      markOnlineOnConnect: false, // keeps notifications on the owner's phone
      getMessage: async (key) => sent.get(key.id)?.message,
    });
    sock.ev.on('creds.update', saveCreds);
    let codeAsked = false;
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr && pairingPhone) {
        // The QR refreshes every few seconds; asking again would invalidate the code being typed.
        if (!codeAsked) {
          codeAsked = true;
          sock.requestPairingCode(pairingPhone).then(
            (code) => log.log(`Código para conectar: ${(pairCode = `${code.slice(0, 4)}-${code.slice(4)}`)}\nNo celular do robô: Linked devices > Link a device > Link with phone number instead, e digite o código.`),
            (e) => log.error(`Não consegui gerar o código de conexão: ${e.message}`),
          );
        }
      } else if (qr) {
        qrText = qr;
        log.log('Escaneie com o WhatsApp do robô (Linked devices > Link a device):');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        open = true;
        qrText = pairCode = null;
        log.log('WhatsApp conectado.');
      }
      if (connection === 'close') {
        open = false;
        qrText = pairCode = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          log.error('O WhatsApp desconectou este aparelho. Apague a pasta auth/ e rode `npm start` no terminal para escanear o QR de novo.');
          process.exit(3); // the systemd unit does not restart on 3
        }
        log.warn(`Conexão com o WhatsApp caiu (${code ?? lastDisconnect?.error?.message}); reconectando...`);
        setTimeout(connect, 3000);
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const raw of messages) {
        // Customer messages arrive as "notify"; the owner's own messages from the phone may come as either type.
        if ((type !== 'notify' && !raw.key.fromMe) || sent.has(raw.key.id)) continue;
        const m = parseMessage(raw);
        if (!m) continue;
        if (!m.phone && isLidUser(m.jid)) m.phone = phoneOf(await sock.signalRepository.lidMapping.getPNForLID(m.jid).catch(() => null));
        await onMessage(m).catch((e) => log.error(`Mensagem ${m.id} de ${m.phone || m.jid}: ${e.message}`));
      }
    });
  }

  connect();
  return {
    isOpen: () => open,
    status: () => ({ open, qr: qrText, code: pairCode }),
    // A typed number may differ from its WhatsApp id (e.g. Brazilian numbers with or without the extra 9).
    async resolve(phone) {
      const [r] = (await sock.onWhatsApp(phone)) || [];
      return r?.exists ? r.jid : null;
    },
    async sendText(jid, text) {
      const msg = await sock.sendMessage(jid, { text });
      sent.set(msg.key.id, msg);
      if (sent.size > 500) sent.delete(sent.keys().next().value);
    },
  };
}

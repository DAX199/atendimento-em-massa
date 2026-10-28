# Robô de WhatsApp para o Chatwoot

Responde os clientes no WhatsApp na hora, com IA (Claude) e as informações do negócio. Toda conversa aparece no Chatwoot, e um atendente pode assumir a qualquer momento.

**Não altera nada no Chatwoot.** Usa só a API dele, como qualquer integração.

## Como funciona
- Cliente manda mensagem → ela entra no Chatwoot → o robô responde no WhatsApp (e a resposta fica registrada no Chatwoot como "Robô").
- O robô para de responder numa conversa quando ela recebe a etiqueta **`humano`**. Isso acontece quando:
  - um atendente responde pelo Chatwoot (a resposta vai para o WhatsApp do cliente);
  - alguém responde direto pelo celular do negócio;
  - a IA percebe que precisa de uma pessoa (pedido de desconto, reclamação, assunto que não está no `negocio.md`): ela avisa o cliente e deixa uma nota privada com o resumo;
  - o cliente manda áudio, foto ou documento (o robô só lê texto);
  - a IA falha, ou o contato passa de 20 respostas automáticas por hora.
- **Para devolver a conversa ao robô:** tire a etiqueta `humano` no Chatwoot. Conversa resolvida que volta a ter mensagem nova começa sem etiqueta.

## Preparar o Chatwoot (uma vez por cliente, pela tela)
1. **Settings > Labels:** crie a etiqueta `humano`. Sem ela o robô não inicia: o Chatwoot ignora etiquetas que não existem, e o robô nunca pararia.
2. **Settings > Inboxes:** crie uma caixa do tipo **WhatsApp** com o número do negócio. Tem que ser do tipo WhatsApp; no tipo API o Chatwoot abre uma conversa nova a cada mensagem. Deixe **desligadas** a saudação e a mensagem de fora do horário (a IA já cuida disso; se ligar, elas também são enviadas ao cliente).
3. **Settings > Agents:** crie o usuário "Robô" como **Administrator** e **não** o coloque como membro da caixa (assim ele não recebe conversas atribuídas). Entre uma vez como Robô com a senha temporária que aparece e copie o token em **Profile settings > Access token**.

## Instalar
```bash
git clone https://github.com/DAX199/atendimento-em-massa.git ~/whatsapp-bot
cd ~/whatsapp-bot && npm install
```

## Configurar um cliente
Cada cliente tem a sua pasta, com um arquivo `.env`, o `negocio.md` e a sessão do WhatsApp (`auth/`, criada sozinha):
```bash
mkdir -p ~/whatsapp-bot-clientes/loja-exemplo && cd ~/whatsapp-bot-clientes/loja-exemplo
cp ~/whatsapp-bot/negocio.example.md negocio.md     # dados reais do negócio
```
Crie nessa pasta um arquivo `.env` com estas variáveis (ele nunca vai para o GitHub):
- `CHATWOOT_URL`: endereço do Chatwoot.
- `CHATWOOT_ACCOUNT_ID`: número da conta (aparece na URL: `/app/accounts/<número>/...`).
- `CHATWOOT_INBOX_ID`: número da caixa WhatsApp (aparece na URL ao abrir a caixa em **Settings > Inboxes**).
- `CHATWOOT_BOT_TOKEN`: token do usuário Robô (**Profile settings > Access token**).
- Opcionais: `ANTHROPIC_API_KEY` (vazia = sem IA), `CLAUDE_MODEL` (padrão `claude-opus-5-5`; mais barato: `claude-haiku-5-5`), `PANEL_PORT` (padrão 3300, uma por cliente), `PAIRING_PHONE` (conectar por código em vez de QR), `BOT_TIMEZONE` (padrão `America/Sao_Paulo`).

Primeira execução, para conectar o WhatsApp:
```bash
node ~/whatsapp-bot/src/index.js     # escaneie o QR com o celular do negócio
```
Rodar sempre (reinicia sozinho se cair). Antes, ajuste no arquivo do serviço o caminho do `node` (veja `which node`):
```bash
cp ~/whatsapp-bot/deploy/whatsapp-bot@.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now whatsapp-bot@loja-exemplo
journalctl --user -u whatsapp-bot@loja-exemplo -f      # ver o que está acontecendo
```
Com o robô rodando, o QR também aparece na página **http://127.0.0.1:3300** (cada cliente com a sua `PANEL_PORT` no `.env`). Só é preciso escanear na primeira vez: a sessão fica salva na pasta `auth/` e o robô reconecta sozinho. Se o QR não funcionar, preencha `PAIRING_PHONE` no `.env` com o número do robô (ex.: `5511999990000`): o robô mostra um código de 8 letras para digitar no celular em **Linked devices > Link a device > Link with phone number instead**. Para testar, mande uma mensagem de outro celular para o número do negócio. Se o WhatsApp desconectar o aparelho, o serviço para (para não ficar gerando QR). Apague a pasta `auth/` do cliente e rode o `index.js` no terminal para escanear de novo.

## Custos e cuidados
- Sem `ANTHROPIC_API_KEY` o robô funciona sem IA: registra a mensagem, responde "Recebi sua mensagem..." e passa a conversa para humano.
- Modelo padrão `claude-opus-5-5`: cerca de US$ 0,01 por resposta. `CLAUDE_MODEL=claude-haiku-5-5` no `.env` custa cerca de 40 vezes menos.
- O Baileys **não é oficial**: o WhatsApp pode banir o número. Use um número dedicado. O robô só responde, nunca inicia conversa.
- O Chatwoot só deixa o atendente responder até 24 h depois da última mensagem do cliente (regra da caixa WhatsApp dele).
- A resposta do atendente leva até 3 s para chegar ao WhatsApp. Anexos enviados pelo Chatwoot não vão ao WhatsApp nesta versão: mande pelo celular.

## Desenvolvimento
`npm test` roda os testes, com Chatwoot, WhatsApp e Claude falsos.

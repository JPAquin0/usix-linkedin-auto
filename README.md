# usix-linkedin-auto

Bot Telegram para revisar posts do LinkedIn antes de publicar.

## O que faz

- Recebe rascunho do n8n em `POST /draft`
- Gera imagem local automaticamente
- Envia prévia para o Telegram
- Botões: Publicar, Refazer texto, Refazer imagem, Refazer tudo, Cancelar
- Publica no LinkedIn via API quando você aprova

## Instalação

```bash
cd usix-linkedin-auto
cp .env.example .env
npm install
npm start
```

## Chat ID

1. Rode o bot.
2. Envie `/start` no Telegram.
3. O bot responde com seu chat id.
4. Coloque esse número em `TELEGRAM_REVIEW_CHAT_ID`.

## n8n

No node `Enviar para bot Telegram`:

- URL: `https://SEU_DOMINIO_DO_BOT.com/draft`
- Header `X-Bot-Secret`: mesmo valor de `BOT_SHARED_SECRET`
- Body: `{{$json}}`

import 'dotenv/config';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import crypto from 'crypto';

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_REVIEW_CHAT_ID,
  BOT_SHARED_SECRET,
  PORT = 3000,
  GROQ_API_KEY,
  GROQ_MODEL = 'llama-3.3-70b-versatile',
  LINKEDIN_ACCESS_TOKEN,
  LINKEDIN_AUTHOR_URN,
  LINKEDIN_API_VERSION = '202506',
} = process.env;

if (!TELEGRAM_BOT_TOKEN) throw new Error('Falta TELEGRAM_BOT_TOKEN no .env');

const app = express();
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const pending = new Map();

app.use(express.json({ limit: '2mb' }));

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function keyboard(draftId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Publicar', `publish:${draftId}`)],
    [Markup.button.callback('✍️ Refazer texto', `redo_text:${draftId}`)],
    [Markup.button.callback('🔄 Refazer tudo', `redo_all:${draftId}`)],
    [Markup.button.callback('❌ Cancelar', `cancel:${draftId}`)],
  ]);
}

function previewCaption(draft) {
  const post = draft.linkedin_post || '';
  const src = draft.source_url ? `\n\nFonte: ${draft.source_url}` : '';
  const text = post.length > 3600 ? `${post.slice(0, 3600)}...` : post;
  return `🧠 Prévia LinkedIn\n\n${text}${src}`;
}

async function sendDraftToTelegram(draft) {
  if (!TELEGRAM_REVIEW_CHAT_ID) throw new Error('Falta TELEGRAM_REVIEW_CHAT_ID no .env');

  await bot.telegram.sendMessage(
    TELEGRAM_REVIEW_CHAT_ID,
    previewCaption(draft),
    {
      ...keyboard(draft.id),
      disable_web_page_preview: false,
    }
  );
}

async function groq(messages, temperature = 0.85) {
  if (!GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY no .env');

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      temperature,
      max_tokens: 1600,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function redoText(draft) {
  const content = await groq([
    {
      role: 'system',
      content: 'Você é um fundador/CTO escrevendo posts fortes para LinkedIn sobre IA, programação, automação, agentes, ferramentas dev e negócios digitais. Seja específico, opinativo e útil.',
    },
    {
      role: 'user',
      content: `Refaça este post para LinkedIn mantendo a fonte, mas deixe mais forte, menos genérico e mais prático.

Fonte: ${draft.source_title || ''}
URL: ${draft.source_url || ''}
Post atual:
${draft.linkedin_post}

Regras:
- português do Brasil
- 900 a 1400 caracteres
- gancho forte
- 3 insights práticos
- opinião clara
- pergunta final
- 5 a 8 hashtags
- retorne somente o texto final`,
    },
  ]);

  draft.linkedin_post = content;
  draft.updated_at = new Date().toISOString();
  return draft;
}

async function redoAll(draft) {
  const content = await groq([
    {
      role: 'system',
      content: 'Você é um fundador/CTO escrevendo posts fortes para LinkedIn sobre IA, programação, automação, agentes, ferramentas dev e negócios digitais. Seja específico, opinativo e útil.',
    },
    {
      role: 'user',
      content: `Crie uma nova versão completa para LinkedIn com base neste rascunho e fonte.

Fonte: ${draft.source_title || ''}
URL: ${draft.source_url || ''}
Rascunho atual:
${draft.linkedin_post}

Regras:
- português do Brasil
- 900 a 1400 caracteres
- abertura forte
- sem clichês
- explique por que importa para devs, IA, automação ou negócios digitais
- 3 insights práticos
- opinião clara
- pergunta final
- fonte no final
- 5 a 8 hashtags
- retorne somente o texto final`,
    },
  ]);

  draft.linkedin_post = content;
  draft.updated_at = new Date().toISOString();
  return draft;
}

async function publishLinkedIn(draft) {
  if (!LINKEDIN_ACCESS_TOKEN || !LINKEDIN_AUTHOR_URN) {
    throw new Error('Falta LINKEDIN_ACCESS_TOKEN ou LINKEDIN_AUTHOR_URN no .env');
  }

  const body = {
    author: LINKEDIN_AUTHOR_URN,
    commentary: draft.linkedin_post,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  const { data } = await axios.post('https://api.linkedin.com/rest/posts', body, {
    headers: {
      Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    timeout: 60000,
  });

  return data;
}

bot.start(async (ctx) => {
  await ctx.reply(`Bot ativo ✅\n\nSeu chat id é:\n${ctx.chat.id}\n\nColoque esse valor em TELEGRAM_REVIEW_CHAT_ID no .env.`);
});

bot.command('ping', async (ctx) => {
  await ctx.reply('pong ✅');
});

bot.command('pending', async (ctx) => {
  const items = [...pending.values()];
  if (!items.length) return ctx.reply('Nenhum rascunho pendente.');

  await ctx.reply(items.map((d) => `• ${d.id} — ${(d.linkedin_post || '').slice(0, 60)}...`).join('\n'));
});

bot.action(/^publish:(.+)/, async (ctx) => {
  const draft = pending.get(ctx.match[1]);
  if (!draft) return ctx.answerCbQuery('Rascunho não encontrado.');

  await ctx.answerCbQuery('Publicando...');

  try {
    await publishLinkedIn(draft);
    pending.delete(draft.id);
    await ctx.reply('Publicado no LinkedIn ✅');
  } catch (error) {
    await ctx.reply(`Erro ao publicar:\n${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
  }
});

bot.action(/^redo_text:(.+)/, async (ctx) => {
  const draft = pending.get(ctx.match[1]);
  if (!draft) return ctx.answerCbQuery('Rascunho não encontrado.');

  await ctx.answerCbQuery('Refazendo texto...');

  try {
    await redoText(draft);
    await sendDraftToTelegram(draft);
  } catch (error) {
    await ctx.reply(`Erro ao refazer texto:\n${error.message}`);
  }
});

bot.action(/^redo_all:(.+)/, async (ctx) => {
  const draft = pending.get(ctx.match[1]);
  if (!draft) return ctx.answerCbQuery('Rascunho não encontrado.');

  await ctx.answerCbQuery('Refazendo tudo...');

  try {
    await redoAll(draft);
    await sendDraftToTelegram(draft);
  } catch (error) {
    await ctx.reply(`Erro ao refazer tudo:\n${error.message}`);
  }
});

bot.action(/^cancel:(.+)/, async (ctx) => {
  const draft = pending.get(ctx.match[1]);
  if (draft) pending.delete(draft.id);

  await ctx.answerCbQuery('Cancelado');
  await ctx.reply('Rascunho cancelado ❌');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'usix-linkedin-auto' });
});

app.post('/draft', async (req, res) => {
  try {
    if (BOT_SHARED_SECRET && req.header('X-Bot-Secret') !== BOT_SHARED_SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const draft = {
      id: id(),
      linkedin_post: req.body.linkedin_post,
      source_title: req.body.source_title,
      source_url: req.body.source_url,
      created_at: new Date().toISOString(),
    };

    if (!draft.linkedin_post) {
      return res.status(400).json({ ok: false, error: 'linkedin_post ausente' });
    }

    pending.set(draft.id, draft);
    await sendDraftToTelegram(draft);

    res.json({ ok: true, draft_id: draft.id });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

bot.launch();

app.listen(Number(PORT), () => {
  console.log(`usix-linkedin-auto rodando na porta ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

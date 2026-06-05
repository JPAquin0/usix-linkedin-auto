import 'dotenv/config';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const { TELEGRAM_BOT_TOKEN, TELEGRAM_REVIEW_CHAT_ID, BOT_SHARED_SECRET, PORT = 3000, GROQ_API_KEY, GROQ_MODEL = 'llama-3.3-70b-versatile', LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, LINKEDIN_API_VERSION = '202506', BRAND_NAME = 'U6 DEV Store', BRAND_FOOTER = 'IA • Programação • Automação' } = process.env;
if (!TELEGRAM_BOT_TOKEN) throw new Error('Falta TELEGRAM_BOT_TOKEN no .env');

const app = express();
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const pending = new Map();
app.use(express.json({ limit: '2mb' }));
const imageDir = path.join(process.cwd(), 'data', 'images');
await fs.mkdir(imageDir, { recursive: true });

function id(){ return crypto.randomBytes(8).toString('hex'); }
function esc(s=''){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function wrapText(text, max=28, lines=3){ const words=String(text||'').split(/\s+/).filter(Boolean); const result=[]; let line=''; for(const word of words){ const next=line?`${line} ${word}`:word; if(next.length>max){ if(line) result.push(line); line=word; } else line=next; if(result.length>=lines) break; } if(result.length<lines&&line) result.push(line); return result.slice(0,lines); }

function previewCaption(draft){ const post=draft.linkedin_post||''; const src=draft.source_url?`\n\nFonte: ${draft.source_url}`:''; return `🧠 Prévia LinkedIn\n\n${post.length>3300?post.slice(0,3300)+'...':post}${src}`; }
function keyboard(draftId){ return Markup.inlineKeyboard([[Markup.button.callback('✅ Publicar',`publish:${draftId}`)],[Markup.button.callback('✍️ Refazer texto',`redo_text:${draftId}`),Markup.button.callback('🖼 Refazer imagem',`redo_image:${draftId}`)],[Markup.button.callback('🔄 Refazer tudo',`redo_all:${draftId}`)],[Markup.button.callback('❌ Cancelar',`cancel:${draftId}`)]]); }
async function sendDraftToTelegram(draft){ if(!TELEGRAM_REVIEW_CHAT_ID) throw new Error('Falta TELEGRAM_REVIEW_CHAT_ID no .env'); const  bot.telegram.sendPhoto(TELEGRAM_REVIEW_CHAT_ID,{source:img},{caption:previewCaption(draft),...keyboard(draft.id)}); }
async function groq(messages,temperature=0.85){ if(!GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY no .env'); const {data}=await axios.post('https://api.groq.com/openai/v1/chat/completions',{model:GROQ_MODEL,temperature,max_tokens:1600,messages},{headers:{Authorization:`Bearer ${GROQ_API_KEY}`,'Content-Type':'application/json'},timeout:60000}); return data.choices?.[0]?.message?.content?.trim()||''; }
async function redoText(draft){ const content=await groq([{role:'system',content:'Você é um fundador/CTO escrevendo posts fortes para LinkedIn sobre IA, programação, automação, agentes, ferramentas dev e negócios digitais. Seja específico, opinativo e útil.'},{role:'user',content:`Refaça este post para LinkedIn mantendo a fonte, mas deixe mais forte, menos genérico e mais prático.\n\nFonte: ${draft.source_title}\nURL: ${draft.source_url}\nPost atual:\n${draft.linkedin_post}\n\nRegras: português do Brasil, 900 a 1400 caracteres, gancho forte, 3 bullets práticos, opinião clara, pergunta final, 5 a 8 hashtags. Retorne somente o texto final.`}]); draft.linkedin_post=content; draft.updated_at=new Date().toISOString(); return draft; }
async function redoAll(draft){ const raw=await groq([{role:'system',content:'Você cria posts e conceitos visuais para LinkedIn sobre IA, programação e automação. Retorne somente JSON válido.'},{role:'user',content:`Refaça tudo com mais impacto.\nFonte: ${draft.source_title}\nURL: ${draft.source_url}\nPost atual: ${draft.linkedin_post}\nRetorne JSON: {"linkedin_post":"texto","image_title":"max 52 caracteres","image_subtitle":"max 90 caracteres","image_prompt":"descrição visual"}`}]); const jsonText=raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim(); const parsed=JSON.parse(jsonText.match(/\{[\s\S]*\}/)?.[0]||jsonText); draft.linkedin_post=parsed.linkedin_post||draft.linkedin_post; draft.image_title=parsed.image_title||draft.image_title; draft.image_subtitle=parsed.image_subtitle||draft.image_subtitle; draft.image_prompt=parsed.image_prompt||draft.image_prompt; draft.updated_at=new Date().toISOString(); return draft; }
async function publishLinkedIn(draft){ if(!LINKEDIN_ACCESS_TOKEN||!LINKEDIN_AUTHOR_URN) throw new Error('Falta LINKEDIN_ACCESS_TOKEN ou LINKEDIN_AUTHOR_URN no .env'); const body={author:LINKEDIN_AUTHOR_URN,commentary:draft.linkedin_post,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false}; const {data}=await axios.post('https://api.linkedin.com/rest/posts',body,{headers:{Authorization:`Bearer ${LINKEDIN_ACCESS_TOKEN}`,'Content-Type':'application/json','LinkedIn-Version':LINKEDIN_API_VERSION,'X-Restli-Protocol-Version':'2.0.0'},timeout:60000}); return data; }

bot.start(async ctx=>ctx.reply(`Bot ativo ✅\n\nSeu chat id é:\n${ctx.chat.id}\n\nColoque esse valor em TELEGRAM_REVIEW_CHAT_ID no .env.`));
bot.command('ping',async ctx=>ctx.reply('pong ✅'));
bot.command('pending',async ctx=>{const items=[...pending.values()]; if(!items.length)return ctx.reply('Nenhum rascunho pendente.'); await ctx.reply(items.map(d=>`• ${d.id} — ${d.image_title||d.source_title||'sem título'}`).join('\n'));});
bot.action(/^publish:(.+)/,async ctx=>{const draft=pending.get(ctx.match[1]); if(!draft)return ctx.answerCbQuery('Rascunho não encontrado.'); await ctx.answerCbQuery('Publicando...'); try{await publishLinkedIn(draft); pending.delete(draft.id); await ctx.reply('Publicado no LinkedIn ✅');}catch(error){await ctx.reply(`Erro ao publicar:\n${error.response?.data?JSON.stringify(error.response.data):error.message}`);}});
bot.action(/^redo_text:(.+)/,async ctx=>{const draft=pending.get(ctx.match[1]); if(!draft)return ctx.answerCbQuery('Rascunho não encontrado.'); await ctx.answerCbQuery('Refazendo texto...'); try{await redoText(draft); await sendDraftToTelegram(draft);}catch(error){await ctx.reply(`Erro ao refazer texto:\n${error.message}`);}});
bot.action(/^redo_image:(.+)/,async ctx=>{const oldId=ctx.match[1]; const draft=pending.get(oldId); if(!draft)return ctx.answerCbQuery('Rascunho não encontrado.'); await ctx.answerCbQuery('Refazendo imagem...'); pending.delete(oldId); draft.id=id(); pending.set(draft.id,draft); try{await sendDraftToTelegram(draft);}catch(error){await ctx.reply(`Erro ao refazer imagem:\n${error.message}`);}});
bot.action(/^redo_all:(.+)/,async ctx=>{const oldId=ctx.match[1]; const draft=pending.get(oldId); if(!draft)return ctx.answerCbQuery('Rascunho não encontrado.'); await ctx.answerCbQuery('Refazendo tudo...'); try{await redoAll(draft); pending.delete(oldId); draft.id=id(); pending.set(draft.id,draft); await sendDraftToTelegram(draft);}catch(error){await ctx.reply(`Erro ao refazer tudo:\n${error.message}`);}});
bot.action(/^cancel:(.+)/,async ctx=>{const draft=pending.get(ctx.match[1]); if(draft)pending.delete(draft.id); await ctx.answerCbQuery('Cancelado'); await ctx.reply('Rascunho cancelado ❌');});
app.get('/health',(req,res)=>res.json({ok:true,service:'usix-linkedin-auto'}));
app.post('/draft',async(req,res)=>{try{ if(BOT_SHARED_SECRET && req.header('X-Bot-Secret')!==BOT_SHARED_SECRET)return res.status(401).json({ok:false,error:'unauthorized'}); const draft={id:id(),linkedin_post:req.body.linkedin_post,image_title:req.body.image_title,image_subtitle:req.body.image_subtitle,image_prompt:req.body.image_prompt,source_title:req.body.source_title,source_url:req.body.source_url,created_at:new Date().toISOString()}; if(!draft.linkedin_post)return res.status(400).json({ok:false,error:'linkedin_post ausente'}); pending.set(draft.id,draft); await sendDraftToTelegram(draft); res.json({ok:true,draft_id:draft.id});}catch(error){res.status(500).json({ok:false,error:error.message});}});
bot.launch();
app.listen(Number(PORT),()=>console.log(`usix-linkedin-auto rodando na porta ${PORT}`));
process.once('SIGINT',()=>bot.stop('SIGINT'));
process.once('SIGTERM',()=>bot.stop('SIGTERM'));

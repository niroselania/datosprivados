'use strict';
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');

const app = express();
const PORT = 3000;
const DATA = path.resolve(process.env.DATA_DIR || '/data');
const USER = process.env.APP_USER;
const PASSWORD = process.env.APP_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
const MAX_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));
const CATEGORIES = ['Credenciales', 'Comandos y scripts', 'Procedimientos', 'Planillas', 'Otros'];
const ALLOWED = new Set(['txt','md','csv','tsv','log','ps1','bat','sh','yml','yaml','conf','ini','json','xml','sql','py','crt','pem','doc','docx','xls','xlsx','xlsm','pdf','kdbx','rar','zip']);

if (!USER || !PASSWORD || PASSWORD.length < 14 || !SECRET || SECRET.length < 32) {
  console.error('Configurá APP_USER, APP_PASSWORD (mínimo 14 caracteres) y SESSION_SECRET (mínimo 32 caracteres).');
  process.exit(1);
}
fs.mkdirSync(DATA, { recursive: true });
for (const category of CATEGORIES) fs.mkdirSync(path.join(DATA, category), { recursive: true });
const SESSION_DIR = path.join(DATA, 'sessions');
fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });

class JsonSessionStore extends session.Store {
  constructor() {
    super();
    this.reaper = setInterval(() => this.removeExpired(), 30 * 60 * 1000);
    this.reaper.unref();
  }
  filename(sid) { return path.join(SESSION_DIR, crypto.createHash('sha256').update(sid).digest('hex') + '.json'); }
  get(sid, cb) {
    fs.promises.readFile(this.filename(sid), 'utf8').then(raw => {
      const sess = JSON.parse(raw); const expiry = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : 0;
      if (expiry && expiry <= Date.now()) return this.destroy(sid, () => cb(null, null));
      cb(null, sess);
    }).catch(err => cb(err.code === 'ENOENT' ? null : err, null));
  }
  set(sid, sess, cb = () => {}) {
    const file = this.filename(sid); const temp = file + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
    fs.promises.writeFile(temp, JSON.stringify(sess), { encoding: 'utf8', mode: 0o600 })
      .then(() => fs.promises.rename(temp, file)).then(() => cb(null)).catch(err => { fs.promises.rm(temp, { force: true }).catch(() => {}); cb(err); });
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
  destroy(sid, cb = () => {}) { fs.promises.rm(this.filename(sid), { force: true }).then(() => cb(null)).catch(cb); }
  async removeExpired() {
    try {
      for (const name of await fs.promises.readdir(SESSION_DIR)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(SESSION_DIR, name);
        try { const sess = JSON.parse(await fs.promises.readFile(file, 'utf8')); if (sess.cookie?.expires && new Date(sess.cookie.expires).getTime() <= Date.now()) await fs.promises.rm(file, { force: true }); }
        catch { await fs.promises.rm(file, { force: true }); }
      }
    } catch (e) { console.error('No se pudieron limpiar sesiones expiradas:', e.message); }
  }
}

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '2mb' }));
app.use(session({
  name: 'archivoit.sid', secret: SECRET, resave: false, saveUninitialized: false,
  store: new JsonSessionStore(),
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === '1', maxAge: 8 * 60 * 60 * 1000 }
}));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
const loggedIn = (req, res, next) => req.session.authenticated ? next() : res.status(401).json({ error: 'Iniciá sesión para continuar.' });
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
app.post('/api/login', authLimiter, (req, res) => {
  if (safeEqual(req.body.username || '', USER) && safeEqual(req.body.password || '', PASSWORD)) {
    req.session.regenerate(err => { if (err) return res.status(500).json({ error: 'No se pudo iniciar sesión.' }); req.session.authenticated = true; res.json({ ok: true }); });
  } else res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
});
app.post('/api/logout', loggedIn, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json({ authenticated: Boolean(req.session.authenticated) }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const paths = req.body.sourcePath;
    const source = Array.isArray(paths) ? paths[req.uploadIndex || 0] : paths;
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : req.body.category === 'Auto' ? categoryGuess(`${source || ''} ${file.originalname}`) : 'Otros';
    cb(null, path.join(DATA, category));
  },
  filename: (req, file, cb) => {
    req.uploadIndex = (req.uploadIndex || 0) + 1;
    const original = path.basename(file.originalname).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 160) || 'archivo';
    const ext = path.extname(original); const stem = path.basename(original, ext);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${stem}__${stamp}_${crypto.randomBytes(3).toString('hex')}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: MAX_MB * 1024 * 1024, files: 100 }, fileFilter: (req, file, cb) => {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  const accepted = !ext || ALLOWED.has(ext);
  cb(accepted ? null : new Error('Formato no admitido: ' + ext), accepted);
} });
app.post('/api/upload', loggedIn, (req, res) => upload.array('files', 100)(req, res, err => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Cada archivo puede pesar hasta ${MAX_MB} MB.` : err.message });
  cacheAt = 0;
  res.json({ ok: true, count: (req.files || []).length });
}));

function categoryFor(rel) { return CATEGORIES.find(c => rel.split(path.sep)[0] === c) || 'Otros'; }
function fileType(ext) {
  if (['xlsx','xlsm','csv','tsv'].includes(ext)) return 'Excel';
  if (!ext) return 'Texto';
  if (ext === 'docx') return 'Word';
  if (ext === 'pdf') return 'PDF';
  if (ext === 'kdbx') return 'Vault';
  if (['txt','md','log','ps1','bat','sh','yml','yaml','conf','ini','json','xml','sql','py','crt','pem'].includes(ext)) return 'Texto';
  return 'Otros';
}
function categoryGuess(file) {
  const s = file.toLowerCase();
  if (/credencial|contraseñ|contraseña|clave|password|kdbx|vault/.test(s)) return 'Credenciales';
  if (/comando|scrip|powershell|\.ps1|\.bat|\.sh|\.yml|\.yaml|\.conf|docker|rsync|activaci[oó]n/.test(s)) return 'Comandos y scripts';
  if (/proceso|procedimiento|pol[ií]tica|tarea|manual|erp|etapa|desbloquear/.test(s)) return 'Procedimientos';
  if (/\.xlsx?|\.xlsm|planilla|excel|mail|escritorio remoto|patagonia/.test(s)) return 'Planillas';
  return 'Otros';
}
async function extract(file, ext) {
  try {
    if (!ext || ['txt','md','csv','tsv','log','ps1','bat','sh','yml','yaml','conf','ini','json','xml','sql','py','crt','pem'].includes(ext)) return fs.readFileSync(file, 'utf8');
    if (ext === 'docx') return (await mammoth.extractRawText({ path: file })).value;
    if (['xls','xlsx','xlsm'].includes(ext)) {
      const wb = XLSX.readFile(file, { cellText: true, cellDates: true });
      return wb.SheetNames.map(name => `Hoja: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n');
    }
    if (ext === 'pdf') {
      const parser = new PDFParse({ data: fs.readFileSync(file) });
      try { return (await parser.getText()).text; } finally { await parser.destroy(); }
    }
  } catch (e) { return ''; }
  return '';
}
async function walk(dir, output = []) {
  for (const ent of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'sessions') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(abs, output); else if (ent.isFile()) output.push(abs);
  }
  return output;
}
const cache = new Map();
let cacheAt = 0, indexing = false, refreshPromise = null;
async function ensureCache() {
  if (refreshPromise) { await refreshPromise; return; }
  if (indexing && cacheAt) return;
  if (cacheAt && Date.now() - cacheAt <= 300000) return;
  refreshPromise = (async () => {
    cache.clear();
    const paths = await walk(DATA);
    const entries = [];
    for (const abs of paths) {
      const stat = await fs.promises.stat(abs); const rel = path.relative(DATA, abs);
      const ext = path.extname(abs).slice(1).toLowerCase();
      const originalName = path.basename(abs).replace(/__[0-9TZ-]+_[a-f0-9]{6}(?=\.|$)/, '');
      const cat = categoryFor(rel) === 'Otros' ? categoryGuess(rel) : categoryFor(rel);
      const item = { id:crypto.createHash('sha256').update(abs).digest('hex'), abs, rel, name:originalName, ext, type:fileType(ext), category:cat, size:stat.size, mtime:stat.mtimeMs, content:'' };
      cache.set(abs, item); entries.push(item);
    }
    cacheAt = Date.now(); indexing = true;
    const toIndex = entries.filter(x => ALLOWED.has(x.ext) && !['kdbx','rar','zip','doc'].includes(x.ext));
    (async () => {
      try {
        for (let i = 0; i < toIndex.length; i += 2) {
          await Promise.all(toIndex.slice(i, i + 2).map(async item => { item.content = await extract(item.abs, item.ext); }));
        }
      } catch (e) { console.error('Error al indexar archivos:', e.message); }
      finally { indexing = false; cacheAt = Date.now(); }
    })();
  })().finally(() => { refreshPromise = null; });
  await refreshPromise;
}
app.get('/api/files', loggedIn, async (req, res) => {
  try {
    await ensureCache();
    const q = String(req.query.q || '').trim().toLocaleLowerCase();
    const cat = String(req.query.category || 'all'); const type = String(req.query.type || 'all');
    const everything = [...cache.values()];
    const counts = Object.fromEntries(CATEGORIES.map(c => [c, everything.filter(x => x.category === c).length]));
    const result = everything.filter(x => (cat === 'all' || x.category === cat) && (type === 'all' || x.type === type) && (!q || (x.name + ' ' + x.rel + ' ' + x.category + ' ' + x.content).toLocaleLowerCase().includes(q)));
    result.sort((a,b) => a.name.localeCompare(b.name, 'es'));
    res.json({ files: result.map(x => {
      const i = q ? x.content.toLocaleLowerCase().indexOf(q) : -1;
      const snippet = x.type === 'Vault' ? 'Bóveda KeePass cifrada; no se indexa.' : i >= 0 ? x.content.slice(Math.max(0,i-65), i+q.length+105).replace(/\s+/g,' ') : '';
      return { id:x.id, name:x.name, rel:x.rel, ext:x.ext, type:x.type, category:x.category, size:x.size, snippet, open:`/api/file/${x.id}` };
    }), indexing, categories:CATEGORIES, counts, stats:{ total:everything.length, topics:Object.values(counts).filter(Boolean).length, sheets:everything.filter(x => x.type === 'Excel').length, indexed:everything.filter(x => x.content).length } });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer la biblioteca.' }); }
});
const EDITABLE_TEXT = new Set(['txt','md','csv','tsv','log','ps1','bat','sh','yml','yaml','conf','ini','json','xml','sql','py','crt','pem']);
function getCachedItem(id) { return [...cache.values()].find(x => x.id === id); }
app.get('/api/edit/:id', loggedIn, async (req,res) => {
  const item = getCachedItem(req.params.id);
  if (!item || !item.abs.startsWith(DATA + path.sep)) return res.sendStatus(404);
  if (EDITABLE_TEXT.has(item.ext)) {
    const text = await fs.promises.readFile(item.abs, 'utf8');
    if (text.length > 500000) return res.status(413).json({ error: 'El archivo supera el límite de edición de 500 KB.' });
    return res.json({ kind: 'text', name: item.name, text });
  }
  if (item.ext === 'xlsx') {
    const wb = XLSX.readFile(item.abs, { cellDates: true });
    const sheets = wb.SheetNames.map(name => {
      const ws = wb.Sheets[name];
      const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s:{r:0,c:0}, e:{r:0,c:0} };
      const rows = [];
      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 99); r++) {
        const row = [];
        for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 19); c++) {
          const cell = ws[XLSX.utils.encode_cell({r,c})];
          row.push(cell ? String(cell.w ?? cell.v ?? '') : '');
        }
        rows.push(row);
      }
      return { name, startRow:range.s.r, startCol:range.s.c, rows, truncated:range.e.r-range.s.r>=100 || range.e.c-range.s.c>=20 };
    });
    return res.json({ kind: 'workbook', name:item.name, sheets });
  }
  return res.status(415).json({ error: 'Este formato no se puede editar desde la app. Descargalo, modificalo y volvé a subirlo.' });
});
app.post('/api/edit/:id', loggedIn, async (req,res) => {
  const item = getCachedItem(req.params.id);
  if (!item || !item.abs.startsWith(DATA + path.sep)) return res.sendStatus(404);
  try {
    if (EDITABLE_TEXT.has(item.ext)) {
      if (typeof req.body.text !== 'string' || req.body.text.length > 500000) return res.status(400).json({ error: 'El texto es inválido o supera 500 KB.' });
      const temp = item.abs + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
      await fs.promises.writeFile(temp, req.body.text, { encoding:'utf8', mode:0o600 });
      await fs.promises.rename(temp, item.abs);
    } else if (item.ext === 'xlsx') {
      const updates = req.body.updates;
      if (!Array.isArray(updates) || updates.length > 500) return res.status(400).json({ error: 'La edición de planilla es inválida.' });
      const wb = XLSX.readFile(item.abs, { cellDates:true });
      for (const change of updates) {
        if (!change || !wb.SheetNames.includes(change.sheet) || !Number.isInteger(change.r) || !Number.isInteger(change.c) || change.r < 0 || change.r >= 10000 || change.c < 0 || change.c >= 1000 || typeof change.value !== 'string' || change.value.length > 10000) return res.status(400).json({ error: 'Hay una celda inválida.' });
        const ws = wb.Sheets[change.sheet];
        const address = XLSX.utils.encode_cell({ r:change.r, c:change.c });
        const cell = ws[address] || {};
        cell.t = 's'; cell.v = change.value; delete cell.f; ws[address] = cell;
        const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s:{r:change.r,c:change.c}, e:{r:change.r,c:change.c} };
        range.s.r = Math.min(range.s.r, change.r); range.s.c = Math.min(range.s.c, change.c); range.e.r = Math.max(range.e.r, change.r); range.e.c = Math.max(range.e.c, change.c);
        ws['!ref'] = XLSX.utils.encode_range(range);
      }
      const buffer = XLSX.write(wb, { type:'buffer', bookType:'xlsx', cellStyles:true });
      const temp = item.abs + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
      await fs.promises.writeFile(temp, buffer, { mode:0o600 });
      await fs.promises.rename(temp, item.abs);
    } else return res.status(415).json({ error: 'Este formato no se puede editar desde la app.' });
    cache.clear(); cacheAt = 0;
    return res.json({ ok:true });
  } catch (e) { console.error('No se pudo guardar el archivo:', e.message); return res.status(500).json({ error:'No se pudieron guardar los cambios.' }); }
});app.get('/api/preview/:id', loggedIn, async (req,res) => {
  const item = [...cache.values()].find(x => x.id === req.params.id);
  if (!item || !item.abs.startsWith(DATA + path.sep)) return res.sendStatus(404);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (item.ext === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`);
    return res.sendFile(item.abs);
  }
  if (['kdbx','rar','zip','doc'].includes(item.ext)) return res.status(415).json({ error: 'La vista previa no está disponible para este formato. Podés descargarlo.' });
  const text = item.content || await extract(item.abs, item.ext);
  const limit = 150000;
  res.json({ name: item.name, text: text.slice(0, limit), truncated: text.length > limit });
});app.delete('/api/file/:id', loggedIn, async (req,res) => {
  const item = [...cache.values()].find(x => x.id === req.params.id);
  if (!item || !item.abs.startsWith(DATA + path.sep)) return res.sendStatus(404);
  try {
    await fs.promises.unlink(item.abs);
    cache.delete(item.abs); cacheAt = 0;
    return res.json({ ok:true });
  } catch (e) {
    if (e.code === 'ENOENT') return res.sendStatus(404);
    console.error('No se pudo eliminar el archivo:', e.message);
    return res.status(500).json({ error:'No se pudo eliminar el archivo.' });
  }
});app.get('/api/file/:id', loggedIn, (req,res) => {
  const item = [...cache.values()].find(x => x.id === req.params.id);
  if (!item || !item.abs.startsWith(DATA + path.sep)) return res.sendStatus(404);
  res.download(item.abs, item.name);
});
app.use('/api', (req,res) => res.status(404).json({ error:'Ruta inexistente.' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, etag: true, maxAge: '1h' }));
app.get('/{*splat}', (req,res) => req.session.authenticated ? res.sendFile(path.join(__dirname,'public','index.html')) : res.sendFile(path.join(__dirname,'public','login.html')));
// Bot de Telegram opcional. El token y la lista permitida se configuran en Portainer.
const telegramToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const telegramAllowedUsers = new Set(String(process.env.TELEGRAM_ALLOWED_USERS || '').split(/[\s,;]+/).filter(x => /^\d+$/.test(x)));
const telegramChoices = new Map();
const telegramApi = telegramToken ? `https://api.telegram.org/bot${telegramToken}` : '';
const telegramKey = (chatId, userId) => `${chatId}:${userId}`;
function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}
async function telegramCall(method, body = {}) {
  const response = await fetch(`${telegramApi}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(method === 'getUpdates' ? 35000 : 15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(String(result.description || `HTTP ${response.status}`).slice(0, 240));
    error.telegramCode = result.error_code || response.status;
    throw error;
  }
  return result.result;
}
async function telegramSend(chatId, text) {
  // Telegram admite hasta 4096 caracteres; se mantiene margen para evitar rechazos.
  const chunks = [];
  let rest = String(text || '');
  while (rest.length > 3500) {
    let cut = rest.lastIndexOf('\n', 3500);
    if (cut < 1000) cut = 3500;
    chunks.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  for (const chunk of chunks) await telegramCall('sendMessage', { chat_id: chatId, text: chunk, disable_web_page_preview: true });
}
async function handleTelegramMessage(message) {
  if (!message || !message.from || !message.chat || message.chat.type !== 'private' || typeof message.text !== 'string') return;
  const userId = String(message.from.id), chatId = message.chat.id;
  const text = message.text.trim();
  if (/^\/id(?:@\w+)?(?:\s|$)/i.test(text)) {
    return telegramSend(chatId, `Tu ID de Telegram es: ${userId}\nAgregalo en Portainer como TELEGRAM_ALLOWED_USERS y redeplegá el Stack.`);
  }
  if (!telegramAllowedUsers.has(userId)) return; // No revelar si el bot contiene datos.
  const key = telegramKey(chatId, userId);
  if (/^\/(start|help)(?:@\w+)?(?:\s|$)/i.test(text)) {
    return telegramSend(chatId, 'Archivo IT está listo. Escribí una palabra o usá /buscar backup. Te mostraré coincidencias numeradas; respondé con el número para consultar el contenido. /cancelar descarta las opciones actuales.');
  }
  if (/^\/cancelar(?:@\w+)?(?:\s|$)/i.test(text)) {
    telegramChoices.delete(key);
    return telegramSend(chatId, 'Listo, descarté las opciones.');
  }
  const choice = telegramChoices.get(key);
  if (/^\d+$/.test(text) && choice && choice.expires > Date.now()) {
    const selected = choice.items[Number(text) - 1];
    if (!selected) return telegramSend(chatId, `Elegí un número del 1 al ${choice.items.length}.`);
    telegramChoices.delete(key);
    await ensureCache();
    const item = getCachedItem(selected.id);
    if (!item) return telegramSend(chatId, 'Ese archivo ya no está disponible. Hacé la búsqueda de nuevo.');
    if (!item.content && ['kdbx','rar','zip','doc'].includes(item.ext)) return telegramSend(chatId, `${item.name}\nEste formato no se puede leer desde el bot. Abrilo o descargalo desde la web de Archivo IT.`);
    const content = item.content || await extract(item.abs, item.ext);
    if (!content.trim()) return telegramSend(chatId, `${item.name}\nNo pude extraer texto de este archivo. Podés abrirlo o descargarlo desde la web.`);
    const limit = 12000;
    const excerpt = content.length > limit ? `${content.slice(0, limit)}\n\n[Contenido recortado. Consultá el archivo completo en la web.]` : content;
    return telegramSend(chatId, `${item.name}\n\n${excerpt}`);
  }
  const query = text.replace(/^\/buscar(?:@\w+)?\s*/i, '').trim();
  if (!query || query.startsWith('/')) return telegramSend(chatId, 'Escribí una búsqueda, por ejemplo: backup o /buscar backup.');
  await ensureCache();
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const all = [...cache.values()];
  const matches = all.filter(item => {
    const haystack = normalizeSearch(`${item.name} ${item.rel} ${item.category} ${item.content}`);
    return terms.every(term => haystack.includes(term));
  }).sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 10);
  if (!matches.length) {
    return telegramSend(chatId, indexing ? 'Todavía estoy leyendo los documentos. Esperá unos segundos y repetí la búsqueda.' : 'No encontré archivos que coincidan con esa búsqueda.');
  }
  telegramChoices.set(key, { items: matches.map(({id}) => ({id})), expires: Date.now() + 10 * 60 * 1000 });
  const list = matches.map((item, index) => `${index + 1}. ${item.name}`).join('\n');
  return telegramSend(chatId, `Encontré ${matches.length} coincidencia${matches.length === 1 ? '' : 's'} para “${query}”:\n\n${list}\n\nRespondé con el número para ver su contenido.`);
}
async function startTelegramBot() {
  if (!telegramToken) { console.log('Bot de Telegram desactivado (TELEGRAM_BOT_TOKEN vacío).'); return; }
  if (!telegramAllowedUsers.size) console.warn('Telegram está configurado, pero falta TELEGRAM_ALLOWED_USERS; las consultas quedan bloqueadas.');
  let offset = 0;
  try {
    const webhook = await telegramCall('getWebhookInfo');
    if (webhook.url) { console.error('Telegram: hay un webhook configurado. Se conserva; quitá el webhook o usá un bot dedicado para activar polling.'); return; }
  } catch (error) {
    console.error(`Telegram no pudo iniciar (verificá el token y la salida a Internet; código ${error.telegramCode || 'red'}).`);
    return;
  }
  console.log('Bot de Telegram iniciado con consultas privadas y acceso restringido.');
  while (true) {
    try {
      const updates = await telegramCall('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try { await handleTelegramMessage(update.message); }
        catch (error) { console.error(`Telegram no pudo procesar un mensaje (código ${error.telegramCode || 'red'}).`); }
      }
      for (const [key, value] of telegramChoices) if (value.expires <= Date.now()) telegramChoices.delete(key);
    } catch (error) {
      if (error.telegramCode === 409) console.error('Telegram: otro proceso está consultando este bot; revisá que no exista otro poller activo.');
      else console.error(`Telegram perdió conexión temporalmente (código ${error.telegramCode || 'red'}); reintentará.`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Archivo IT escuchando en ${PORT}`);
  void startTelegramBot();
});









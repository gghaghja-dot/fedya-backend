const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { redis } = require('../config/redis');
const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');

// Render disk is ephemeral / multi-instance — keep media bytes in Redis
const MAX_REDIS_BYTES = 7 * 1024 * 1024;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const relayDir = path.join(__dirname, '../../uploads/relay');
if (!fs.existsSync(relayDir)) {
  fs.mkdirSync(relayDir, { recursive: true });
}

function publicBase(req) {
  const env = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (env) return env;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function extFromMime(mime, original) {
  const fromName = path.extname(original || '').toLowerCase();
  if (fromName) return fromName;
  if (!mime) return '.bin';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('m4a') || mime.includes('mp4a') || mime.includes('aac')) return '.m4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('pdf')) return '.pdf';
  if (mime.includes('zip')) return '.zip';
  if (mime.includes('word') || mime.includes('document')) return '.docx';
  if (mime.includes('sheet') || mime.includes('excel')) return '.xlsx';
  if (mime.includes('flac')) return '.flac';
  if (mime.includes('wav')) return '.wav';
  return '.bin';
}

const uploadAvatar = [
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл обязателен' });
    const id = req.user.id;
    const payload = {
      mime: req.file.mimetype || 'image/png',
      name: req.file.originalname || 'avatar.png',
      data: req.file.buffer.toString('base64'),
    };
    await redis.set(`avatar:bin:${id}`, JSON.stringify(payload));
    const url = `${publicBase(req)}/api/media/avatar/${id}?v=${Date.now()}`;
    const user = await User.update(id, { avatar_url: url });
    res.json({ url, user: User.toPublic(await User.hydrate(user)) });
  }),
];

const getAvatar = asyncHandler(async (req, res) => {
  const raw = await redis.get(`avatar:bin:${req.params.userId}`);
  if (!raw) return res.status(404).json({ error: 'Аватар не найден' });
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const buf = Buffer.from(payload.data, 'base64');
  res.setHeader('Content-Type', payload.mime || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(buf);
});

const uploadRelay = [
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл обязателен' });
    if (req.file.size > MAX_REDIS_BYTES) {
      return res.status(413).json({
        error: `Файл слишком большой (макс. ${Math.floor(MAX_REDIS_BYTES / (1024 * 1024))} МБ)`,
      });
    }
    const id = uuidv4();
    const mime = req.file.mimetype || 'application/octet-stream';
    const name = req.file.originalname || 'file';
    const ext = extFromMime(mime, name);

    // Always persist bytes in Redis so any Render instance can serve them
    const meta = {
      mime,
      name,
      data: req.file.buffer.toString('base64'),
      from: req.user.id,
      created_at: new Date().toISOString(),
      size: req.file.size,
    };

    // Optional local cache (best-effort; not relied on for serving)
    try {
      const filePath = path.join(relayDir, `${id}${ext}`);
      fs.writeFileSync(filePath, req.file.buffer);
      meta.path = filePath;
    } catch {
      /* ignore disk errors on Render */
    }

    await redis.set(`media:relay:${id}`, JSON.stringify(meta), { ex: 60 * 60 * 24 });

    const url = `${publicBase(req)}/api/media/relay/${id}`;
    res.status(201).json({
      id,
      url,
      name: meta.name,
      mime: meta.mime,
      size: req.file.size,
      expires_in: 86400,
    });
  }),
];

const getRelay = asyncHandler(async (req, res) => {
  const key = `media:relay:${req.params.id}`;
  const raw = await redis.get(key);
  if (!raw) return res.status(404).json({ error: 'Файл истёк или не найден' });
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;

  let buf;
  if (payload.data) {
    buf = Buffer.from(payload.data, 'base64');
  } else if (payload.path && fs.existsSync(payload.path)) {
    buf = fs.readFileSync(payload.path);
  } else {
    return res.status(404).json({ error: 'Файл истёк или не найден' });
  }

  res.setHeader('Content-Type', payload.mime || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(payload.name || 'file')}"`,
  );
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (String(req.query.once || '0') === '1') {
    await redis.del(key);
    if (payload.path && fs.existsSync(payload.path)) {
      try {
        fs.unlinkSync(payload.path);
      } catch {
        /* ignore */
      }
    }
  }
  res.send(buf);
});

module.exports = {
  uploadAvatar,
  getAvatar,
  uploadRelay,
  getRelay,
  memoryUpload,
};

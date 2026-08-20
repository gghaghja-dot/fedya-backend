const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { redis } = require('../config/redis');
const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function publicBase(req) {
  const env = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (env) return env;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
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
    const id = uuidv4();
    const payload = {
      mime: req.file.mimetype || 'application/octet-stream',
      name: req.file.originalname || 'file',
      data: req.file.buffer.toString('base64'),
      from: req.user.id,
      created_at: new Date().toISOString(),
    };
    // Ephemeral only — Redis TTL, never written to disk
    await redis.set(`media:relay:${id}`, JSON.stringify(payload), { ex: 60 * 60 });
    const url = `${publicBase(req)}/api/media/relay/${id}`;
    res.status(201).json({
      id,
      url,
      name: payload.name,
      mime: payload.mime,
      size: req.file.size,
      expires_in: 3600,
    });
  }),
];

const getRelay = asyncHandler(async (req, res) => {
  const key = `media:relay:${req.params.id}`;
  const raw = await redis.get(key);
  if (!raw) return res.status(404).json({ error: 'Файл истёк или не найден' });
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const buf = Buffer.from(payload.data, 'base64');
  res.setHeader('Content-Type', payload.mime || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(payload.name || 'file')}"`
  );
  res.setHeader('Cache-Control', 'no-store');
  // One-time download removes payload so server does not keep the file
  if (String(req.query.once || '1') !== '0') {
    await redis.del(key);
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

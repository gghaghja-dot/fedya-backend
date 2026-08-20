const User = require('../models/User');
const Badge = require('../models/Badge');
const { asyncHandler } = require('../utils/helpers');

const list = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;
  const { users, count } = await User.list({
    excludeBanned: true,
    limit,
    offset,
  });
  res.json({ users: users.map(User.toPublic), count });
});

const getById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.is_banned) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  res.json({ user: User.toPublic(user) });
});

const update = asyncHandler(async (req, res) => {
  if (req.user.id !== req.params.id && !req.user.is_admin) {
    return res.status(403).json({ error: 'Нельзя редактировать чужой профиль' });
  }

  if (req.body.username && req.body.username !== req.user.username) {
    const taken = await User.findByUsername(req.body.username);
    if (taken) return res.status(409).json({ error: 'Username занят' });
  }

  const allowed = [
    'display_name',
    'avatar_url',
    'status_text',
    'privacy_photo',
    'privacy_online',
    'fcm_token',
    'username',
  ];
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }

  const user = await User.update(req.params.id, patch);
  res.json({ user: User.toPublic(user) });
});

const getBadges = asyncHandler(async (req, res) => {
  const badges = await Badge.getUserBadges(req.params.id);
  res.json({ badges });
});

const search = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 1) {
    return res.status(400).json({ error: 'Параметр q обязателен' });
  }
  const users = await User.search(q);
  const filtered = users
    .filter((u) => u.id !== req.user.id)
    .map(User.toPublic);
  res.json({ users: filtered, count: filtered.length });
});

const block = asyncHandler(async (req, res) => {
  const blockedId = req.params.id;
  if (blockedId === req.user.id) {
    return res.status(400).json({ error: 'Нельзя заблокировать себя' });
  }
  await User.block(req.user.id, blockedId);
  res.json({ success: true });
});

const unblock = asyncHandler(async (req, res) => {
  await User.unblock(req.user.id, req.params.id);
  res.json({ success: true });
});

module.exports = {
  list,
  getById,
  update,
  getBadges,
  search,
  block,
  unblock,
};

const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/database');
const { redis } = require('../config/redis');
const User = require('../models/User');
const Badge = require('../models/Badge');
const Subscription = require('../models/Subscription');
const { asyncHandler, addDays } = require('../utils/helpers');
const { sendPushToMany } = require('../services/fcm');
const logger = require('../services/logger');

const backupsDir = path.join(__dirname, '../../backups');
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

const BACKUP_TABLES = [
  'users',
  'messages',
  'chats',
  'chat_members',
  'badges',
  'user_badges',
  'subscriptions',
  'sessions',
];

const listUsers = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const q = req.query.q;
  const banned = req.query.banned;

  let query = supabase
    .from('users')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.or(`username.ilike.%${q}%,email.ilike.%${q}%`);
  }
  if (banned === 'true') query = query.eq('is_banned', true);
  if (banned === 'false') query = query.eq('is_banned', false);

  const { data, error, count } = await query;
  if (error) throw error;
  res.json({ users: data || [], count: count || 0 });
});

const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const badges = await Badge.getUserBadges(user.id);
  const logins = await User.getLoginLogs(user.id, 50);
  const status = await Subscription.status(user.id);

  res.json({ user: User.toPublic(user), badges, logins, premium: status });
});

const banUser = asyncHandler(async (req, res) => {
  const { reason, duration } = req.body;
  let until = null;
  if (duration) until = addDays(new Date(), Number(duration));
  const user = await User.ban(req.params.id, reason, until);
  logger.info('User banned', { id: req.params.id, by: req.user.id, reason });
  res.json({ user });
});

const unbanUser = asyncHandler(async (req, res) => {
  const user = await User.unban(req.params.id);
  res.json({ user });
});

const setRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  const patch = {
    role,
    is_admin: role === 'admin',
  };
  const user = await User.update(req.params.id, patch);
  res.json({ user });
});

const grantPremium = asyncHandler(async (req, res) => {
  const { duration } = req.body;
  const sub = await Subscription.grantDays(req.params.id, duration);
  const status = await Subscription.status(req.params.id);
  res.json({ success: true, subscription: sub, status });
});

const revokePremium = asyncHandler(async (req, res) => {
  await Subscription.revoke(req.params.id);
  res.json({ success: true });
});

const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Нельзя удалить себя' });
  }
  await User.delete(req.params.id);
  res.json({ success: true });
});

const stats = asyncHandler(async (_req, res) => {
  const [
    { count: users },
    { count: messages },
    { count: subscriptions },
    { count: banned },
    { count: groups },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_banned', true),
    supabase.from('chats').select('*', { count: 'exact', head: true }).eq('is_group', true),
  ]);

  const { data: recentUsers } = await supabase
    .from('users')
    .select('id,email,username,created_at,is_admin,is_premium')
    .order('created_at', { ascending: false })
    .limit(10);

  res.json({
    users: users || 0,
    messages: messages || 0,
    active_subscriptions: subscriptions || 0,
    banned: banned || 0,
    groups: groups || 0,
    recent_users: recentUsers || [],
  });
});

const activity = asyncHandler(async (_req, res) => {
  const days = 7;
  const since = addDays(new Date(), -days).toISOString();

  const logins = await User.getLoginLogs(null, 1000);

  const { data: newUsers } = await supabase
    .from('users')
    .select('created_at')
    .gte('created_at', since);

  const { data: newMessages } = await supabase
    .from('messages')
    .select('created_at')
    .gte('created_at', since);

  const map = {};
  for (let i = 0; i < days; i += 1) {
    const d = addDays(new Date(), -i).toISOString().slice(0, 10);
    map[d] = { date: d, logins: 0, failed_logins: 0, registrations: 0, messages: 0 };
  }

  for (const row of logins || []) {
    if (!row.created_at || row.created_at < since) continue;
    const d = row.created_at.slice(0, 10);
    if (!map[d]) continue;
    if (row.success) map[d].logins += 1;
    else map[d].failed_logins += 1;
  }
  for (const row of newUsers || []) {
    const d = row.created_at.slice(0, 10);
    if (map[d]) map[d].registrations += 1;
  }
  for (const row of newMessages || []) {
    const d = row.created_at.slice(0, 10);
    if (map[d]) map[d].messages += 1;
  }

  res.json({
    activity: Object.values(map).sort((a, b) => a.date.localeCompare(b.date)),
  });
});

const createBadge = asyncHandler(async (req, res) => {
  const badge = await Badge.create({
    name: req.body.name,
    description: req.body.description || '',
    icon_url: req.body.icon_url || req.body.icon || null,
    color: req.body.color || '#3B82F6',
    category: req.body.category || 'achievement',
    is_automatic: req.body.is_automatic || false,
    auto_condition: req.body.auto_condition || null,
    is_developer_only: false,
  });
  res.status(201).json({ badge });
});

const updateBadge = asyncHandler(async (req, res) => {
  const patch = {};
  for (const key of ['name', 'description', 'color', 'category', 'is_automatic', 'auto_condition']) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }
  if (req.body.icon_url !== undefined || req.body.icon !== undefined) {
    patch.icon_url = req.body.icon_url || req.body.icon;
  }
  const badge = await Badge.update(req.params.id, patch);
  res.json({ badge });
});

const deleteBadge = asyncHandler(async (req, res) => {
  await Badge.remove(req.params.id);
  res.json({ success: true });
});

const awardBadge = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const row = await Badge.award(req.params.id, userId, req.user.id);
  res.json({ success: true, award: row });
});

const revokeBadge = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  await Badge.revoke(req.params.id, userId);
  res.json({ success: true });
});

const announce = asyncHandler(async (req, res) => {
  const announcement = {
    id: `ann_${Date.now()}`,
    title: req.body.title,
    message: req.body.message,
    type: req.body.type || 'info',
    created_by: req.user.id,
    expires_at: req.body.expires_at || null,
    active: true,
    created_at: new Date().toISOString(),
  };
  await redis.set(`announcement:latest`, JSON.stringify(announcement));
  await redis.lpush('announcements', JSON.stringify(announcement));
  await redis.ltrim('announcements', 0, 99);

  const { data: users } = await supabase
    .from('users')
    .select('id')
    .eq('is_banned', false);

  const tokens = [];
  for (const u of users || []) {
    const t = await User.getFcmToken(u.id);
    if (t) tokens.push(t);
  }

  await sendPushToMany(tokens, {
    title: announcement.title,
    body: announcement.message,
    data: { type: 'announcement', id: announcement.id },
  });

  res.status(201).json({ announcement });
});

const clearCache = asyncHandler(async (_req, res) => {
  // Upstash REST does not support FLUSHALL on all plans; scan & delete known prefixes
  const patterns = ['refresh:*', 'prekeys:*', 'presence:*', 'ratelimit:*'];
  let deleted = 0;
  for (const pattern of patterns) {
    let cursor = 0;
    do {
      const [next, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = Number(next);
      if (keys?.length) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== 0);
  }
  logger.info('Cache cleared', { deleted });
  res.json({ success: true, deleted });
});

const dbBackup = asyncHandler(async (req, res) => {
  const dump = { created_at: new Date().toISOString(), tables: {} };
  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      dump.tables[table] = { error: error.message };
    } else {
      dump.tables[table] = data || [];
    }
  }
  const id = `backup_${Date.now()}`;
  const file = path.join(backupsDir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2), 'utf8');
  logger.info('DB backup created', { id, by: req.user.id });
  res.json({ success: true, backupId: id, file: `${id}.json` });
});

const dbRestore = asyncHandler(async (req, res) => {
  const { backupId } = req.body;
  if (!backupId) return res.status(400).json({ error: 'backupId обязателен' });
  const file = path.join(backupsDir, `${backupId.replace(/\.json$/, '')}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Бэкап не найден' });

  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const restored = [];
  for (const table of BACKUP_TABLES) {
    const rows = dump.tables?.[table];
    if (!Array.isArray(rows) || !rows.length) continue;
    // Upsert in chunks
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from(table).upsert(chunk);
      if (error) {
        logger.error('Restore table failed', { table, error });
      }
    }
    restored.push(table);
  }
  logger.info('DB restore', { backupId, restored, by: req.user.id });
  res.json({ success: true, restored });
});

const getLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json({ logs: logger.readTail(limit) });
});

const getSettings = asyncHandler(async (_req, res) => {
  const { data, error } = await supabase.from('system_settings').select('*');
  if (error) throw error;
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  res.json({ settings });
});

const updateSettings = asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body.settings || req.body);
  for (const [key, value] of entries) {
    await supabase.from('system_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
  }
  res.json({ success: true });
});

/**
 * Creator-only SQL execute.
 * Requires DATABASE_URL (Postgres connection string). Supabase JS cannot run arbitrary SQL.
 */
const executeSql = asyncHandler(async (req, res) => {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (req.user.email.toLowerCase() !== adminEmail) {
    return res.status(403).json({ error: 'Только создатель' });
  }

  const sql = req.body.sql || req.body.query;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'sql обязателен' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(501).json({
      error: 'Произвольный SQL недоступен без DATABASE_URL',
      hint: 'Добавьте Postgres connection string из Supabase (Settings → Database) в DATABASE_URL',
    });
  }

  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const result = await client.query(sql);
    res.json({
      success: true,
      rowCount: result.rowCount,
      rows: result.rows,
      fields: (result.fields || []).map((f) => f.name),
    });
  } finally {
    await client.end();
  }
});

const listBackups = asyncHandler(async (_req, res) => {
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const st = fs.statSync(path.join(backupsDir, f));
      return { id: f.replace(/\.json$/, ''), file: f, size: st.size, created_at: st.mtime };
    })
    .sort((a, b) => b.created_at - a.created_at);
  res.json({ backups: files });
});

const createPromo = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('promo_codes')
    .insert({
      code: String(req.body.code).toUpperCase(),
      type: req.body.type || 'premium_days',
      value: Number(req.body.value),
      max_uses: req.body.max_uses ?? null,
      expires_at: req.body.expires_at || null,
      active: true,
    })
    .select()
    .single();
  if (error) throw error;
  res.status(201).json({ promo: data });
});

module.exports = {
  listUsers,
  getUser,
  banUser,
  unbanUser,
  setRole,
  grantPremium,
  revokePremium,
  deleteUser,
  stats,
  activity,
  createBadge,
  updateBadge,
  deleteBadge,
  awardBadge,
  revokeBadge,
  announce,
  clearCache,
  dbBackup,
  dbRestore,
  getLogs,
  getSettings,
  updateSettings,
  executeSql,
  listBackups,
  createPromo,
};

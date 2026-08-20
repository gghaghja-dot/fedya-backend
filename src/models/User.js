const bcrypt = require('bcryptjs');
const { supabase } = require('../config/database');
const { redis, KEYS } = require('../config/redis');
const { publicUser, isPremium } = require('../utils/helpers');

const BCRYPT_ROUNDS = 12;

async function readProfileMeta(id) {
  const raw = await redis.get(`profile:${id}`);
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

async function writeProfileMeta(id, patch) {
  const current = await readProfileMeta(id);
  const next = { ...current, ...patch, updated_at: new Date().toISOString() };
  await redis.set(`profile:${id}`, JSON.stringify(next));
  return next;
}

const User = {
  async create(data) {
    const password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isAdmin = data.email.toLowerCase() === adminEmail;

    const row = {
      email: data.email.toLowerCase(),
      username: data.username,
      password_hash,
      is_admin: isAdmin,
      is_banned: false,
      is_premium: false,
    };

    const { data: user, error } = await supabase.from('users').insert(row).select().single();
    if (error) throw error;

    if (data.verification_code) {
      await redis.set(`verify:${user.id}`, data.verification_code, { ex: 60 * 60 * 24 });
      await redis.set(`verify:email:${user.email}`, data.verification_code, { ex: 60 * 60 * 24 });
    }

    return user;
  },

  async findById(id) {
    const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return this.hydrate(data);
  },

  async hydrate(user) {
    if (!user) return null;
    const meta = await readProfileMeta(user.id);
    let presence = null;
    try {
      presence = await redis.get(KEYS.presence(user.id));
    } catch {
      presence = null;
    }
    return {
      ...user,
      display_name: meta.display_name || user.display_name || user.username,
      status_text: meta.status_text || user.status_text || '',
      privacy_photo: meta.privacy_photo || user.privacy_photo || 'everyone',
      privacy_online: meta.privacy_online || user.privacy_online || 'everyone',
      is_online: presence === 'online' || presence === 'away',
      presence: presence || 'offline',
      is_verified: Boolean(await redis.get(`verified:${user.id}`)),
    };
  },

  async findByEmail(email) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByUsername(username) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
  },

  async update(id, patch) {
    if (patch.fcm_token !== undefined) {
      if (patch.fcm_token) {
        await redis.set(`fcm:${id}`, patch.fcm_token);
      } else {
        await redis.del(`fcm:${id}`);
      }
    }

    const metaKeys = ['display_name', 'status_text', 'privacy_photo', 'privacy_online'];
    const metaPatch = {};
    for (const key of metaKeys) {
      if (patch[key] !== undefined) metaPatch[key] = patch[key];
    }
    if (Object.keys(metaPatch).length) {
      await writeProfileMeta(id, metaPatch);
    }

    const allowed = {};
    const map = [
      'username',
      'avatar_url',
      'password_hash',
      'is_admin',
      'is_banned',
      'is_premium',
      'premium_until',
      'last_seen',
    ];
    for (const key of map) {
      if (patch[key] !== undefined) allowed[key] = patch[key];
    }
    if (patch.role !== undefined) {
      allowed.is_admin = patch.role === 'admin';
    }

    if (!Object.keys(allowed).length) {
      return this.findById(id);
    }

    const tryUpdate = async (payload) => {
      const { data, error } = await supabase
        .from('users')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    };

    let payload = { ...allowed, updated_at: new Date().toISOString() };
    let { data, error } = await tryUpdate(payload);
    if (error) {
      // Legacy schemas may miss updated_at / last_seen
      payload = { ...allowed };
      delete payload.updated_at;
      delete payload.last_seen;
      ({ data, error } = await tryUpdate(payload));
    }
    if (error) {
      // Still failed — keep Redis meta and return current row
      return this.findById(id);
    }
    return this.hydrate(data);
  },

  async getFcmToken(id) {
    return redis.get(`fcm:${id}`);
  },

  async list({ excludeBanned = true, q, limit = 50, offset = 0 } = {}) {
    let query = supabase
      .from('users')
      .select(
        'id,email,username,avatar_url,is_admin,is_banned,is_premium,premium_until,last_seen,created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (excludeBanned) query = query.eq('is_banned', false);
    if (q) {
      query = query.or(`username.ilike.%${q}%,email.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { users: data || [], count: count || 0 };
  },

  async search(q, limit = 30) {
    // Support "@nick" searches from the Android UI
    const term = String(q || '')
      .trim()
      .replace(/^@+/, '');
    if (!term) return [];

    const escaped = term.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;

    const select =
      'id,email,username,avatar_url,is_admin,is_banned,is_premium,premium_until,last_seen,created_at';

    // No is_banned filter — NULL/missing column would hide real users.
    const [byUsername, byEmail, exact] = await Promise.all([
      supabase.from('users').select(select).ilike('username', pattern).limit(limit),
      supabase.from('users').select(select).ilike('email', pattern).limit(limit),
      supabase.from('users').select(select).ilike('username', term).limit(10),
    ]);

    if (byUsername.error) throw byUsername.error;
    if (byEmail.error) throw byEmail.error;
    if (exact.error) throw exact.error;

    const map = new Map();
    for (const row of [
      ...(exact.data || []),
      ...(byUsername.data || []),
      ...(byEmail.data || []),
    ]) {
      if (row.is_banned === true) continue;
      map.set(row.id, row);
    }
    const hydrated = await Promise.all(
      Array.from(map.values())
        .slice(0, limit)
        .map((u) => this.hydrate(u))
    );
    return hydrated;
  },

  async ban(id, reason, until) {
    if (reason || until) {
      await redis.set(
        `ban:${id}`,
        JSON.stringify({
          reason: reason || null,
          until: until ? until.toISOString() : null,
        }),
        { ex: until ? Math.max(60, Math.floor((until.getTime() - Date.now()) / 1000)) : 60 * 60 * 24 * 365 }
      );
    }
    return this.update(id, { is_banned: true });
  },

  async unban(id) {
    await redis.del(`ban:${id}`);
    return this.update(id, { is_banned: false });
  },

  async delete(id) {
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    return true;
  },

  async setPassword(id, password) {
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await redis.del(`reset:${id}`);
    return this.update(id, { password_hash });
  },

  async logLogin(userId, ip, userAgent, success) {
    const entry = JSON.stringify({
      user_id: userId,
      ip,
      user_agent: userAgent,
      success,
      created_at: new Date().toISOString(),
    });
    try {
      await redis.lpush('login_logs', entry);
      await redis.ltrim('login_logs', 0, 999);
    } catch {
      // ignore redis log failures
    }
  },

  async getLoginLogs(userId, limit = 50) {
    const raw = await redis.lrange('login_logs', 0, 999);
    const logs = (raw || [])
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((l) => !userId || l.user_id === userId)
      .slice(0, limit);
    return logs;
  },

  async block(blockerId, blockedId) {
    await redis.sadd(`blocks:${blockerId}`, blockedId);
    return true;
  },

  async unblock(blockerId, blockedId) {
    await redis.srem(`blocks:${blockerId}`, blockedId);
    return true;
  },

  async isBlocked(blockerId, blockedId) {
    const n = await redis.sismember(`blocks:${blockerId}`, blockedId);
    return Boolean(n);
  },

  toPublic(user) {
    return { ...publicUser(user), is_premium: isPremium(user) };
  },
};

module.exports = User;

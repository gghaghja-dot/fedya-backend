const { v4: uuidv4 } = require('uuid');

function conversationIdFromUsers(userA, userB) {
  const sorted = [String(userA), String(userB)].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

function isDeveloper(user) {
  if (!user) return false;
  if (user.is_admin) return true;
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  return Boolean(adminEmail) && String(user.email || '').toLowerCase() === adminEmail;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name || user.username,
    avatar_url: user.avatar_url || null,
    status_text: user.status_text || '',
    role: user.role || (user.is_admin ? 'admin' : 'user'),
    is_admin: Boolean(user.is_admin),
    is_developer: isDeveloper(user),
    email_verified: user.email_verified !== false,
    premium_until: null,
    is_lifetime_premium: false,
    is_premium: false,
    privacy_photo: user.privacy_photo || 'everyone',
    privacy_online: user.privacy_online || 'everyone',
    last_seen: user.last_seen,
    is_online: Boolean(user.is_online),
    presence: user.presence || 'offline',
    created_at: user.created_at,
  };
}

function isPremium(user) {
  if (!user) return false;
  if (user.is_lifetime_premium) return true;
  if (user.is_premium && !user.premium_until) return true;
  if (user.is_premium && user.premium_until) {
    return new Date(user.premium_until) > new Date();
  }
  if (!user.premium_until) return false;
  return new Date(user.premium_until) > new Date();
}

function normalizeMessage(m) {
  if (!m) return null;
  const sender_id = m.sender_id || m.from_user;
  const recipient_id = m.recipient_id || m.to_user;
  return {
    ...m,
    sender_id,
    recipient_id,
    from_user: m.from_user || sender_id,
    to_user: m.to_user || recipient_id,
    content_type: m.content_type || 'text',
    is_encrypted: m.is_encrypted !== false,
    media_url: m.media_url || null,
  };
}

function generateCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

function generateToken() {
  return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

module.exports = {
  conversationIdFromUsers,
  publicUser,
  isPremium,
  isDeveloper,
  normalizeMessage,
  generateCode,
  generateToken,
  getClientIp,
  asyncHandler,
  addDays,
};

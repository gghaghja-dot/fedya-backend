const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const jwtConfig = require('../config/jwt');
const { redis, KEYS } = require('../config/redis');
const { generateCode, generateToken, getClientIp, asyncHandler } = require('../utils/helpers');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');
const { storePublicKeys } = require('../services/encryption');
const { ensureDeveloperBadge } = require('../services/badgeEngine');
const logger = require('../services/logger');

async function issueTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, is_admin: user.is_admin },
    jwtConfig.accessSecret,
    { expiresIn: jwtConfig.accessExpiresIn }
  );

  const tokenId = uuidv4();
  const refreshToken = jwt.sign(
    { sub: user.id, jti: tokenId },
    jwtConfig.refreshSecret,
    { expiresIn: jwtConfig.refreshExpiresIn }
  );

  await redis.set(KEYS.refresh(user.id, tokenId), '1', {
    ex: jwtConfig.refreshExpiresSeconds,
  });
  await redis.sadd(KEYS.refreshIndex(user.id), tokenId);
  await redis.expire(KEYS.refreshIndex(user.id), jwtConfig.refreshExpiresSeconds);

  return { accessToken, refreshToken, token: accessToken };
}

const register = asyncHandler(async (req, res) => {
  const { email, password, username, display_name } = req.body;

  const existingEmail = await User.findByEmail(email);
  if (existingEmail) {
    return res.status(409).json({ error: 'Email уже зарегистрирован' });
  }
  const existingUser = await User.findByUsername(username);
  if (existingUser) {
    return res.status(409).json({ error: 'Username занят' });
  }

  const verification_code = generateCode(6);
  const user = await User.create({
    email,
    password,
    username,
    display_name,
    verification_code,
  });

  if (req.body.identityKey && req.body.signedPrekey && req.body.signature) {
    await storePublicKeys(user.id, {
      identityKey: req.body.identityKey,
      signedPrekey: req.body.signedPrekey,
      signedPrekeyId: req.body.signedPrekeyId || 1,
      signature: req.body.signature,
      oneTimePrekeys: req.body.oneTimePrekeys || [],
    });
  }

  await ensureDeveloperBadge(user);
  await sendVerificationEmail(user.email, verification_code);

  const tokens = await issueTokens(user);
  logger.info('User registered', { userId: user.id, email: user.email });

  res.status(201).json({
    user: User.toPublic(user),
    ...tokens,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password, fcm_token } = req.body;
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';

  const user = await User.findByEmail(email);
  if (!user) {
    await User.logLogin(null, ip, ua, false);
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const ok = await User.verifyPassword(user, password);
  if (!ok) {
    await User.logLogin(user.id, ip, ua, false);
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  if (user.is_banned) {
    const until = user.ban_until ? new Date(user.ban_until) : null;
    if (!until || until > new Date()) {
      await User.logLogin(user.id, ip, ua, false);
      return res.status(403).json({
        error: 'Аккаунт заблокирован',
        reason: user.ban_reason,
        ban_until: user.ban_until,
      });
    }
    await User.unban(user.id);
  }

  await User.logLogin(user.id, ip, ua, true);
  await ensureDeveloperBadge(user);

  let updated = user;
  if (fcm_token) {
    updated = await User.update(user.id, {
      fcm_token,
      last_seen: new Date().toISOString(),
    });
  } else {
    updated = await User.update(user.id, { last_seen: new Date().toISOString() });
  }

  const tokens = await issueTokens(updated);
  res.json({ user: User.toPublic(updated), ...tokens });
});

const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, jwtConfig.refreshSecret);
      await redis.del(KEYS.refresh(payload.sub, payload.jti));
      await redis.srem(KEYS.refreshIndex(payload.sub), payload.jti);
    } catch {
      /* ignore invalid token on logout */
    }
  } else if (req.user) {
    const members = await redis.smembers(KEYS.refreshIndex(req.user.id));
    if (members?.length) {
      for (const jti of members) {
        await redis.del(KEYS.refresh(req.user.id, jti));
      }
      await redis.del(KEYS.refreshIndex(req.user.id));
    }
  }
  res.json({ success: true });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  let payload;
  try {
    payload = jwt.verify(refreshToken, jwtConfig.refreshSecret);
  } catch {
    return res.status(401).json({ error: 'Недействительный refresh-токен' });
  }

  const exists = await redis.get(KEYS.refresh(payload.sub, payload.jti));
  if (!exists) {
    return res.status(401).json({ error: 'Refresh-токен отозван' });
  }

  await redis.del(KEYS.refresh(payload.sub, payload.jti));
  await redis.srem(KEYS.refreshIndex(payload.sub), payload.jti);

  const user = await User.findById(payload.sub);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

  const tokens = await issueTokens(user);
  res.json({ ...tokens, user: User.toPublic(user) });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const user = req.user;
  const stored =
    (await redis.get(`verify:${user.id}`)) ||
    (await redis.get(`verify:email:${user.email}`));
  if (!stored || String(stored) !== String(code)) {
    return res.status(400).json({ error: 'Неверный код' });
  }
  await redis.del(`verify:${user.id}`);
  await redis.del(`verify:email:${user.email}`);
  await redis.set(`email_verified:${user.id}`, '1');
  res.json({ success: true });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findByEmail(email);
  // Always succeed to avoid email enumeration
  if (user) {
    const token = generateToken();
    await redis.set(
      `reset:${token}`,
      user.id,
      { ex: 60 * 60 }
    );
    await sendPasswordResetEmail(user.email, token);
  }
  res.json({ success: true });
});

const resetPasswordConfirm = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  const userId = await redis.get(`reset:${token}`);
  if (!userId) {
    return res.status(400).json({ error: 'Токен недействителен или истёк' });
  }
  await User.setPassword(userId, newPassword);
  await redis.del(`reset:${token}`);
  res.json({ success: true });
});

module.exports = {
  register,
  login,
  logout,
  refresh,
  verifyEmail,
  resetPassword,
  resetPasswordConfirm,
  issueTokens,
};

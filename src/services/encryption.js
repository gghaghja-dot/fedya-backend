/**
 * Server-side E2EE key relay helpers.
 * NEVER decrypt message content — ciphertext is opaque.
 * Public keys live in Redis (TTL 30 days). Optional DB tables are skipped if missing.
 */
const { redis, KEYS } = require('../config/redis');

const PREKEY_TTL_SECONDS = 30 * 24 * 60 * 60;

async function storePublicKeys(userId, bundle) {
  const payload = {
    identityKey: bundle.identityKey,
    signedPrekey: bundle.signedPrekey,
    signedPrekeyId: bundle.signedPrekeyId || 1,
    signature: bundle.signature,
    oneTimePrekeys: Array.isArray(bundle.oneTimePrekeys) ? bundle.oneTimePrekeys : [],
    updatedAt: new Date().toISOString(),
  };

  await redis.set(KEYS.prekeys(userId), JSON.stringify(payload), {
    ex: PREKEY_TTL_SECONDS,
  });

  return payload;
}

async function getPrekeyBundle(userId) {
  const raw = await redis.get(KEYS.prekeys(userId));
  if (!raw) return null;

  const base = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const otps = Array.isArray(base.oneTimePrekeys) ? base.oneTimePrekeys : [];
  let oneTimePrekey = null;

  if (otps.length) {
    oneTimePrekey = otps.shift();
    base.oneTimePrekeys = otps;
    await redis.set(KEYS.prekeys(userId), JSON.stringify(base), {
      ex: PREKEY_TTL_SECONDS,
    });
  }

  return {
    userId,
    identityKey: base.identityKey,
    signedPrekey: base.signedPrekey,
    signedPrekeyId: base.signedPrekeyId,
    signature: base.signature,
    oneTimePrekey,
  };
}

async function replenishOneTimePrekeys(userId, keys) {
  const raw = await redis.get(KEYS.prekeys(userId));
  const base = raw
    ? typeof raw === 'string'
      ? JSON.parse(raw)
      : raw
    : {
        identityKey: null,
        signedPrekey: null,
        signedPrekeyId: 1,
        signature: null,
        oneTimePrekeys: [],
      };

  base.oneTimePrekeys = [...(base.oneTimePrekeys || []), ...keys];
  base.updatedAt = new Date().toISOString();
  await redis.set(KEYS.prekeys(userId), JSON.stringify(base), {
    ex: PREKEY_TTL_SECONDS,
  });
  return { count: keys.length };
}

function assertOpaqueCiphertext(content) {
  if (typeof content !== 'string' || !content.length) {
    const err = new Error('Message content must be opaque ciphertext string');
    err.status = 400;
    throw err;
  }
  return content;
}

module.exports = {
  storePublicKeys,
  getPrekeyBundle,
  replenishOneTimePrekeys,
  assertOpaqueCiphertext,
  PREKEY_TTL_SECONDS,
};

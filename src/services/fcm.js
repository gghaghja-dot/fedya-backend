const logger = require('./logger');

/**
 * Legacy HTTP FCM (server key). Graceful no-op when FCM_SERVER_KEY is empty.
 */
async function sendPush(fcmToken, { title, body, data = {} }) {
  const key = process.env.FCM_SERVER_KEY;
  if (!key || !fcmToken) {
    logger.warn('FCM skipped', { reason: !key ? 'no server key' : 'no token' });
    return { skipped: true };
  }

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: fcmToken,
      notification: { title, body },
      data,
      priority: 'high',
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error('FCM error', { status: res.status, json });
  }
  return json;
}

async function sendPushToMany(tokens, payload) {
  const unique = [...new Set((tokens || []).filter(Boolean))];
  const results = [];
  for (const token of unique) {
    results.push(await sendPush(token, payload));
  }
  return results;
}

module.exports = { sendPush, sendPushToMany };

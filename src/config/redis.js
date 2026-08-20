require('dotenv').config();
const { Redis } = require('@upstash/redis');

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required');
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEYS = {
  refresh: (userId, tokenId) => `refresh:${userId}:${tokenId}`,
  refreshIndex: (userId) => `refresh:user:${userId}`,
  prekeys: (userId) => `prekeys:${userId}`,
  presence: (userId) => `presence:${userId}`,
  rateLogin: (ip) => `ratelimit:login:${ip}`,
};

module.exports = { redis, KEYS };

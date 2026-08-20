require('dotenv').config();

if (!process.env.JWT_SECRET || !process.env.REFRESH_SECRET) {
  throw new Error('JWT_SECRET and REFRESH_SECRET are required');
}

module.exports = {
  accessSecret: process.env.JWT_SECRET,
  refreshSecret: process.env.REFRESH_SECRET,
  accessExpiresIn: '15m',
  refreshExpiresIn: '7d',
  accessExpiresSeconds: 15 * 60,
  refreshExpiresSeconds: 7 * 24 * 60 * 60,
};

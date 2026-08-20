const Badge = require('../models/Badge');
const { asyncHandler } = require('../utils/helpers');

const list = asyncHandler(async (req, res) => {
  const badges = await Badge.list({
    includeDeveloperOnly: Boolean(req.user?.is_admin),
  });
  res.json({ badges });
});

const getById = asyncHandler(async (req, res) => {
  const badge = await Badge.findById(req.params.id);
  if (!badge) return res.status(404).json({ error: 'Значок не найден' });
  if (badge.is_developer_only && !req.user?.is_admin) {
    return res.status(404).json({ error: 'Значок не найден' });
  }
  res.json({ badge });
});

const available = asyncHandler(async (req, res) => {
  const badges = await Badge.availableForUser(req.user.id);
  res.json({ badges });
});

module.exports = { list, getById, available };

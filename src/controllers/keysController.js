const encryption = require('../services/encryption');
const { asyncHandler } = require('../utils/helpers');

const uploadPrekeys = asyncHandler(async (req, res) => {
  const bundle = await encryption.storePublicKeys(req.user.id, {
    identityKey: req.body.identityKey,
    signedPrekey: req.body.signedPrekey,
    signedPrekeyId: req.body.signedPrekeyId,
    signature: req.body.signature,
    oneTimePrekeys: req.body.oneTimePrekeys || [],
  });
  res.json({ success: true, bundle });
});

const getPrekeyBundle = asyncHandler(async (req, res) => {
  const bundle = await encryption.getPrekeyBundle(req.params.userId);
  if (!bundle) return res.status(404).json({ error: 'Ключи не найдены' });
  res.json({ bundle });
});

const replenishOneTimePrekeys = asyncHandler(async (req, res) => {
  const keys = req.body.oneTimePrekeys || req.body.keys;
  if (!Array.isArray(keys) || !keys.length) {
    return res.status(400).json({ error: 'oneTimePrekeys обязателен' });
  }
  const result = await encryption.replenishOneTimePrekeys(req.user.id, keys);
  res.json({ success: true, ...result });
});

module.exports = { uploadPrekeys, getPrekeyBundle, replenishOneTimePrekeys };

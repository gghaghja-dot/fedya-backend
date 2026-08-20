const express = require('express');
const { auth } = require('../middleware/auth');
const { admin, creatorOnly } = require('../middleware/admin');
const {
  validate,
  banSchema,
  roleSchema,
  premiumGrantSchema,
  badgeCreateSchema,
  announceSchema,
} = require('../utils/validators');
const ctrl = require('../controllers/adminController');

const router = express.Router();

router.use(auth, admin);

router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.put('/users/:id/ban', validate(banSchema), ctrl.banUser);
router.put('/users/:id/unban', ctrl.unbanUser);
router.put('/users/:id/role', validate(roleSchema), ctrl.setRole);
router.post('/users/:id/premium', validate(premiumGrantSchema), ctrl.grantPremium);
router.delete('/users/:id/premium', ctrl.revokePremium);
router.delete('/users/:id', ctrl.deleteUser);

router.get('/stats', ctrl.stats);
router.get('/stats/activity', ctrl.activity);

router.post('/badges', validate(badgeCreateSchema), ctrl.createBadge);
router.put('/badges/:id', ctrl.updateBadge);
router.delete('/badges/:id', ctrl.deleteBadge);
router.post('/badges/:id/award', ctrl.awardBadge);
router.post('/badges/:id/revoke', ctrl.revokeBadge);

router.post('/announce', validate(announceSchema), ctrl.announce);
router.post('/cache/clear', ctrl.clearCache);
router.post('/db/backup', ctrl.dbBackup);
router.post('/db/restore', ctrl.dbRestore);
router.get('/db/backups', ctrl.listBackups);
router.get('/logs', ctrl.getLogs);
router.get('/settings', ctrl.getSettings);
router.put('/settings', ctrl.updateSettings);
router.post('/promo', ctrl.createPromo);

router.post('/sql', creatorOnly, ctrl.executeSql);

module.exports = router;

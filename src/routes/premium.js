const express = require('express');
const { auth } = require('../middleware/auth');
const { validate, activatePremiumSchema, activateCodeSchema } = require('../utils/validators');
const ctrl = require('../controllers/premiumController');

const router = express.Router();

router.use(auth);

router.get('/plans', ctrl.plans);
router.post('/activate', validate(activatePremiumSchema), ctrl.activate);
router.post('/activate-code', validate(activateCodeSchema), ctrl.activateCode);
router.get('/status', ctrl.status);
router.get('/history', ctrl.history);

module.exports = router;

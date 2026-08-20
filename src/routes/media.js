const express = require('express');
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/mediaController');

const router = express.Router();

router.get('/avatar/:userId', ctrl.getAvatar);
router.get('/relay/:id', ctrl.getRelay);

router.post('/avatar', auth, ...ctrl.uploadAvatar);
router.post('/relay', auth, ...ctrl.uploadRelay);

module.exports = router;

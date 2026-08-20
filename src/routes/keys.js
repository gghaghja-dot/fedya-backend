const express = require('express');
const { auth } = require('../middleware/auth');
const { validate, uploadPrekeysSchema } = require('../utils/validators');
const ctrl = require('../controllers/keysController');

const router = express.Router();

router.use(auth);

router.post('/prekeys', validate(uploadPrekeysSchema), ctrl.uploadPrekeys);
router.post('/prekeys/replenish', ctrl.replenishOneTimePrekeys);
router.get('/prekeys/:userId', ctrl.getPrekeyBundle);

module.exports = router;

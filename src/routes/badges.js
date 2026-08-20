const express = require('express');
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/badgeController');

const router = express.Router();

router.use(auth);

router.get('/available', ctrl.available);
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);

module.exports = router;

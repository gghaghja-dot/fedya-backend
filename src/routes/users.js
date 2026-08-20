const express = require('express');
const { auth } = require('../middleware/auth');
const { validate, updateUserSchema } = require('../utils/validators');
const ctrl = require('../controllers/userController');

const router = express.Router();

router.use(auth);

router.get('/', ctrl.list);
router.get('/search', ctrl.search);
router.get('/:id', ctrl.getById);
router.put('/:id', validate(updateUserSchema), ctrl.update);
router.get('/:id/badges', ctrl.getBadges);
router.post('/:id/block', ctrl.block);
router.delete('/:id/block', ctrl.unblock);

module.exports = router;

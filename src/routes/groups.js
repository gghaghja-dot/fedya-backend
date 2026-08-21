const express = require('express');
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/groupController');

const router = express.Router();
router.use(auth);

router.get('/', ctrl.listMine);
router.post('/', ctrl.create);
router.get('/:id', ctrl.get);
router.post('/:id/members', ctrl.addMember);
router.get('/:id/messages', ctrl.getMessages);
router.post('/:id/messages', ctrl.sendMessage);

module.exports = router;

const express = require('express');
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/groupController');

const router = express.Router();
router.use(auth);

router.get('/', ctrl.listMine);
router.post('/', ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', ctrl.update);
router.post('/:id/members', ctrl.addMember);
router.delete('/:id/members/:userId', ctrl.removeMember);
router.post('/:id/members/remove', ctrl.removeMember);
router.post('/:id/roles', ctrl.setRole);
router.get('/:id/messages', ctrl.getMessages);
router.post('/:id/messages', ctrl.sendMessage);
router.delete('/:id/messages/:messageId', ctrl.deleteMessage);

module.exports = router;

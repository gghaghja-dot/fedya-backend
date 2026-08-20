const express = require('express');
const { auth } = require('../middleware/auth');
const { validate, sendMessageSchema } = require('../utils/validators');
const ctrl = require('../controllers/messageController');

const router = express.Router();

router.use(auth);

router.get('/unread', ctrl.unreadCount);
router.get('/conversations', ctrl.getConversations);
router.get('/:userId', ctrl.getWithUser);
router.post('/', validate(sendMessageSchema), ctrl.send);
router.put('/:id/read', ctrl.markRead);
router.delete('/:id', ctrl.delete);

module.exports = router;

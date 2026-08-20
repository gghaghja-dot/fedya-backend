const express = require('express');
const { auth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const { validate, registerSchema, loginSchema, refreshSchema, verifyEmailSchema, resetPasswordSchema, resetConfirmSchema } = require('../utils/validators');
const ctrl = require('../controllers/authController');

const router = express.Router();

router.post('/register', validate(registerSchema), ctrl.register);
router.post('/login', loginLimiter, validate(loginSchema), ctrl.login);
router.post('/logout', auth, ctrl.logout);
router.post('/refresh', validate(refreshSchema), ctrl.refresh);
router.post('/verify-email', auth, validate(verifyEmailSchema), ctrl.verifyEmail);
router.post('/reset-password', validate(resetPasswordSchema), ctrl.resetPassword);
router.post('/reset-password/confirm', validate(resetConfirmSchema), ctrl.resetPasswordConfirm);

module.exports = router;

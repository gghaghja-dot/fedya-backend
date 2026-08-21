const { z } = require('zod');

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_\u0400-\u04FF]+$/),
  display_name: z.string().min(1).max(64).optional(),
  identityKey: z.string().optional(),
  signedPrekey: z.string().optional(),
  signedPrekeyId: z.number().int().optional(),
  signature: z.string().optional(),
  oneTimePrekeys: z
    .array(z.object({ keyId: z.number().int(), publicKey: z.string() }))
    .optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  fcm_token: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const verifyEmailSchema = z.object({
  code: z.string().min(4).max(12),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
});

const resetConfirmSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).max(128),
});

const updateUserSchema = z.object({
  display_name: z.string().min(1).max(64).optional(),
  avatar_url: z.string().min(1).max(2000).nullable().optional(),
  status_text: z.string().max(200).optional(),
  privacy_photo: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  privacy_online: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  fcm_token: z.string().nullable().optional(),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_\u0400-\u04FF]+$/).optional(),
});

const sendMessageSchema = z.object({
  to: z.string().uuid(),
  content: z.string().min(1),
  encrypted: z.boolean().optional().default(true),
  content_type: z.enum(['text', 'image', 'video', 'document', 'voice', 'sticker', 'circle', 'video_circle']).optional(),
  media_url: z.string().optional().nullable(),
  reply_to: z.string().uuid().optional().nullable(),
  forwarded_from: z.string().uuid().optional().nullable(),
  conversation_id: z.string().uuid().optional().nullable(),
});

const activatePremiumSchema = z.object({
  plan: z.string().min(1),
  paymentMethod: z.string().optional(),
});

const activateCodeSchema = z.object({
  code: z.string().min(3).max(64),
});

const banSchema = z.object({
  reason: z.string().min(1).max(500),
  duration: z.number().int().positive().nullable().optional(),
});

const roleSchema = z.object({
  role: z.enum(['user', 'moderator', 'admin']),
});

const premiumGrantSchema = z.object({
  duration: z.union([z.number().int().positive(), z.literal('lifetime')]),
});

const badgeCreateSchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().max(500).optional(),
  icon: z.string().optional().nullable(),
  icon_url: z.string().optional().nullable(),
  color: z.string().optional(),
  category: z.enum(['achievement', 'premium', 'event', 'special']).optional(),
  is_automatic: z.boolean().optional(),
  auto_condition: z.any().optional(),
});

const announceSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  type: z.string().default('info'),
  expires_at: z.string().datetime().optional().nullable(),
});

const uploadPrekeysSchema = z.object({
  identityKey: z.string().min(1),
  signedPrekey: z.string().min(1),
  signedPrekeyId: z.number().int(),
  signature: z.string().min(1),
  oneTimePrekeys: z
    .array(z.object({ keyId: z.number().int(), publicKey: z.string() }))
    .min(1)
    .optional(),
});

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ошибка валидации',
        details: parsed.error.flatten(),
      });
    }
    req.body = parsed.data;
    next();
  };
}

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resetPasswordSchema,
  resetConfirmSchema,
  updateUserSchema,
  sendMessageSchema,
  activatePremiumSchema,
  activateCodeSchema,
  banSchema,
  roleSchema,
  premiumGrantSchema,
  badgeCreateSchema,
  announceSchema,
  uploadPrekeysSchema,
  validate,
};

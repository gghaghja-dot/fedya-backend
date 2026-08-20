const Subscription = require('../models/Subscription');
const { asyncHandler } = require('../utils/helpers');

const plans = asyncHandler(async (_req, res) => {
  const list = await Subscription.listPlans();
  res.json({ plans: list });
});

const activate = asyncHandler(async (req, res) => {
  // Payment gateway placeholder: activates plan after client confirms method
  const sub = await Subscription.activatePlan(req.user.id, req.body.plan);
  const status = await Subscription.status(req.user.id);
  res.json({
    success: true,
    subscription: sub,
    status,
    paymentMethod: req.body.paymentMethod || 'manual',
  });
});

const activateCode = asyncHandler(async (req, res) => {
  const result = await Subscription.redeemPromo(req.user.id, req.body.code);
  const status = await Subscription.status(req.user.id);
  res.json({ success: true, ...result, status });
});

const status = asyncHandler(async (req, res) => {
  const data = await Subscription.status(req.user.id);
  res.json(data);
});

const history = asyncHandler(async (req, res) => {
  const items = await Subscription.history(req.user.id);
  res.json({ history: items });
});

module.exports = { plans, activate, activateCode, status, history };

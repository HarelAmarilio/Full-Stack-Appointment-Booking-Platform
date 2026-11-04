// [Abuse protection] Free, in-memory rate limiting per client IP (express-rate-limit, MIT).
// Responses use the same { error } JSON shape the frontend already displays.
const { rateLimit } = require("express-rate-limit");

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

// [Abuse protection] General limit on every /api request - stops scripts from hammering the API
const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "יותר מדי בקשות. נא לנסות שוב בעוד מספר דקות." },
});

// [Abuse protection] Max 10 successful bookings per IP per day - stops bots from filling the calendar.
// Failed attempts (taken slot, validation errors) are not counted, so real customers are not penalised.
const bookingLimiter = rateLimit({
  windowMs: ONE_DAY,
  limit: 10,
  skipFailedRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "הגעת למספר התורים המרבי שניתן לקבוע ביום. לתיאום נוסף צרי קשר בוואטסאפ.",
  },
});

// [Abuse protection] Max 5 failed admin logins per IP per 15 minutes - stops password brute-forcing
const loginLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "יותר מדי ניסיונות התחברות. נא לנסות שוב בעוד 15 דקות." },
});

module.exports = { apiLimiter, bookingLimiter, loginLimiter };

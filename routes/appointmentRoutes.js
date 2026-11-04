const express = require("express");
const router = express.Router();
const {
  getAvailableSlots,
  createAppointment,
} = require("../controllers/appointmentController");
// [Abuse protection] Per-IP cap on successful bookings
const { bookingLimiter } = require("../middleware/rateLimiters");

// הגדרת נתיבים תחת /api/appointments
router.get("/available-slots", getAvailableSlots);
// [Abuse protection] bookingLimiter runs before the booking is created
router.post("/appointments", bookingLimiter, createAppointment);
// [Security fix] The public DELETE /appointments/:id route was removed.
// Cancelling is now admin-only: DELETE /api/admin/appointments/:id (see adminRoutes.js)

module.exports = router;

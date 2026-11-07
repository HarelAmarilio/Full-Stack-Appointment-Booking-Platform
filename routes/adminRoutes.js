const express = require("express");
const router = express.Router();
const {
  login,
  getAllAppointmentsForAdmin,
} = require("../controllers/adminController");
const { verifyAdmin } = require("../middleware/authMiddleware");
// [Security fix] Cancelling appointments moved here from the public router so it is admin-only
const { deleteAppointment } = require("../controllers/appointmentController");

// [Abuse protection] Brute-force protection for the admin login
const { loginLimiter } = require("../middleware/rateLimiters");

// [PII protection] Admin responses contain customer data - never cache them
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// A route for admin login
// [Abuse protection] loginLimiter blocks an IP after 5 failed attempts in 15 minutes
router.post("/login", loginLimiter, login);

// A route for getting all appointments for the admin user, protected by the verifyAdmin middleware
router.get("/appointments", verifyAdmin, getAllAppointmentsForAdmin);

// [Security fix] A route for cancelling an appointment, protected by the verifyAdmin middleware
// (previously a public route - anyone could cancel any appointment by ID)
router.delete("/appointments/:id", verifyAdmin, deleteAppointment);

module.exports = router;

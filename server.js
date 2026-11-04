// Importing required modules and initializing environment variables
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const adminRoutes = require("./routes/adminRoutes");
// Importing the initDB function from db.js
const { initDB } = require("./db");

// Importing appointment routes
const appointmentRoutes = require("./routes/appointmentRoutes");

// [Abuse protection] Rate limiter applied to all /api requests
const { apiLimiter } = require("./middleware/rateLimiters");

const app = express();
const PORT = process.env.PORT || 5001;

// [Abuse protection] Render serves the API behind a proxy. Without this, every customer
// would appear to have the proxy's IP and the rate limits would block everyone together.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

// [Abuse protection] Warn loudly at startup if admin login is not configured (login is refused in that case)
["ADMIN_USERNAME", "ADMIN_PASSWORD", "JWT_SECRET"].forEach((name) => {
  if (!process.env[name]) {
    console.error(`⚠️ משתנה הסביבה ${name} חסר - התחברות המנהלת חסומה.`);
  }
});

// Middleware setup
app.use(cors());
app.use(express.json());
// [Abuse protection] General per-IP limit on the whole API
app.use("/api", apiLimiter);

// Endpoint to check if the server is running
app.get("/", (req, res) => {
  res.send("Welcome to the Eyebrow Appointment API!");
});

// Using appointment routes
app.use("/api", appointmentRoutes);
app.use("/api/admin", adminRoutes);
// Starting the server and initializing the database connection
initDB()
  .then(() => console.log("✅ Database connected and setup successfully"))
  .catch((error) =>
    console.error("❌ Failed to connect to the database:", error.message),
  );

if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
  });
}

module.exports = app;

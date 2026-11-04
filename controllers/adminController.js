const jwt = require("jsonwebtoken");
// [Abuse protection] Node's built-in crypto, for constant-time credential comparison
const crypto = require("crypto");
const { pool } = require("../db");

// [Abuse protection] Compares two strings in constant time (hashing makes the lengths equal),
// so response timing does not leak how much of the username/password was correct
const safeEqual = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash("sha256").update(String(a)).digest(),
    crypto.createHash("sha256").update(String(b)).digest(),
  );

// connnection function to the database
const login = (req, res) => {
  // [Abuse protection] Fail closed: if admin credentials are not configured, nobody can log in
  // (previously, missing env vars made `undefined === undefined` succeed)
  const { ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !JWT_SECRET) {
    console.error("❌ התחברות מנהלת חסומה - משתני סביבה חסרים.");
    return res.status(500).json({ error: "שגיאת הגדרות בשרת." });
  }

  // [Abuse protection] `?? {}` - in Express 5 req.body is undefined when no JSON body was sent
  const { username, password } = req.body ?? {};

  // checking details with the .env file
  // [Abuse protection] Constant-time comparison; both checks always run, non-string input is rejected
  const isValidInput =
    typeof username === "string" && typeof password === "string";
  const usernameMatches = safeEqual(username, ADMIN_USERNAME);
  const passwordMatches = safeEqual(password, ADMIN_PASSWORD);
  if (isValidInput && usernameMatches && passwordMatches) {
    // generating a JWT token for the admin user
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, {
      expiresIn: "24h",
    });
    res.status(200).json({ message: "התחברות מוצלחת", token });
  } else {
    res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
  }
};

const getAllAppointmentsForAdmin = async (req, res) => {
  try {
    // Fetch all appointments from the database, ordered by date and time
    const [rows] = await pool.execute(
      `SELECT * FROM Appointments ORDER BY appointment_date DESC, appointment_time DESC`,
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error("❌ שגיאה בשליפת התורים לאדמין:", error.message);
    res.status(500).json({ error: "שגיאה בשליפת הנתונים" });
  }
};

module.exports = { login, getAllAppointmentsForAdmin };

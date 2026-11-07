/*Importing the mysql2/promise library to create a connection pool for MySQL database operations. Using promise-based API allows for async/await syntax, making the code cleaner and easier to read.
Also, importing the dotenv library to load environment variables from a .env file, such as DATABASE_URL, into process.env.
*/
require("dotenv").config();
const mysql = require("mysql2/promise");
// [PII protection] Keeps phone numbers out of the logs
const { redactPhones } = require("./utils/redact");

/*
 Creating a connection pool for MySQL database operations.
 */
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // [TZ fix] Build DATE values at UTC midnight regardless of the server's time zone
  timezone: "Z",
});

/*
Creating an async function initDB to initialize the database connection and ensure that the necessary table (Appointments) exists. The function attempts to get a connection from the pool, logs a success message if successful, and releases the connection back to the pool. It then executes a SQL query to create the Appointments table if it does not already exist. If any errors occur during this process, they are logged and re-thrown for handling in server.js.
*/
async function initDB() {
  try {
    const connection = await pool.getConnection();
    console.log("החיבור למסד הנתונים MySQL הצליח");
    connection.release(); // Returning the connection back to the pool after successful connection

    // Executing a SQL query to create the Appointments table if it does not already exist
    await pool.execute(`
    CREATE TABLE IF NOT EXISTS Appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    client_phone VARCHAR(20) NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    google_event_id VARCHAR(255),
    treatment_type VARCHAR(255)
)
    `);

    try {
      await pool.execute(
        "ALTER TABLE Appointments ADD COLUMN google_event_id VARCHAR(255)",
      );
      console.log("✅ עמודת google_event_id התווספה בהצלחה למסד הנתונים!");
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") {
        console.error("⚠️ הערה בנוגע לעמודה google_event_id:", error.message);
      }
    }
    try {
      await pool.execute(
        "ALTER TABLE Appointments ADD COLUMN treatment_type VARCHAR(255)",
      );
      console.log("✅ עמודת treatment_type התווספה בהצלחה למסד הנתונים!");
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") {
        console.error("⚠️ הערה בנוגע לעמודה treatment_type:", error.message);
      }
    }

    // [Race-condition fix] Generated column: 1 for active appointments, NULL for cancelled ones.
    // A UNIQUE index ignores NULLs, so cancelled appointments never block a slot.
    try {
      await pool.execute(
        `ALTER TABLE Appointments ADD COLUMN is_active TINYINT
         GENERATED ALWAYS AS (IF(status <> 'cancelled', 1, NULL)) STORED`,
      );
      console.log("✅ עמודת is_active התווספה בהצלחה למסד הנתונים!");
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") {
        console.error("⚠️ הערה בנוגע לעמודה is_active:", error.message);
      }
    }

    // [Race-condition fix] Let the database itself reject double bookings, even for concurrent requests:
    // one active appointment per slot, and one active appointment per phone per day.
    const uniqueIndexes = [
      "ALTER TABLE Appointments ADD UNIQUE KEY uniq_active_slot (appointment_date, appointment_time, is_active)",
      "ALTER TABLE Appointments ADD UNIQUE KEY uniq_active_client_day (appointment_date, client_phone, is_active)",
    ];
    for (const sql of uniqueIndexes) {
      try {
        await pool.execute(sql);
        console.log("✅ אינדקס ייחודי נוסף:", sql.split(" ")[6]);
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
          // Existing data already contains duplicates - the index cannot be created until they are resolved
          console.error(
            "⚠️ לא ניתן ליצור אינדקס ייחודי - קיימים תורים כפולים במסד הנתונים:",
            // [PII protection] The duplicate-entry message quotes the duplicate value (may include a phone)
            redactPhones(error.message),
          );
        } else if (error.code !== "ER_DUP_KEYNAME") {
          console.error("⚠️ הערה בנוגע לאינדקס הייחודי:", error.message);
        }
      }
    }

    console.log("טבלת Appointments מוכנה לשימוש");
  } catch (error) {
    console.error("שגיאה באתחול מסד הנתונים:", error.message);
    throw error;
  }
}

/*
Exporting the pool and initDB function for use in other parts of the application, such as server.js. This allows other modules to access the database connection pool and initialize the database as needed.
*/
module.exports = { pool, initDB };

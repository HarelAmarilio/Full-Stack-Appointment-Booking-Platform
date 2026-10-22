/*Importing the mysql2/promise library to create a connection pool for MySQL database operations. Using promise-based API allows for async/await syntax, making the code cleaner and easier to read.
Also, importing the dotenv library to load environment variables from a .env file, such as DATABASE_URL, into process.env.
*/
require("dotenv").config();
const mysql = require("mysql2/promise");

/*
 Creating a connection pool for MySQL database operations.
 */
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
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

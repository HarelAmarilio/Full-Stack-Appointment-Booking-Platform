const { pool } = require("../db");
const {
  addEventToCalendar,
  deleteEventFromCalendar,
} = require("../services/calendarService");

const ALL_TIME_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
];

// A function for data validation
const validateAppointmentData = (name, phone, date, time) => {
  if (!name || name.trim().length < 2) {
    return "נא להזין שם מלא תקין (לפחות 2 תווים).";
  }

  const cleanPhone = phone.replace(/[- ]/g, "");
  const phoneRegex = /^0\d{8,9}$/;
  if (!phoneRegex.test(cleanPhone)) {
    return "מספר הטלפון שהוזן אינו תקין. נא להזין מספר ישראלי חוקי (למשל: 0501234567).";
  }

  const today = new Date().toISOString().split("T")[0];
  if (date < today) {
    return "לא ניתן לקבוע תור לתאריך עבר.";
  }

  if (!ALL_TIME_SLOTS.includes(time)) {
    return "השעה שנבחרה אינה נמצאת בשעות הפעילות המותרות.";
  }

  return null;
};

// 1. שליפת שעות פנויות
const getAvailableSlots = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res
        .status(400)
        .json({ error: "חובה לספק פרמטר date, לדוגמה: ?date=2026-08-25" });
    }

    const requestDate = new Date(date);
    const dayOfWeek = requestDate.getDay(); // 0 = ראשון, 5 = שישי, 6 = שבת

    // חסימת ימי שישי ושבת
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      return res.status(200).json([]);
    }

    // הגדרת שעות הפעילות הקבועות
    const ALL_TIME_SLOTS = [
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
      "19:00",
    ];

    const [bookedRows] = await pool.execute(
      `SELECT appointment_time FROM Appointments
       WHERE appointment_date = ? AND status != 'cancelled'`,
      [date],
    );

    const bookedTimes = bookedRows.map((row) =>
      row.appointment_time.slice(0, 5),
    );

    let availableSlots = ALL_TIME_SLOTS.filter(
      (slot) => !bookedTimes.includes(slot),
    );

    const nowIsrael = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }),
    );

    const currentYear = nowIsrael.getFullYear();
    const currentMonth = String(nowIsrael.getMonth() + 1).padStart(2, "0");
    const currentDay = String(nowIsrael.getDate()).padStart(2, "0");
    const todayStr = `${currentYear}-${currentMonth}-${currentDay}`;

    if (date === todayStr) {
      const currentHour = nowIsrael.getHours();
      const currentMinute = nowIsrael.getMinutes();

      availableSlots = availableSlots.filter((slot) => {
        const [slotHour, slotMinute] = slot.split(":").map(Number);
        return (
          slotHour > currentHour ||
          (slotHour === currentHour && slotMinute > currentMinute)
        );
      });
    }

    res.status(200).json(availableSlots);
  } catch (error) {
    console.error("❌ Failed to fetch available slots:", error.message);
    res.status(500).json({ error: "שגיאה בשליפת השעות הפנויות" });
  }
};

// 2. יצירת תור חדש
const createAppointment = async (req, res) => {
  const { client_name, client_phone, appointment_date, appointment_time } =
    req.body;

  // הוסף את הבלוק הזה כדי לעצור בקשות חסרות מיד
  if (!client_name || !client_phone || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "חסרים נתוני חובה לקביעת התור" });
  }
  console.log("👉 השרת קיבל בקשה ליצירת תור! נתונים:", req.body);
  try {
    let { client_name, client_phone, appointment_date, appointment_time } =
      req.body;
    const validationError = validateAppointmentData(
      client_name,
      client_phone,
      appointment_date,
      appointment_time,
    );
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    if (
      !client_name ||
      !client_phone ||
      !appointment_date ||
      !appointment_time
    ) {
      return res.status(400).json({
        error:
          "חובה לספק את כל השדות: client_name, client_phone, appointment_date, appointment_time",
      });
    }

    // ניקוי נתונים
    client_phone = client_phone.trim().replace(/[- ]/g, "");
    client_name = client_name.trim();

    // בדיקת כפילות טלפון ביום
    const [clientAppointments] = await pool.execute(
      `SELECT id FROM Appointments
       WHERE appointment_date = ? AND client_phone = ? AND status != 'cancelled'`,
      [appointment_date, client_phone],
    );

    if (clientAppointments.length > 0) {
      return res.status(409).json({
        error:
          "כבר קיים תור למספר טלפון זה בתאריך המבוקש. לא ניתן לקבוע יותר מתור אחד ביום.",
      });
    }

    // בדיקת זמינות שעה
    const [existingRows] = await pool.execute(
      `SELECT id FROM Appointments
       WHERE appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`,
      [appointment_date, appointment_time],
    );

    if (existingRows.length > 0) {
      return res.status(409).json({
        error: "השעה המבוקשת כבר תפוסה, אנא בחר/י שעה אחרת",
      });
    }

    // שמירה ב-DB
    const [result] = await pool.execute(
      `INSERT INTO Appointments (client_name, client_phone, appointment_date, appointment_time, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [client_name, client_phone, appointment_date, appointment_time],
    );

    const appointmentId = result.insertId;

    // אינטגרציה עם גוגל יומן דרך ה-Service
    try {
      const googleEventId = await addEventToCalendar(
        client_name,
        client_phone,
        appointment_date,
        appointment_time,
      );

      // עדכון ה-google_event_id במסד הנתונים
      await pool.execute(
        `UPDATE Appointments SET google_event_id = ? WHERE id = ?`,
        [googleEventId, appointmentId],
      );

      console.log(`✅ האירוע נשמר בגוגל יומן בהצלחה (ID: ${googleEventId})!`);
    } catch (calendarError) {
      console.error("❌ שגיאה בשמירה ליומן של גוגל:", calendarError.message);
    }

    res.status(201).json({
      message: "התור נקבע בהצלחה!",
      appointment: {
        id: appointmentId,
        client_name,
        client_phone,
        appointment_date,
        appointment_time,
        status: "pending",
      },
    });
  } catch (error) {
    console.error("❌ Failed to create appointment:", error.message);
    res.status(500).json({ error: "שגיאה בקביעת התור" });
  }
};

// 3. מחיקת/ביטול תור
const deleteAppointment = async (req, res) => {
  const appointmentId = req.params.id;
  console.log(`🗑️ בקשה למחיקת תור מזהה: ${appointmentId}`);

  try {
    const [rows] = await pool.execute(
      `SELECT * FROM Appointments WHERE id = ? AND status != 'cancelled'`,
      [appointmentId],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: "התור המבוקש לא נמצא או כבר בוטל." });
    }

    const appointment = rows[0];

    if (appointment.google_event_id) {
      try {
        await deleteEventFromCalendar(appointment.google_event_id);
        console.log(`✅ האירוע הוסר בהצלחה מ-Google Calendar!`);
      } catch (googleError) {
        console.error(
          "⚠️ שגיאה במחיקת האירוע מגוגל (נמשיך במחיקה מ-DB):",
          googleError.message,
        );
      }
    }

    await pool.execute(
      `UPDATE Appointments SET status = 'cancelled' WHERE id = ?`,
      [appointmentId],
    );

    res.status(200).json({
      message: "התור בוטל ונמחק בהצלחה!",
      deletedId: appointmentId,
    });
  } catch (error) {
    console.error("❌ שגיאה במחיקת התור:", error.message);
    res.status(500).json({ error: "שגיאה פנימית במחיקת התור" });
  }
};

module.exports = {
  getAvailableSlots,
  createAppointment,
  deleteAppointment,
};

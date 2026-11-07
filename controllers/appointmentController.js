const { pool } = require("../db");
// [PII protection] Helpers for keeping phone numbers out of the logs
const { maskPhone, redactPhones } = require("../utils/redact");
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
  "19:00",
];

// [Abuse protection] Booking window and input limits - stops bots from filling the calendar far ahead
const MAX_DAYS_AHEAD = 60;
const MAX_NAME_LENGTH = 100;
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// [Abuse protection] Last bookable date (YYYY-MM-DD), counted from today in Israel
const getMaxBookingDateStr = () => {
  const nowIsrael = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }),
  );
  return new Date(
    Date.UTC(
      nowIsrael.getFullYear(),
      nowIsrael.getMonth(),
      nowIsrael.getDate() + MAX_DAYS_AHEAD,
    ),
  )
    .toISOString()
    .slice(0, 10);
};

const validateAppointmentData = (name, phone, date, time) => {
  if (!name || name.trim().length < 2) {
    return "נא להזין שם מלא תקין (לפחות 2 תווים).";
  }

  // [Abuse protection] Cap the name length (longer names also overflowed the DB column -> 500)
  if (name.trim().length > MAX_NAME_LENGTH) {
    return `השם ארוך מדי (עד ${MAX_NAME_LENGTH} תווים).`;
  }

  // [Abuse protection] Strict date format and booking window
  if (!DATE_FORMAT_REGEX.test(date)) {
    return "תאריך לא תקין.";
  }
  if (date > getMaxBookingDateStr()) {
    return `ניתן לקבוע תור עד ${MAX_DAYS_AHEAD} יום מראש.`;
  }

  const cleanPhone = phone.replace(/[- ]/g, "");
  const phoneRegex = /^0\d{8,9}$/;
  if (!phoneRegex.test(cleanPhone)) {
    return "מספר הטלפון שהוזן אינו תקין.";
  }

  if (!ALL_TIME_SLOTS.includes(time)) {
    return "השעה שנבחרה אינה נמצאת בשעות הפעילות המותרות.";
  }

  // חישוב התאריך הנוכחי לפי שעון ישראל בלבד (מונע פערים בחצות)
  const nowIsrael = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }),
  );
  const currentYear = nowIsrael.getFullYear();
  const currentMonth = String(nowIsrael.getMonth() + 1).padStart(2, "0");
  const currentDay = String(nowIsrael.getDate()).padStart(2, "0");
  const todayStr = `${currentYear}-${currentMonth}-${currentDay}`;

  if (date < todayStr) {
    return "לא ניתן לקבוע תור לתאריך עבר.";
  }

  // אכיפת חסימת סופ"ש בבקשות POST ישירות
  const requestDate = new Date(date);
  const dayOfWeek = requestDate.getDay();
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    return "לא ניתן לקבוע תורים בימי שישי ושבת.";
  }

  // אכיפת ה-Buffer (שעתיים) עבור תורים מהיום להיום
  if (date === todayStr) {
    const currentHour = nowIsrael.getHours();
    const currentMinute = nowIsrael.getMinutes();
    const [slotHour] = time.split(":").map(Number);

    // תיקון החישוב: אם השעה 14:15, המינימום יהיה 17:00 (שעתיים + עיגול שעה למעלה)
    const minAllowedHour = currentHour + 2 + (currentMinute > 0 ? 1 : 0);

    if (slotHour < minAllowedHour) {
      return "יש לקבוע תור לפחות שעתיים מראש.";
    }
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

    // [Abuse protection] Reject malformed dates before they reach the DB
    if (!DATE_FORMAT_REGEX.test(date)) {
      return res.status(400).json({ error: "תאריך לא תקין." });
    }

    // [Abuse protection] Nothing is bookable beyond the booking window
    if (date > getMaxBookingDateStr()) {
      return res.status(200).json([]);
    }

    const requestDate = new Date(date);
    const dayOfWeek = requestDate.getDay();

    if (dayOfWeek === 5 || dayOfWeek === 6) {
      return res.status(200).json([]);
    }

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

      const bufferHour = currentHour + 2;

      availableSlots = availableSlots.filter((slot) => {
        const [slotHour, slotMinute] = slot.split(":").map(Number);
        return (
          slotHour > bufferHour ||
          (slotHour === bufferHour && slotMinute > currentMinute)
        );
      });
    }

    res.status(200).json(availableSlots);
  } catch (error) {
    // [PII protection] DB error messages can contain row values
    console.error(
      "❌ Failed to fetch available slots:",
      redactPhones(error.message),
    );
    res.status(500).json({ error: "שגיאה בשליפת השעות הפנויות" });
  }
};

// 2. יצירת תור חדש
const createAppointment = async (req, res) => {
  // חילוץ סוג הטיפול מהבקשה
  let {
    client_name,
    client_phone,
    appointment_date,
    appointment_time,
    treatment_type,
  } = req.body;

  if (!client_name || !client_phone || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: "חסרים נתוני חובה לקביעת התור" });
  }
  // [PII protection] Log only what is needed for support - no name, masked phone
  console.log("👉 השרת קיבל בקשה ליצירת תור!", {
    date: appointment_date,
    time: appointment_time,
    treatment: treatment_type,
    phone: maskPhone(client_phone),
  });

  try {
    const validationError = validateAppointmentData(
      client_name,
      client_phone,
      appointment_date,
      appointment_time,
    );
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    client_phone = client_phone.trim().replace(/[- ]/g, "");
    client_name = client_name.trim();

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

    // [Race-condition fix] The checks above can both pass for two simultaneous requests.
    // The UNIQUE indexes (see db.js) make the database reject the second INSERT - translate that into a 409.
    let result;
    try {
      [result] = await pool.execute(
        `INSERT INTO Appointments (client_name, client_phone, appointment_date, appointment_time, treatment_type, status)
   VALUES (?, ?, ?, ?, ?, 'pending')`,
        [
          client_name,
          client_phone,
          appointment_date,
          appointment_time,
          treatment_type,
        ],
      );
    } catch (insertError) {
      if (insertError.code === "ER_DUP_ENTRY") {
        const isSameClient = insertError.message.includes(
          "uniq_active_client_day",
        );
        return res.status(409).json({
          error: isSameClient
            ? "כבר קיים תור למספר טלפון זה בתאריך המבוקש. לא ניתן לקבוע יותר מתור אחד ביום."
            : "השעה המבוקשת כבר תפוסה, אנא בחר/י שעה אחרת",
        });
      }
      throw insertError;
    }

    const appointmentId = result.insertId;

    try {
      // העברת סוג הטיפול לפונקציה שאחראית על לוח השנה
      const googleEventId = await addEventToCalendar(
        client_name,
        client_phone,
        appointment_date,
        appointment_time,
        treatment_type,
      );

      await pool.execute(
        `UPDATE Appointments SET google_event_id = ? WHERE id = ?`,
        [googleEventId, appointmentId],
      );

      console.log(`✅ האירוע נשמר בגוגל יומן בהצלחה (ID: ${googleEventId})!`);
    } catch (calendarError) {
      console.error("❌ שגיאה בשמירה ליומן של גוגל:", calendarError.message);
    }

    // [PII protection] The response echoes the customer's details - never cache it
    res.set("Cache-Control", "no-store");
    res.status(201).json({
      message: "התור נקבע בהצלחה!",
      appointment: {
        id: appointmentId,
        client_name,
        client_phone,
        appointment_date,
        appointment_time,
        treatment_type,
        status: "pending",
      },
    });
  } catch (error) {
    // [PII protection] DB error messages can contain row values
    console.error(
      "❌ Failed to create appointment:",
      redactPhones(error.message),
    );
    res.status(500).json({ error: "שגיאה בקביעת התור" });
  }
};

// 3. מחיקת/ביטול תור
const deleteAppointment = async (req, res) => {
  const appointmentId = req.params.id;
  console.log(`🗑️ בקשה למחיקת תור מזהה: ${appointmentId}`);

  try {
    const [rows] = await pool.execute(
      // [PII protection] Fetch only what cancellation needs - no customer data
      `SELECT id, google_event_id FROM Appointments WHERE id = ? AND status != 'cancelled'`,
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
    // [PII protection] DB error messages can contain row values
    console.error("❌ שגיאה במחיקת התור:", redactPhones(error.message));
    res.status(500).json({ error: "שגיאה פנימית במחיקת התור" });
  }
};

module.exports = {
  getAvailableSlots,
  createAppointment,
  deleteAppointment,
};

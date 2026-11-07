const { pool } = require("../db");
// [PII protection] Helpers for keeping phone numbers out of the logs
const { maskPhone, redactPhones } = require("../utils/redact");
const {
  addEventToCalendar,
  deleteEventFromCalendar,
} = require("../services/calendarService");
// [Calendar sync fix] Shared with the retry job so the two never sync the same appointment at once
const { inFlight } = require("../services/calendarSyncJob");

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

// [Validation fix] Same treatment list the booking page shows (shared/treatments.json)
const TREATMENT_NAMES = require("../shared/treatments.json").map((t) => t.name);

// [Validation fix] "YYYY-MM-DD" that is also a real calendar day (rejects 2026-02-31, 2026-13-45)
const isValidDateStr = (value) => {
  if (typeof value !== "string" || !DATE_FORMAT_REGEX.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === value;
};

// [Abuse protection] Last bookable date (YYYY-MM-DD), counted from today in Israel
const getMaxBookingDateStr = () => {
  // [TZ fix] One shared "today in Israel" (getIsraelNow below)
  const [y, m, d] = getIsraelNow().dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + MAX_DAYS_AHEAD))
    .toISOString()
    .slice(0, 10);
};

// [TZ fix] Day of week (0 = Sunday) of a calendar date, independent of the server's time zone
const getDayOfWeek = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

// [Buffer fix] Single source of truth for the same-day buffer: at least 2 hours ahead, Israel time
const BOOKING_BUFFER_MINUTES = 120;

// [Buffer fix] Current date and minutes-since-midnight in Israel, independent of the server's time zone
const getIsraelNow = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

// [Buffer fix] The one rule used by both the slot list and booking validation
const isSlotBookable = (date, slot, now = getIsraelNow()) => {
  if (date < now.dateStr) return false;
  if (date > now.dateStr) return true;
  const [hour, minute] = slot.split(":").map(Number);
  return hour * 60 + minute - now.minutes >= BOOKING_BUFFER_MINUTES;
};

const validateAppointmentData = (name, phone, date, time, treatment) => {
  // [Validation fix] JSON can carry numbers/objects/arrays - anything but a string is a 400, not a crash
  if ([name, phone, date, time].some((value) => typeof value !== "string")) {
    return "נתונים לא תקינים.";
  }

  if (!name || name.trim().length < 2) {
    return "נא להזין שם מלא תקין (לפחות 2 תווים).";
  }

  // [Abuse protection] Cap the name length (longer names also overflowed the DB column -> 500)
  if (name.trim().length > MAX_NAME_LENGTH) {
    return `השם ארוך מדי (עד ${MAX_NAME_LENGTH} תווים).`;
  }

  // [Abuse protection] Strict date format and booking window
  // [Validation fix] isValidDateStr also rejects days that don't exist
  if (!isValidDateStr(date)) {
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
  // [Buffer fix] Shared Israel-time "now"
  const now = getIsraelNow();

  if (date < now.dateStr) {
    return "לא ניתן לקבוע תור לתאריך עבר.";
  }

  // אכיפת חסימת סופ"ש בבקשות POST ישירות
  const dayOfWeek = getDayOfWeek(date); // [TZ fix]
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    return "לא ניתן לקבוע תורים בימי שישי ושבת.";
  }

  // אכיפת ה-Buffer (שעתיים) עבור תורים מהיום להיום
  // [Buffer fix] Same rule as the slot list
  if (!isSlotBookable(date, time, now)) {
    return "יש לקבוע תור לפחות שעתיים מראש.";
  }

  // [Validation fix] Treatment stays optional (as before), but if sent it must be one the studio offers -
  // stops arbitrary text from being written into the owner's Google Calendar
  if (treatment != null && !TREATMENT_NAMES.includes(treatment)) {
    return "סוג הטיפול שנבחר אינו קיים. נא לבחור טיפול מהרשימה.";
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
    // [Validation fix] ...and dates that don't exist, or repeated ?date= params (arrays)
    if (!isValidDateStr(date)) {
      return res.status(400).json({ error: "תאריך לא תקין." });
    }

    // [Abuse protection] Nothing is bookable beyond the booking window
    if (date > getMaxBookingDateStr()) {
      return res.status(200).json([]);
    }

    // [Buffer fix] Past dates have no bookable slots (booking validation already rejects them)
    const now = getIsraelNow();
    if (date < now.dateStr) {
      return res.status(200).json([]);
    }

    const dayOfWeek = getDayOfWeek(date); // [TZ fix]

    if (dayOfWeek === 5 || dayOfWeek === 6) {
      return res.status(200).json([]);
    }

    // [Buffer fix] Removed an identical local copy of ALL_TIME_SLOTS - the module-level list is used

    const [bookedRows] = await pool.execute(
      `SELECT appointment_time FROM Appointments
       WHERE appointment_date = ? AND status != 'cancelled'`,
      [date],
    );

    const bookedTimes = bookedRows.map((row) =>
      row.appointment_time.slice(0, 5),
    );

    // [Buffer fix] Same rule as booking validation
    const availableSlots = ALL_TIME_SLOTS.filter(
      (slot) => !bookedTimes.includes(slot) && isSlotBookable(date, slot, now),
    );

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
  } = req.body ?? {}; // [Validation fix] Express 5: req.body is undefined when no JSON was sent

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
      treatment_type, // [Validation fix]
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

    inFlight.add(appointmentId); // [Calendar sync fix] the retry job must not race this call
    try {
      // העברת סוג הטיפול לפונקציה שאחראית על לוח השנה
      const googleEventId = await addEventToCalendar(
        client_name,
        client_phone,
        appointment_date,
        appointment_time,
        treatment_type,
        appointmentId, // [Calendar sync fix] for the deterministic event ID
      );

      await pool.execute(
        // [Calendar sync fix] Never overwrite an ID the retry job may have stored
        `UPDATE Appointments SET google_event_id = ? WHERE id = ? AND google_event_id IS NULL`,
        [googleEventId, appointmentId],
      );

      console.log(`✅ האירוע נשמר בגוגל יומן בהצלחה (ID: ${googleEventId})!`);
    } catch (calendarError) {
      // [Calendar sync fix] Not lost: google_event_id stays NULL and the sync job retries every 5 minutes
      console.error(
        "❌ שגיאה בשמירה ליומן של גוגל (ננסה שוב אוטומטית):",
        redactPhones(calendarError.message),
      );
    } finally {
      inFlight.delete(appointmentId);
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

    // [Calendar sync fix] The DB is the source of truth - cancel there first
    await pool.execute(
      `UPDATE Appointments SET status = 'cancelled' WHERE id = ?`,
      [appointmentId],
    );

    if (appointment.google_event_id) {
      try {
        await deleteEventFromCalendar(appointment.google_event_id);
        // [Calendar sync fix] NULL = "no longer in the calendar"; a remaining ID means the job will retry
        await pool.execute(
          `UPDATE Appointments SET google_event_id = NULL WHERE id = ?`,
          [appointmentId],
        );
        console.log(`✅ האירוע הוסר בהצלחה מ-Google Calendar!`);
      } catch (googleError) {
        console.error(
          "⚠️ שגיאה במחיקת האירוע מגוגל (ננסה שוב אוטומטית):",
          redactPhones(googleError.message),
        );
      }
    }

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

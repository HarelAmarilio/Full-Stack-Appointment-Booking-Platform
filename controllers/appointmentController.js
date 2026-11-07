const { pool } = require("../db");
// [PII protection] Helpers for keeping phone numbers out of the logs
const { maskPhone, redactPhones } = require("../utils/redact");
const {
  addEventToCalendar,
  deleteEventFromCalendar,
} = require("../services/calendarService");
// [Calendar sync fix] Shared with the retry job so the two never sync the same appointment at once
const { inFlight } = require("../services/calendarSyncJob");

// [Rules fix] All business rules (hours, closed days, buffer, window, phone, treatments) live in
// domain/schedule.js, driven by shared/businessRules.json - the booking page reads the same file
const {
  TIME_SLOTS,
  TREATMENTS,
  isValidDateStr,
  isClosedDay,
  normalizePhone,
  getIsraelNow,
  getMaxBookingDateStr,
  isSlotBookable,
  validateBooking,
} = require("../domain/schedule");

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

    // [Buffer fix] Past dates have no bookable slots (booking validation already rejects them)
    const now = getIsraelNow();

    // [Abuse protection] Nothing is bookable beyond the booking window
    if (date > getMaxBookingDateStr(now)) {
      return res.status(200).json([]);
    }

    if (date < now.dateStr) {
      return res.status(200).json([]);
    }

    // [Rules fix] Closed days come from the business rules (Friday and Saturday today)
    if (isClosedDay(date)) {
      return res.status(200).json([]);
    }

    const [bookedRows] = await pool.execute(
      `SELECT appointment_time FROM Appointments
       WHERE appointment_date = ? AND status != 'cancelled'`,
      [date],
    );

    const bookedTimes = bookedRows.map((row) =>
      row.appointment_time.slice(0, 5),
    );

    // [Buffer fix] Same rule as booking validation
    const availableSlots = TIME_SLOTS.filter(
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
    // [Rules fix] Validation lives in the domain module
    const validationError = validateBooking({
      name: client_name,
      phone: client_phone,
      date: appointment_date,
      time: appointment_time,
      treatment: treatment_type,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    client_phone = normalizePhone(client_phone); // [Rules fix]
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

// [Rules fix] Treatment catalogue served from the API (single source: shared/businessRules.json)
const getTreatments = (req, res) => {
  res.status(200).json(TREATMENTS);
};

module.exports = {
  getAvailableSlots,
  createAppointment,
  deleteAppointment,
  getTreatments, // [Rules fix]
};

const { pool } = require("../db");
const {
  addEventToCalendar,
  deleteEventFromCalendar,
  getStatus,
} = require("./calendarService");
const { redactPhones } = require("../utils/redact");

// [Calendar sync fix] Retries calendar sync until the DB and Google Calendar agree:
//  - active appointment, google_event_id NULL        -> add it to the calendar
//  - cancelled appointment, google_event_id NOT NULL -> delete it from the calendar
// Cost: free (Google Calendar API standard use). Worst case ~40 calls per run, and a run
// stops at the first sign Google is unavailable, so an outage costs ~1 call per 5 minutes.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 20;

// [Calendar sync fix] Appointment IDs whose calendar call is in progress right now (single Render
// instance), so the job never races a booking that is still talking to Google
const inFlight = new Set();
let isRunning = false;

// [Calendar sync fix] 400 = a problem with this one record - skip it and continue.
// Anything else (network, timeout, 401 expired credentials, 5xx) = Google unavailable - stop this run.
const shouldStopRun = (error) => getStatus(error) !== 400;

async function syncPendingEvents() {
  if (isRunning) return;
  isRunning = true;
  try {
    // Today and future only (1-day margin covers the DB's UTC clock vs Israel time)
    const [toAdd] = await pool.execute(
      `SELECT id, client_name, client_phone, treatment_type,
              DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointment_date,
              TIME_FORMAT(appointment_time, '%H:%i') AS appointment_time
       FROM Appointments
       WHERE status != 'cancelled' AND google_event_id IS NULL
         AND appointment_date >= CURDATE() - INTERVAL 1 DAY
       ORDER BY appointment_date, appointment_time
       LIMIT ${BATCH_SIZE}`,
    );
    for (const a of toAdd) {
      if (inFlight.has(a.id)) continue;
      inFlight.add(a.id);
      try {
        const eventId = await addEventToCalendar(
          a.client_name,
          a.client_phone,
          a.appointment_date,
          a.appointment_time,
          a.treatment_type,
          a.id,
        );
        await pool.execute(
          `UPDATE Appointments SET google_event_id = ? WHERE id = ? AND google_event_id IS NULL`,
          [eventId, a.id],
        );
        console.log(`🔄 תור ${a.id} סונכרן ליומן גוגל (ניסיון חוזר)`);
      } catch (error) {
        console.error(
          `⚠️ סנכרון תור ${a.id} ליומן נכשל, ננסה שוב:`,
          redactPhones(error.message),
        );
        if (shouldStopRun(error)) return;
      } finally {
        inFlight.delete(a.id);
      }
    }

    const [toDelete] = await pool.execute(
      `SELECT id, google_event_id FROM Appointments
       WHERE status = 'cancelled' AND google_event_id IS NOT NULL
         AND appointment_date >= CURDATE() - INTERVAL 1 DAY
       LIMIT ${BATCH_SIZE}`,
    );
    for (const a of toDelete) {
      try {
        await deleteEventFromCalendar(a.google_event_id);
        await pool.execute(
          `UPDATE Appointments SET google_event_id = NULL WHERE id = ? AND status = 'cancelled'`,
          [a.id],
        );
      } catch (error) {
        console.error(
          `⚠️ מחיקת תור ${a.id} מהיומן נכשלה, ננסה שוב:`,
          redactPhones(error.message),
        );
        if (shouldStopRun(error)) return;
      }
    }
  } catch (error) {
    console.error("❌ שגיאה בסנכרון היומן:", redactPhones(error.message));
  } finally {
    isRunning = false;
  }
}

// [Calendar sync fix] Runs shortly after startup, then every 5 minutes; unref() never keeps the process alive
function startCalendarSync() {
  setTimeout(syncPendingEvents, 30 * 1000).unref();
  setInterval(syncPendingEvents, SYNC_INTERVAL_MS).unref();
}

module.exports = { startCalendarSync, syncPendingEvents, inFlight };

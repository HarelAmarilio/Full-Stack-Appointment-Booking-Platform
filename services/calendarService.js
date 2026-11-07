const { google } = require("googleapis");
// [Calendar sync fix] Node's built-in crypto, for deterministic event IDs
const crypto = require("crypto");
// [Rules fix] Appointment length and time zone come from the business rules
const { RULES, getEndTime } = require("../domain/schedule");

// [Calendar sync fix] Bound every Google call - a slow Google must not hang a booking
const GOOGLE_TIMEOUT_MS = 10000;

// [Calendar sync fix] Deterministic event ID (hex is valid for Google event IDs).
// Retrying the same appointment can never create a duplicate event.
const buildEventId = (appointmentId, date, time, phone) =>
  crypto
    .createHash("sha256")
    .update(`${appointmentId}|${date}|${time}|${phone}`)
    .digest("hex");

// [Calendar sync fix] HTTP status of a googleapis error
const getStatus = (error) => error.status ?? error.response?.status;

// הגדרת ה-oauth2Client והיומן
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:5001/oauth2callback",
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

// פונקציה להוספת אירוע ליומן
async function addEventToCalendar(
  clientName,
  clientPhone,
  appointmentDate,
  appointmentTime,
  treatmentType,
  appointmentId, // [Calendar sync fix] used for the deterministic event ID
) {
  const eventId = buildEventId(
    appointmentId,
    appointmentDate,
    appointmentTime,
    clientPhone,
  );

  // חישוב שעת הסיום בצורה טקסטואלית כדי למנוע באגים של שעון חורף/קיץ
  // [Rules fix] start + appointmentDurationMinutes (wall-clock), instead of a hard-coded "+1 hour"
  const endTimeString = getEndTime(appointmentTime);

  const event = {
    id: eventId, // [Calendar sync fix]
    summary: `תור: ${clientName} - ${treatmentType || "לא צוין טיפול"}`,
    description: `לקוחה: ${clientName}\nטלפון הלקוחה: ${clientPhone}\nסוג טיפול: ${treatmentType || "לא צוין"}`,
    start: {
      // שליחת המחרוזת כפי שהיא, ללא "+03:00"
      dateTime: `${appointmentDate}T${appointmentTime}:00`,
      timeZone: RULES.timezone, // [Rules fix]
    },
    end: {
      dateTime: `${appointmentDate}T${endTimeString}:00`,
      timeZone: RULES.timezone, // [Rules fix]
    },
  };

  try {
    await calendar.events.insert(
      {
        calendarId: "primary",
        requestBody: event,
      },
      { timeout: GOOGLE_TIMEOUT_MS }, // [Calendar sync fix]
    );
  } catch (error) {
    // [Calendar sync fix] 409 = this exact event was already created by an earlier attempt
    if (getStatus(error) !== 409) throw error;
  }

  return eventId;
}

// פונקציה למחיקת אירוע מהיומן
// פונקציה למחיקת אירוע מהיומן של גוגל לפי מזהה
const deleteEventFromCalendar = async (eventId) => {
  try {
    await calendar.events.delete(
      {
        calendarId: "primary",
        eventId: eventId,
      },
      { timeout: GOOGLE_TIMEOUT_MS }, // [Calendar sync fix]
    );
    console.log(`✅ אירוע ${eventId} נמחק בהצלחה מגוגל יומן`);
  } catch (error) {
    // [Calendar sync fix] 404/410 = the event is already gone - that is the goal, not an error
    if ([404, 410].includes(getStatus(error))) return;
    console.error("❌ שגיאה במחיקת אירוע מגוגל יומן:", error.message);
    throw error;
  }
};

module.exports = {
  addEventToCalendar,
  deleteEventFromCalendar,
  getStatus, // [Calendar sync fix] used by the sync job
};

const { google } = require("googleapis");

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
) {
  // חישוב שעת הסיום בצורה טקסטואלית כדי למנוע באגים של שעון חורף/קיץ
  const [hour, minute] = appointmentTime.split(":").map(Number);
  const endHour = String(hour + 1).padStart(2, "0");
  const endTimeString = `${endHour}:${String(minute).padStart(2, "0")}`;

  const event = {
    summary: `תור: ${clientName} - ${treatmentType || "לא צוין טיפול"}`,
    description: `לקוחה: ${clientName}\nטלפון הלקוחה: ${clientPhone}\nסוג טיפול: ${treatmentType || "לא צוין"}`,
    start: {
      // שליחת המחרוזת כפי שהיא, ללא "+03:00"
      dateTime: `${appointmentDate}T${appointmentTime}:00`,
      timeZone: "Asia/Jerusalem",
    },
    end: {
      dateTime: `${appointmentDate}T${endTimeString}:00`,
      timeZone: "Asia/Jerusalem",
    },
  };

  const googleResponse = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
  });

  return googleResponse.data.id;
}

// פונקציה למחיקת אירוע מהיומן
// פונקציה למחיקת אירוע מהיומן של גוגל לפי מזהה
const deleteEventFromCalendar = async (eventId) => {
  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId: eventId,
    });
    console.log(`✅ אירוע ${eventId} נמחק בהצלחה מגוגל יומן`);
  } catch (error) {
    console.error("❌ שגיאה במחיקת אירוע מגוגל יומן:", error.message);
    throw error;
  }
};

module.exports = {
  addEventToCalendar,
  deleteEventFromCalendar,
};

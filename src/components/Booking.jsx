import { useState, useEffect } from "react";
import { createAppointment } from "../services/api"; // הסרנו את הייבוא הכפול של fetchAvailableSlots
// [TZ fix] Israel-time helpers - dates behave the same on every device
import {
  getIsraelDateStr,
  getDayOfWeek,
  israelLocalToUtc,
} from "../utils/israelTime";
// [Validation fix] Single treatment list, shared with the server's validation
import treatments from "../../shared/treatments.json";

const API_BASE_URL = "https://yarin-appointments-api.onrender.com";

function Booking() {
  const [bookedDetails, setBookedDetails] = useState(null);
  const [date, setDate] = useState("");
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedTime, setSelectedTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // משתנה לבחירת הטיפול
  const [selectedService, setSelectedService] = useState(null);

  // רשימת הטיפולים והמחירים - [Validation fix] now in shared/treatments.json

  // [Buffer fix] Today in Israel (YYYY-MM-DD), not UTC - fixes the picker allowing yesterday after midnight
  // [TZ fix] Shared Israel-time helper
  const minDate = getIsraelDateStr();
  // [Abuse protection] Mirrors the server's 60-day booking window (the server is the authority)
  // [TZ fix] Counted in Israel days, not UTC
  const maxDate = getIsraelDateStr(60);

  const fetchAvailableSlots = async (selectedDate) => {
    // [TZ fix] Correct weekday in any time zone (getDay() shifted Sunday to Saturday west of Israel)
    const dayOfWeek = getDayOfWeek(selectedDate);

    if (dayOfWeek === 5 || dayOfWeek === 6) {
      setMessage("הסטודיו סגור בימים שישי ושבת. נשמח לראותך בשאר ימי השבוע!");
      setAvailableSlots([]);
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/available-slots?date=${selectedDate}`,
      );
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "שגיאה בשליפת השעות הפנויות");
        setAvailableSlots([]);
        return;
      }

      setMessage("");
      // [Buffer fix] The server already applies the 2-hour buffer in Israel time - show its list as is
      setAvailableSlots(data);
    } catch (error) {
      console.error("❌ Failed to fetch available slots:", error.message);
      setMessage("שגיאה בהתחברות לשרת, נסה/י שוב מאוחר יותר");
      setAvailableSlots([]);
    }
  };

  useEffect(() => {
    if (!date) {
      setAvailableSlots([]);
      return;
    }
    fetchAvailableSlots(date);
    setSelectedTime("");
  }, [date]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!date || !selectedTime || !name || !phone) {
      setMessage("נא למלא את כל השדות ולבחור שעה");
      return;
    }

    const cleanPhone = phone.replace(/[- ]/g, "");
    const phoneRegex = /^0\d{8,9}$/;
    if (!phoneRegex.test(cleanPhone)) {
      setMessage("מספר הטלפון אינו תקין. נא להזין מספר ישראלי חוקי.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      // כאן ניתן להעביר לשרת גם את selectedService.name כדי לשמור את סוג הטיפול במסד הנתונים בעתיד
      await createAppointment({
        client_name: name,
        client_phone: phone,
        appointment_date: date,
        appointment_time: selectedTime,
        treatment_type: selectedService.name,
      });

      setBookedDetails({ date: date, time: selectedTime, name: name });
      setMessage("התור נקבע בהצלחה! ✅");

      setDate("");
      setSelectedTime("");
      setName("");
      setPhone("");
      setAvailableSlots([]);
      // לאפס גם את הטיפול כדי להתכונן לתור הבא אם תרצה:
      // setSelectedService(null);
    } catch (error) {
      setMessage(
        error.data?.error || error.message || "שגיאה בקביעת התור, נסה/י שוב",
      );

      if (error.status === 409) {
        setSelectedTime("");
        try {
          const slots = await fetchAvailableSlots(date);
          if (slots) setAvailableSlots(slots);
        } catch (fetchError) {
          console.error("שגיאה ברענון השעות הפנויות:", fetchError);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getGoogleCalendarUrl = (date, time) => {
    if (!date || !time) return "#";

    const [hour, minute] = time.split(":");
    const endHour = String(Number(hour) + 1).padStart(2, "0");
    const formattedDate = date.replace(/-/g, "");

    const startTime = `${formattedDate}T${hour}${minute}00`;
    const endTime = `${formattedDate}T${endHour}${minute}00`;

    const title = encodeURIComponent(
      `תור ל${selectedService?.name || "עיצוב גבות"} - ניני`,
    );
    const details = encodeURIComponent("מחכה לך! 🤍");

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTime}/${endTime}&ctz=Asia/Jerusalem&details=${details}`;
  };

  const downloadAppleCalendarIcs = (date, time) => {
    if (!date || !time) return;

    // [TZ fix] Exact UTC instants ("20261110T080000Z") instead of an empty, invalid VTIMEZONE
    const toIcsUtc = (d) =>
      d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const start = israelLocalToUtc(date, time);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `DTSTART:${toIcsUtc(start)}`,
      `DTEND:${toIcsUtc(end)}`,
      `SUMMARY:תור ל${selectedService?.name || "עיצוב גבות"} - ניני`,
      "DESCRIPTION:מחכה לך! 🤍",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    const blob = new Blob([icsContent], {
      type: "text/calendar;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute("download", "nini-appointment.ics");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ה-return היחיד והנכון של הקומפוננטה
  return (
    <section id="booking" className="booking-section">
      <div className="booking-card">
        <h2>קביעת תור</h2>

        {!selectedService ? (
          <div className="treatments-step">
            <h3
              style={{
                textAlign: "center",
                marginBottom: "20px",
                color: "#555",
              }}
            >
              בחרי את סוג הטיפול:
            </h3>
            <div className="treatments-list">
              {treatments.map((treatment) => (
                <button
                  key={treatment.id}
                  type="button"
                  className="treatment-card"
                  onClick={() => setSelectedService(treatment)}
                >
                  <span className="treatment-name">{treatment.name}</span>
                  <span className="treatment-price">₪{treatment.price}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="date-time-step">
            <button
              type="button"
              className="back-button"
              onClick={() => setSelectedService(null)}
            >
              &rarr; חזרה לבחירת טיפול
            </button>

            <h3 className="selected-treatment-title">
              טיפול נבחר: {selectedService.name} (₪{selectedService.price})
            </h3>

            <form onSubmit={handleSubmit} className="booking-form">
              <div className="form-field">
                <label htmlFor="booking-date">בחרי תאריך</label>
                <input
                  id="booking-date"
                  type="date"
                  value={date}
                  min={minDate}
                  // [Abuse protection] Limit the date picker to the booking window
                  max={maxDate}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </div>

              {date && (
                <div className="form-field">
                  <label>בחרי שעה</label>
                  <div className="time-slots">
                    {availableSlots.length > 0 ? (
                      availableSlots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          className={`time-slot-button ${
                            selectedTime === slot ? "selected" : ""
                          }`}
                          onClick={() => setSelectedTime(slot)}
                        >
                          {slot}
                        </button>
                      ))
                    ) : (
                      <p className="no-slots-message">
                        אין שעות פנויות בתאריך זה
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="form-field">
                <label htmlFor="booking-name">שם מלא</label>
                <input
                  id="booking-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="שם מלא"
                  // [Abuse protection] Matches the server's 100-character name limit
                  maxLength={100}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="booking-phone">טלפון</label>
                <input
                  id="booking-phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="050-0000000"
                  required
                />
              </div>

              <button type="submit" className="submit-btn" disabled={isLoading}>
                {isLoading ? "שולח..." : "קביעת תור"}
              </button>

              {message === "התור נקבע בהצלחה! ✅" && bookedDetails ? (
                <div className="success-message-container">
                  <h3 className="success-text">{message}</h3>
                  <p>הוסיפו את התור ליומן שלכם:</p>

                  <div className="calendar-buttons">
                    <a
                      href={getGoogleCalendarUrl(
                        bookedDetails.date,
                        bookedDetails.time,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cal-btn google-cal"
                    >
                      Google קלנדר
                    </a>

                    <button
                      type="button"
                      onClick={() =>
                        downloadAppleCalendarIcs(
                          bookedDetails.date,
                          bookedDetails.time,
                        )
                      }
                      className="cal-btn apple-cal"
                    >
                      Apple קלנדר
                    </button>
                  </div>
                </div>
              ) : (
                message && (
                  <p className="booking-message error-message">{message}</p>
                )
              )}
            </form>
          </div>
        )}
      </div>
    </section>
  );
}

export default Booking;

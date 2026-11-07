import { useState, useEffect } from "react";
import { createAppointment, fetchTreatments } from "../services/api"; // הסרנו את הייבוא הכפול של fetchAvailableSlots
// [TZ fix] Israel-time helpers - dates behave the same on every device
import {
  getIsraelDateStr,
  getDayOfWeek,
  israelLocalToUtc,
} from "../utils/israelTime";
// [Rules fix] Business rules shared with the server (hours, closed days, window, phone, treatments)
import rules from "../../shared/businessRules.json";
// [ICS fix] Standards-compliant calendar file builder
import { buildIcs, formatIcsUtc } from "../utils/ics";

// [Rules fix] One source for an appointment's exact start/end (used by both calendar buttons)
const getAppointmentTimes = (date, time) => {
  const start = israelLocalToUtc(date, time);
  const end = new Date(
    start.getTime() + rules.appointmentDurationMinutes * 60 * 1000,
  );
  return { start, end };
};

const PHONE_REGEX = new RegExp(rules.phonePattern); // [Rules fix]

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

  // רשימת הטיפולים והמחירים
  // [Rules fix] Shown instantly from the bundled rules, then replaced by the API's list (the source
  // of truth). If the API is unreachable, the bundled list stays.
  const [treatments, setTreatments] = useState(rules.treatments);
  useEffect(() => {
    fetchTreatments()
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) setTreatments(list);
      })
      .catch(() => {});
  }, []);

  // [Buffer fix] Today in Israel (YYYY-MM-DD), not UTC - fixes the picker allowing yesterday after midnight
  // [TZ fix] Shared Israel-time helper
  const minDate = getIsraelDateStr();
  // [Abuse protection] Mirrors the server's booking window (the server is the authority)
  // [TZ fix] Counted in Israel days, not UTC
  const maxDate = getIsraelDateStr(rules.maxDaysAhead); // [Rules fix]

  const fetchAvailableSlots = async (selectedDate) => {
    // [TZ fix] Correct weekday in any time zone (getDay() shifted Sunday to Saturday west of Israel)
    // [Rules fix] Closed days come from the shared rules
    if (rules.closedDays.includes(getDayOfWeek(selectedDate))) {
      setMessage(
        `הסטודיו סגור בימים ${rules.closedDaysLabel}. נשמח לראותך בשאר ימי השבוע!`,
      );
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

    // [Rules fix] Same phone rule and normalisation as the server
    const cleanPhone = phone.trim().replace(/[- ]/g, "");
    if (!PHONE_REGEX.test(cleanPhone)) {
      setMessage("מספר הטלפון אינו תקין. נא להזין מספר ישראלי חוקי.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      // כאן ניתן להעביר לשרת גם את selectedService.name כדי לשמור את סוג הטיפול במסד הנתונים בעתיד
      // [ICS fix] Keep the response - its appointment ID makes the calendar file's UID stable
      const result = await createAppointment({
        client_name: name,
        client_phone: phone,
        appointment_date: date,
        appointment_time: selectedTime,
        treatment_type: selectedService.name,
      });

      setBookedDetails({
        date: date,
        time: selectedTime,
        name: name,
        id: result?.appointment?.id, // [ICS fix]
      });
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

    // [Rules fix] Same exact start/end as the .ics file, in UTC form ("20261110T080000Z")
    const { start, end } = getAppointmentTimes(date, time);
    const startTime = formatIcsUtc(start);
    const endTime = formatIcsUtc(end);

    const title = encodeURIComponent(
      `תור ל${selectedService?.name || "עיצוב גבות"} - ניני`,
    );
    const details = encodeURIComponent("מחכה לך! 🤍");

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTime}/${endTime}&ctz=${rules.timezone}&details=${details}`;
  };

  const downloadAppleCalendarIcs = (date, time) => {
    if (!date || !time) return;

    // [TZ fix] Exact UTC instants ("20261110T080000Z") instead of an empty, invalid VTIMEZONE
    // [Rules fix] Shared start/end helper (appointment length from the rules)
    const { start, end } = getAppointmentTimes(date, time);

    // [ICS fix] RFC 5545-compliant file (PRODID, UID, DTSTAMP, CRLF, folding, escaping)
    const icsContent = buildIcs({
      // Stable per appointment; random fallback if the response had no ID
      uid: `appointment-${
        bookedDetails?.id ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }@nini-eyebrows`,
      start,
      end,
      summary: `תור ל${selectedService?.name || "עיצוב גבות"} - ניני`,
      description: "מחכה לך! 🤍",
    });

    const blob = new Blob([icsContent], {
      type: "text/calendar;charset=utf-8",
    });
    const link = document.createElement("a");
    const url = window.URL.createObjectURL(blob); // [ICS fix]
    link.href = url;
    link.setAttribute("download", "nini-appointment.ics");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // [ICS fix] Release the blob once the download has started (revoking immediately breaks it in some browsers)
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
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
                  maxLength={rules.maxNameLength}
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

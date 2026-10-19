import { useState, useEffect } from "react";
import { createAppointment, fetchAvailableSlots } from "../services/api";

// Setting the base URL for the API. This should match the backend server's address and port.
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

  const minDate = new Date().toISOString().split("T")[0];

  const fetchAvailableSlots = async (selectedDate) => {
    // --- התחלת התוספת לסינון ימי שישי ושבת ---
    const dateObj = new Date(selectedDate);
    const dayOfWeek = dateObj.getDay(); // 0 = ראשון, 5 = שישי, 6 = שבת

    if (dayOfWeek === 5 || dayOfWeek === 6) {
      setMessage("הסטודיו סגור בימים שישי ושבת. נשמח לראותך בשאר ימי השבוע!");
      setAvailableSlots([]); // מרוקן את השעות אם הוצגו קודם
      return; // עוצר את הפונקציה ולא פונה לשרת כלל
    }
    // --- סוף התוספת ---

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

      let validSlots = data;

      // סינון שעות עבר אם נבחר היום הנוכחי (הקוד שהוספנו קודם)
      if (selectedDate === minDate) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        validSlots = data.filter((slot) => {
          const [slotHour, slotMinute] = slot.split(":").map(Number);
          return (
            slotHour > currentHour ||
            (slotHour === currentHour && slotMinute > currentMinute)
          );
        });
      }

      // ניקוי הודעות קודמות והצגת השעות
      setMessage("");
      setAvailableSlots(validSlots);
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
      // יצירת התור במסד הנתונים
      await createAppointment({
        client_name: name,
        client_phone: phone,
        appointment_date: date,
        appointment_time: selectedTime,
      });

      // שומרים את פרטי התור לפני שמאפסים את הטופס כדי שנוכל לייצר יומנים
      setBookedDetails({ date: date, time: selectedTime, name: name });

      setMessage("התור נקבע בהצלחה! ✅");

      // איפוס הטופס
      setDate("");
      setSelectedTime("");
      setName("");
      setPhone("");
      setAvailableSlots([]);
    } catch (error) {
      setMessage(
        error.data?.error || error.message || "שגיאה בקביעת התור, נסה/י שוב",
      );

      if (error.status === 409) {
        setSelectedTime("");
        try {
          const slots = await fetchAvailableSlots(date);
          setAvailableSlots(slots);
        } catch (fetchError) {
          console.error("שגיאה ברענון השעות הפנויות:", fetchError);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  // creating a function to generate Google Calendar URL for the appointment
  const getGoogleCalendarUrl = (date, time) => {
    if (!date || !time) return "#";
    const startTime = new Date(`${date}T${time}`)
      .toISOString()
      .replace(/-|:|\.\d\d\d/g, "");
    const endTime = new Date(
      new Date(`${date}T${time}`).getTime() + 60 * 60 * 1000,
    )
      .toISOString()
      .replace(/-|:|\.\d\d\d/g, "");

    const title = encodeURIComponent("תור לעיצוב גבות - ניני");
    const details = encodeURIComponent("מחכה לך לעיצוב גבות! 🤍");

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTime}/${endTime}&details=${details}`;
  };

  // creating a function to generate and download an .ics file for Apple Calendar
  const downloadAppleCalendarIcs = (date, time) => {
    if (!date || !time) return;
    const startTime = new Date(`${date}T${time}`)
      .toISOString()
      .replace(/-|:|\.\d\d\d/g, "");
    const endTime = new Date(
      new Date(`${date}T${time}`).getTime() + 60 * 60 * 1000,
    )
      .toISOString()
      .replace(/-|:|\.\d\d\d/g, "");

    // Creating the content of the .ics file
    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `DTSTART:${startTime}`,
      `DTEND:${endTime}`,
      "SUMMARY:תור לעיצוב גבות - ניני",
      "DESCRIPTION:מחכה לך לעיצוב גבות! 🤍",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");

    // Creating a Blob from the .ics content and triggering a download
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

  return (
    <section id="booking" className="booking-section">
      <div className="booking-card">
        <h2>קביעת תור</h2>

        <form onSubmit={handleSubmit} className="booking-form">
          <div className="form-field">
            <label htmlFor="booking-date">בחרי תאריך</label>
            <input
              id="booking-date"
              type="date"
              value={date}
              min={minDate}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>

          {/* רשימת השעות הפנויות */}
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
                  <p className="no-slots-message">אין שעות פנויות בתאריך זה</p>
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

          {/* הודעת סטטוס והצגת כפתורי היומנים במקרה של הצלחה */}
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
    </section>
  );
}

export default Booking;

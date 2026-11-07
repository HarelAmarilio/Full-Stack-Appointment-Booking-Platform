import React, { useState, useEffect } from "react";
import {
  loginAdmin,
  fetchAllAppointments,
  deleteAppointment,
} from "./services/api";
import "./AdminDashboard.css";
// [TZ fix] Israel-time helpers - the dashboard is correct even when the owner is abroad
import { getIsraelDateStr, getIsraelNowStr } from "./utils/israelTime";

const AdminDashboard = () => {
  const [token, setToken] = useState(localStorage.getItem("adminToken"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // State for filtering appointments
  const [activeTab, setActiveTab] = useState("active");
  const [selectedMonth, setSelectedMonth] = useState(
    getIsraelDateStr().slice(0, 7), // פורמט: "YYYY-MM" (למשל "2026-09") // [TZ fix] current month in Israel
  );

  useEffect(() => {
    if (token) loadAppointments(token);
  }, [token]);

  const loadAppointments = async (validToken) => {
    try {
      const data = await fetchAllAppointments(validToken);
      setAppointments(data);
    } catch (err) {
      setError("פג תוקף ההתחברות. אנא התחבר/י מחדש.");
      handleLogout();
    }
  };

  const handleLogin = async (e) => {
    // Prevent the default form submission behavior
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const data = await loginAdmin({ username, password });
      localStorage.setItem("adminToken", data.token);
      setToken(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    setToken(null);
    setAppointments([]);
  };

  const handleDelete = async (id) => {
    const confirmed = window.confirm("האם לבטל את התור הזה?");
    if (!confirmed) return;
    try {
      // [Security fix] Send the admin token - cancelling now requires authentication
      await deleteAppointment(id, token);
      // Update the local state to reflect the deletion without refetching
      setAppointments(
        appointments.map((app) =>
          app.id === id ? { ...app, status: "cancelled" } : app,
        ),
      );
      alert("התור בוטל בהצלחה!");
    } catch (err) {
      // [Security fix] Expired/invalid token - return the admin to the login screen
      if (err.status === 401) {
        setError("פג תוקף ההתחברות. אנא התחבר/י מחדש.");
        handleLogout();
        return;
      }
      alert("שגיאה בביטול התור");
    }
  };

  // Filtering appointments based on the selected tab and month
  const filteredAppointments = appointments.filter((app) => {
    const isStatusMatch =
      activeTab === "active"
        ? app.status !== "cancelled"
        : app.status === "cancelled";

    const appMonth = new Date(app.appointment_date).toISOString().slice(0, 7);
    const isMonthMatch = appMonth === selectedMonth;

    return isStatusMatch && isMonthMatch;
  });

  // [TZ fix] "Now" in Israel, computed once per render
  const israelNow = getIsraelNowStr();

  if (!token) {
    return (
      <div className="admin-login-container">
        <h2>כניסת מנהלת 🔒</h2>
        <form onSubmit={handleLogin} className="booking-form">
          <input
            type="text"
            placeholder="שם משתמש"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="סיסמה"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="error-message">{error}</p>}
          <button type="submit" className="submit-btn" disabled={isLoading}>
            {isLoading ? "מתחבר..." : "התחברות"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <h2>ניהול תורים 📋</h2>
        <button onClick={handleLogout} className="logout-btn">
          התנתק
        </button>
      </div>

      {/* אזור כלי הסינון (פילטרים ולשוניות) */}
      <div className="dashboard-controls">
        <div className="tabs">
          <button
            className={`tab-btn ${activeTab === "active" ? "active" : ""}`}
            onClick={() => setActiveTab("active")}
          >
            תורים פעילים
          </button>
          <button
            className={`tab-btn ${activeTab === "cancelled" ? "active" : ""}`}
            onClick={() => setActiveTab("cancelled")}
          >
            היסטוריית ביטולים
          </button>
        </div>

        <div className="month-filter">
          <label>סינון לפי חודש: </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
        </div>
      </div>

      <div className="table-container">
        <table className="appointments-table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>שעה</th>
              <th>שם לקוחה</th>
              <th>טלפון</th>
              <th>סטטוס</th>
              {activeTab === "active" && <th>פעולות</th>}{" "}
              {/* כפתור מחיקה רק בתורים פעילים */}
            </tr>
          </thead>
          <tbody>
            {filteredAppointments.map((app) => {
              // is the appointment in the past? (for display purposes)
              // [TZ fix] Both sides are Israel wall-clock "YYYY-MM-DD HH:MM" strings
              const isPast =
                `${app.appointment_date.split("T")[0]} ${app.appointment_time.slice(0, 5)}` <
                israelNow;

              // Determine the display status and badge class based on the appointment's status and whether it's in the past
              let displayStatus = "פעיל";
              let badgeClass = "pending";

              if (app.status === "cancelled") {
                displayStatus = "בוטל";
                badgeClass = "cancelled";
              } else if (isPast) {
                displayStatus = "הושלם";
                badgeClass = "completed";
              }

              return (
                <tr key={app.id}>
                  <td>
                    {/* [TZ fix] The value is a calendar date at UTC midnight - format it in UTC */}
                    {new Date(app.appointment_date).toLocaleDateString(
                      "he-IL",
                      { timeZone: "UTC" },
                    )}
                  </td>
                  <td>{app.appointment_time.slice(0, 5)}</td>
                  <td>{app.client_name}</td>
                  <td>{app.client_phone}</td>
                  <td>
                    <span className={`status-badge ${badgeClass}`}>
                      {displayStatus}
                    </span>
                  </td>
                  {activeTab === "active" && (
                    <td>
                      {/* נציג כפתור ביטול רק אם התור עדיין לא עבר */}
                      {!isPast && (
                        <button
                          onClick={() => handleDelete(app.id)}
                          className="delete-btn-small"
                        >
                          ביטול
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredAppointments.length === 0 && (
          <p className="no-data-msg">אין תורים להצגה בחודש זה.</p>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;

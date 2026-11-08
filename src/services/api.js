// src/services/api.js
// [Cold start fix] Single place for the server address (was duplicated in Booking.jsx)
const API_ORIGIN = "https://yarin-appointments-api.onrender.com";
const API_BASE_URL = `${API_ORIGIN}/api`;

// [Cold start fix] The free server can take up to ~1 minute to wake up
const WAKE_UP_BUDGET_MS = 90_000; // total time we keep trying before giving up
const RETRY_DELAY_MS = 3_000;
const RETRYABLE_STATUSES = [502, 503, 504]; // what the hosting proxy returns while the server boots

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// [Cold start fix] Fire-and-forget call that starts waking the server as soon as someone opens the
// site, so it is usually awake by the time they reach the booking form. Runs once per page load.
let wakeUpCall = null;
export const wakeServer = () => {
  wakeUpCall ??= fetch(`${API_ORIGIN}/health`, { cache: "no-store" }).catch(
    () => {},
  );
  return wakeUpCall;
};

// [Cold start fix] GET that keeps retrying while the server wakes up (GET only - safe to repeat)
const getWithWakeUp = async (url) => {
  const deadline = Date.now() + WAKE_UP_BUDGET_MS;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline - Date.now());
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!RETRYABLE_STATUSES.includes(response.status)) return response;
    } catch {
      // network error or timeout - the server is probably still waking up, try again
    } finally {
      clearTimeout(timer);
    }
    await sleep(RETRY_DELAY_MS);
  }
  throw new Error("לא הצלחנו להתחבר למערכת כרגע. נסי שוב בעוד רגע.");
};

// 1. Fetching available slots for a given date
export const fetchAvailableSlots = async (date) => {
  const response = await getWithWakeUp(
    `${API_BASE_URL}/available-slots?date=${encodeURIComponent(date)}`,
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // validation / rate-limit messages from the server are shown as they are
    throw new Error(data?.error || "שגיאה בשליפת השעות הפנויות");
  }
  return Array.isArray(data) ? data : [];
};

// [Rules fix] Fetching the treatment catalogue (source of truth: shared/businessRules.json on the server)
export const fetchTreatments = async () => {
  const response = await fetch(`${API_BASE_URL}/treatments`);
  if (!response.ok) throw new Error("שגיאה בשליפת רשימת הטיפולים");
  return response.json();
};

// 2. Creating a new appointment
export const createAppointment = async (appointmentData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appointmentData),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || "שגיאה בקביעת התור");
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    console.error("❌ API Error (createAppointment):", error.message);
    throw error;
  }
};

// Deleting an appointment by ID
// [Security fix] Now calls the admin-only endpoint and sends the admin JWT token
export const deleteAppointment = async (appointmentId, token) => {
  try {
    const response = await fetch(
      `${API_BASE_URL}/admin/appointments/${appointmentId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || "שגיאה בביטול התור");
      // [Security fix] Expose the HTTP status so the dashboard can detect an expired session (401)
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    console.error("❌ API Error (deleteAppointment):", error.message);
    throw error;
  }
};

// 4. Admin login
export const loginAdmin = async (credentials) => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "שגיאה בהתחברות");
    return data;
  } catch (error) {
    console.error("❌ API Error (loginAdmin):", error.message);
    throw error;
  }
};

// 5. Fetching all appointments for the admin user
export const fetchAllAppointments = async (token) => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/appointments`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "שגיאה בשליפת התורים");
    return data;
  } catch (error) {
    console.error("❌ API Error (fetchAllAppointments):", error.message);
    throw error;
  }
};

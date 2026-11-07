// src/services/api.js
const API_BASE_URL = "https://yarin-appointments-api.onrender.com/api";

// 1. fething available slots for a given date
export const fetchAvailableSlots = async (date) => {
  try {
    const response = await fetch(
      `${API_BASE_URL}/available-slots?date=${date}`,
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "שגיאה בשליפת השעות הפנויות");
    }

    return data;
  } catch (error) {
    console.error("❌ API Error (fetchAvailableSlots):", error.message);
    throw error;
  }
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

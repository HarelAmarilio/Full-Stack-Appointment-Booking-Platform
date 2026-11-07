// [Rules fix] Single home for the studio's business rules. Values come from shared/businessRules.json
// (the booking page reads the same file). Pure functions - "now" can be injected for tests.
const RULES = require("../shared/businessRules.json");

const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_REGEX = new RegExp(RULES.phonePattern);

const toMinutes = (hhmm) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
};
const fromMinutes = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

// Working-hours grid: firstSlot..lastSlot, one slot per appointment length (09:00 ... 19:00 today)
const TIME_SLOTS = [];
for (
  let t = toMinutes(RULES.workingHours.firstSlot);
  t <= toMinutes(RULES.workingHours.lastSlot);
  t += RULES.appointmentDurationMinutes
) {
  TIME_SLOTS.push(fromMinutes(t));
}

const TREATMENTS = RULES.treatments;
const TREATMENT_NAMES = TREATMENTS.map((t) => t.name);

// "YYYY-MM-DD" that is also a real calendar day (rejects 2026-02-31, 2026-13-45)
const isValidDateStr = (value) => {
  if (typeof value !== "string" || !DATE_FORMAT_REGEX.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === value;
};

// Day of week (0 = Sunday) of a calendar date, independent of the server's time zone
const getDayOfWeek = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

const isClosedDay = (dateStr) => RULES.closedDays.includes(getDayOfWeek(dateStr));

// "050-123 4567" -> "0501234567" (the form stored in the DB)
const normalizePhone = (phone) => phone.trim().replace(/[- ]/g, "");

const isValidPhone = (phone) => PHONE_REGEX.test(normalizePhone(phone));

// Current date and minutes-since-midnight in Israel, independent of the server's time zone
const getIsraelNow = (date = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: RULES.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

// Last bookable date (YYYY-MM-DD), counted from today in Israel
const getMaxBookingDateStr = (now = getIsraelNow()) => {
  const [y, m, d] = now.dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + RULES.maxDaysAhead))
    .toISOString()
    .slice(0, 10);
};

// Same-day buffer: a slot must start at least bookingBufferMinutes from now
const isSlotBookable = (date, slot, now = getIsraelNow()) => {
  if (date < now.dateStr) return false;
  if (date > now.dateStr) return true;
  return toMinutes(slot) - now.minutes >= RULES.bookingBufferMinutes;
};

// "10:00" -> "11:00" (start + appointment length, Israel wall-clock time)
const getEndTime = (time) =>
  fromMinutes(toMinutes(time) + RULES.appointmentDurationMinutes);

// Full booking validation - returns a Hebrew error message, or null when the booking is valid
const validateBooking = (
  { name, phone, date, time, treatment },
  now = getIsraelNow(),
) => {
  // JSON can carry numbers/objects/arrays - anything but a string is a 400, not a crash
  if ([name, phone, date, time].some((value) => typeof value !== "string")) {
    return "נתונים לא תקינים.";
  }
  if (!name || name.trim().length < 2) {
    return "נא להזין שם מלא תקין (לפחות 2 תווים).";
  }
  if (name.trim().length > RULES.maxNameLength) {
    return `השם ארוך מדי (עד ${RULES.maxNameLength} תווים).`;
  }
  if (!isValidDateStr(date)) {
    return "תאריך לא תקין.";
  }
  if (date > getMaxBookingDateStr(now)) {
    return `ניתן לקבוע תור עד ${RULES.maxDaysAhead} יום מראש.`;
  }
  if (!isValidPhone(phone)) {
    return "מספר הטלפון שהוזן אינו תקין.";
  }
  if (!TIME_SLOTS.includes(time)) {
    return "השעה שנבחרה אינה נמצאת בשעות הפעילות המותרות.";
  }
  if (date < now.dateStr) {
    return "לא ניתן לקבוע תור לתאריך עבר.";
  }
  if (isClosedDay(date)) {
    return `לא ניתן לקבוע תורים בימי ${RULES.closedDaysLabel}.`;
  }
  if (!isSlotBookable(date, time, now)) {
    return "יש לקבוע תור לפחות שעתיים מראש.";
  }
  // Treatment is optional, but if sent it must be one the studio offers
  if (treatment != null && !TREATMENT_NAMES.includes(treatment)) {
    return "סוג הטיפול שנבחר אינו קיים. נא לבחור טיפול מהרשימה.";
  }
  return null;
};

module.exports = {
  RULES,
  TIME_SLOTS,
  TREATMENTS,
  isValidDateStr,
  getDayOfWeek,
  isClosedDay,
  normalizePhone,
  isValidPhone,
  getIsraelNow,
  getMaxBookingDateStr,
  isSlotBookable,
  getEndTime,
  validateBooking,
};

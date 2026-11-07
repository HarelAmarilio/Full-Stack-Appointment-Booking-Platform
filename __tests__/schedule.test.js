// [Rules fix] Unit tests for the pure business rules - no database or server needed
const {
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
} = require("../domain/schedule");

// Israel time 2026-11-10 (a Tuesday, winter = UTC+2) at hh:mm
const israelAt = (hour, minute) =>
  getIsraelNow(new Date(Date.UTC(2026, 10, 10, hour - 2, minute)));

const validBooking = {
  name: "Dana",
  phone: "050-123-4567",
  date: "2026-11-11",
  time: "17:00",
  treatment: "עיצוב גבות + צבע",
};

describe("schedule rules", () => {
  it("builds the working-hours grid 09:00-19:00", () => {
    expect(TIME_SLOTS).toEqual([
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
      "15:00", "16:00", "17:00", "18:00", "19:00",
    ]);
  });

  it("exposes the 5 treatments with prices", () => {
    expect(TREATMENTS).toHaveLength(5);
    expect(TREATMENTS.every((t) => t.name && t.price > 0)).toBe(true);
  });

  it("accepts only real calendar dates", () => {
    expect(isValidDateStr("2028-02-29")).toBe(true);
    expect(isValidDateStr("2027-02-29")).toBe(false);
    expect(isValidDateStr("2026-11-31")).toBe(false);
    expect(isValidDateStr("2026-13-01")).toBe(false);
    expect(isValidDateStr("abc")).toBe(false);
    expect(isValidDateStr(20261110)).toBe(false);
  });

  it("closes on Friday and Saturday", () => {
    expect(getDayOfWeek("2026-11-15")).toBe(0); // Sunday
    expect(isClosedDay("2026-11-13")).toBe(true); // Friday
    expect(isClosedDay("2026-11-14")).toBe(true); // Saturday
    expect(isClosedDay("2026-11-15")).toBe(false);
  });

  it("validates and normalises Israeli phone numbers", () => {
    expect(normalizePhone(" 050-123 4567 ")).toBe("0501234567");
    expect(isValidPhone("050-123-4567")).toBe(true);
    expect(isValidPhone("031234567")).toBe(true);
    expect(isValidPhone("1234567890")).toBe(false);
    expect(isValidPhone("050123456789")).toBe(false);
  });

  it("applies the 2-hour same-day buffer", () => {
    expect(isSlotBookable("2026-11-10", "16:00", israelAt(13, 59))).toBe(true);
    expect(isSlotBookable("2026-11-10", "16:00", israelAt(14, 0))).toBe(true);
    expect(isSlotBookable("2026-11-10", "16:00", israelAt(14, 1))).toBe(false);
    expect(isSlotBookable("2026-11-10", "17:00", israelAt(14, 15))).toBe(true);
    expect(isSlotBookable("2026-11-09", "19:00", israelAt(8, 0))).toBe(false); // past day
    expect(isSlotBookable("2026-11-11", "09:00", israelAt(23, 0))).toBe(true); // future day
  });

  it("limits bookings to the 60-day window", () => {
    expect(getMaxBookingDateStr(israelAt(10, 0))).toBe("2027-01-09");
  });

  it("computes the end time from the appointment length", () => {
    expect(RULES.appointmentDurationMinutes).toBe(60);
    expect(getEndTime("09:00")).toBe("10:00");
    expect(getEndTime("19:00")).toBe("20:00");
  });

  it("returns the same Hebrew messages as before the refactor", () => {
    const now = israelAt(10, 0);
    const msg = (overrides) => validateBooking({ ...validBooking, ...overrides }, now);
    expect(msg({})).toBeNull();
    expect(msg({ treatment: undefined })).toBeNull();
    expect(msg({ phone: 501234567 })).toBe("נתונים לא תקינים.");
    expect(msg({ name: "D" })).toBe("נא להזין שם מלא תקין (לפחות 2 תווים).");
    expect(msg({ name: "a".repeat(101) })).toBe("השם ארוך מדי (עד 100 תווים).");
    expect(msg({ date: "2026-11-31" })).toBe("תאריך לא תקין.");
    expect(msg({ date: "2027-01-10" })).toBe("ניתן לקבוע תור עד 60 יום מראש.");
    expect(msg({ phone: "123" })).toBe("מספר הטלפון שהוזן אינו תקין.");
    expect(msg({ time: "20:00" })).toBe("השעה שנבחרה אינה נמצאת בשעות הפעילות המותרות.");
    expect(msg({ date: "2026-11-09" })).toBe("לא ניתן לקבוע תור לתאריך עבר.");
    expect(msg({ date: "2026-11-13" })).toBe("לא ניתן לקבוע תורים בימי שישי ושבת.");
    expect(msg({ date: "2026-11-10", time: "11:00" })).toBe("יש לקבוע תור לפחות שעתיים מראש.");
    expect(msg({ treatment: "spam" })).toBe("סוג הטיפול שנבחר אינו קיים. נא לבחור טיפול מהרשימה.");
  });
});

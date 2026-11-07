// [TZ fix] Business dates/times are always Israel wall-clock time, wherever the device is
export const ISRAEL_TZ = "Asia/Jerusalem";

const getIsraelParts = (date = new Date()) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ISRAEL_TZ,
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

// [TZ fix] "YYYY-MM-DD" in Israel, optionally shifted by whole days
export const getIsraelDateStr = (offsetDays = 0) => {
  const p = getIsraelParts();
  return new Date(Date.UTC(+p.year, p.month - 1, +p.day + offsetDays))
    .toISOString()
    .slice(0, 10);
};

// [TZ fix] "YYYY-MM-DD HH:MM" in Israel - comparable as a plain string
export const getIsraelNowStr = () => {
  const p = getIsraelParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

// [TZ fix] Day of week (0 = Sunday) of a calendar date, independent of the device's time zone
export const getDayOfWeek = (dateStr) =>
  new Date(`${dateStr}T00:00:00Z`).getUTCDay();

// [TZ fix] Israel wall-clock date + time -> exact UTC instant (handles summer/winter time)
export const israelLocalToUtc = (dateStr, timeStr) => {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const wallClock = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ts) => {
    const p = getIsraelParts(new Date(ts));
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - ts;
  };
  const firstGuess = wallClock - offsetAt(wallClock);
  return new Date(wallClock - offsetAt(firstGuess)); // second pass settles DST-change days
};

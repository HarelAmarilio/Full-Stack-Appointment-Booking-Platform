// [ICS fix] Minimal RFC 5545 builder: CRLF line endings, 75-octet folding, text escaping, UTC times

// [ICS fix] Date -> "20261110T080000Z" (UTC form, no time-zone definition needed)
export const formatIcsUtc = (date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// [ICS fix] Escape TEXT values (RFC 5545 §3.3.11)
const escapeText = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// [ICS fix] Fold lines longer than 75 octets (RFC 5545 §3.1). Counts UTF-8 bytes - Hebrew letters
// are 2 bytes, emoji 4 - and never splits a character in the middle.
const encoder = new TextEncoder();
const foldLine = (line) => {
  const parts = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
};

// [ICS fix] Builds a complete single-event calendar file
export const buildIcs = ({ uid, start, end, summary, description }) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nini Eyebrows//Booking//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(foldLine)
    .join("\r\n") + "\r\n";

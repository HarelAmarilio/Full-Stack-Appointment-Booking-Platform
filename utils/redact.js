// [PII protection] Masks Israeli phone numbers so logs never contain a full number: 0501234567 -> 050****567
const PHONE_REGEX = /0\d{1,2}[- ]?\d{3}[- ]?\d{3,4}/g;

const maskPhone = (phone) => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length < 6
    ? "***"
    : `${digits.slice(0, 3)}****${digits.slice(-3)}`;
};

// [PII protection] Masks any phone number inside free text (e.g. MySQL error messages)
const redactPhones = (text) =>
  String(text ?? "").replace(PHONE_REGEX, maskPhone);

module.exports = { maskPhone, redactPhones };

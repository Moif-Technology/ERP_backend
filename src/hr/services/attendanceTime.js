// Device times are branch-local wall-clock values, not browser/server timezones.
export function validAttendanceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validAttendanceTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

export function formatAttendanceTime(value) {
  if (!value) return '';
  const match = String(value).match(/^(?:\d{4}-\d{2}-\d{2}[ T])?(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  return match && validAttendanceTime(match[1]) ? match[1] : '';
}

const SCHOOL_TIME_ZONE = process.env.SCHOOL_TIME_ZONE || 'Asia/Almaty';

function parseLessonDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'number') {
    const ms = value > 0 && value < 100000000000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{10,16}$/.test(raw)) return parseLessonDate(Number(raw));
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function lessonDay(value, fallback = null) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = parseLessonDate(value);
  return date ? dateParts(date) : fallback;
}

function lessonTimestamp(row) {
  const parsed = parseLessonDate(row?.date);
  if (parsed) return parsed.getTime();
  const day = lessonDay(row?.lesson_day);
  if (!day) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(row?.start_time || ''))
    ? row.start_time : '12:00';
  const fallback = new Date(`${day}T${time}:00`);
  return Number.isFinite(fallback.getTime()) ? fallback.getTime() : null;
}

module.exports = { SCHOOL_TIME_ZONE, parseLessonDate, lessonDay, lessonTimestamp };

export function getJakartaDateKey(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date supplied to getJakartaDateKey.');
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function getPreviousJakartaDateKey(dateKey: string): string {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateKey)) {
    throw new RangeError('Invalid Jakarta date key. Expected YYYY-MM-DD.');
  }

  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) {
    throw new RangeError('Invalid calendar date supplied to getPreviousJakartaDateKey.');
  }

  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

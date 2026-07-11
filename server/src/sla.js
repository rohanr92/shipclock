const { DateTime } = require('luxon');
const config = require('./config');

// Weekdays: luxon Mon=1 ... Sun=7. Sat(6) and Sun(7) don't count toward the SLA.
function isWeekend(dt) {
  return dt.weekday === 6 || dt.weekday === 7;
}

// Returns ISO deadline: start + `hours` of business time (weekends excluded),
// computed in the configured timezone (default America/New_York).
function addBusinessHours(startISO, hours, zone = config.TZ) {
  let dt = DateTime.fromISO(startISO, { setZone: true }).setZone(zone);
  let remaining = Math.round(hours * 60); // minutes

  while (remaining > 0) {
    if (isWeekend(dt)) {
      // Jump to next Monday 00:00
      const daysToMonday = 8 - dt.weekday; // Sat->2, Sun->1
      dt = dt.plus({ days: daysToMonday }).startOf('day');
      continue;
    }
    const midnight = dt.plus({ days: 1 }).startOf('day');
    const minutesLeftToday = Math.max(1, Math.round(midnight.diff(dt, 'minutes').minutes));
    if (remaining <= minutesLeftToday) {
      dt = dt.plus({ minutes: remaining });
      remaining = 0;
    } else {
      remaining -= minutesLeftToday;
      dt = midnight;
    }
  }
  return dt.toUTC().toISO();
}

// Business minutes elapsed between two instants (weekends excluded).
function businessMinutesBetween(startISO, endISO, zone = config.TZ) {
  let a = DateTime.fromISO(startISO, { setZone: true }).setZone(zone);
  const b = DateTime.fromISO(endISO, { setZone: true }).setZone(zone);
  if (b <= a) return 0;
  let total = 0;
  while (a < b) {
    if (isWeekend(a)) {
      const daysToMonday = 8 - a.weekday;
      a = a.plus({ days: daysToMonday }).startOf('day');
      continue;
    }
    const midnight = a.plus({ days: 1 }).startOf('day');
    const stop = midnight < b ? midnight : b;
    total += stop.diff(a, 'minutes').minutes;
    a = stop;
  }
  return Math.round(total);
}

module.exports = { addBusinessHours, businessMinutesBetween };

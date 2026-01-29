function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}

function formatTime(dt) {
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function computeETA({ deliveryType = 'NOW', scheduledAt = null, total = 0 }) {
  const now = new Date();
  if (deliveryType === 'SCHEDULED' && scheduledAt) {
    const sched = new Date(scheduledAt);
    const etaMin = addMinutes(sched, -5);
    const etaMax = addMinutes(sched, 15);
    return {
      deliveryType: 'SCHEDULED',
      scheduledAt: sched,
      etaMinMinutes: Math.round((etaMin - now) / 60000),
      etaMaxMinutes: Math.round((etaMax - now) / 60000),
      etaText: `Arrives ${formatTime(etaMin)} - ${formatTime(etaMax)}`,
      etaLabel: `Scheduled: ${formatTime(sched)}`
    };
  }

  // Deliver now
  let baseMin = 25;
  let baseMax = 35;
  if (Number(total) >= 30) {
    baseMin -= 5;
    baseMax -= 5;
  }
  const etaStart = addMinutes(now, baseMin);
  const etaEnd = addMinutes(now, baseMax);
  return {
    deliveryType: 'NOW',
    scheduledAt: null,
    etaMinMinutes: baseMin,
    etaMaxMinutes: baseMax,
    etaText: `Arrives ${formatTime(etaStart)} - ${formatTime(etaEnd)}`,
    etaLabel: `ETA ${baseMin}-${baseMax} mins`
  };
}

function validateSchedule(datetime) {
  if (!datetime) return { valid: false, message: 'Scheduled time required.' };
  const sched = new Date(datetime);
  const minTime = addMinutes(new Date(), 45);
  if (isNaN(sched.getTime())) return { valid: false, message: 'Invalid date/time' };
  if (sched < minTime) return { valid: false, message: 'Scheduled time must be at least 45 mins from now.' };
  return { valid: true, scheduledAt: sched };
}

module.exports = { computeETA, validateSchedule };

// Feature engineering exactly as described on the poster:
// 8 raw channels -> 33 features (current value, 3-day mean, 7-day mean,
// 7-day slope per channel, plus the discharge/suction pressure ratio).
// Readings are hourly, so a 3-day window is 72 rows and a 7-day window is 168.

export const CHANNELS = [
  { key: 'suction_temp', label: 'Suction temperature', unit: '°C', min: 3, max: 5, mean: 4, sd: 0.35 },
  { key: 'suction_pressure', label: 'Suction pressure', unit: 'kPa', min: 300, max: 340, mean: 320, sd: 7 },
  { key: 'discharge_temp', label: 'Discharge temperature', unit: '°C', min: 70, max: 86, mean: 78, sd: 2.6 },
  { key: 'discharge_pressure', label: 'Discharge pressure', unit: 'kPa', min: 1350, max: 1550, mean: 1450, sd: 32 },
  { key: 'oil_pressure_delta', label: 'Oil pressure differential', unit: 'kPa', min: 120, max: 160, mean: 140, sd: 7 },
  { key: 'vibration_rms', label: 'Vibration RMS', unit: 'mm/s', min: 1.8, max: 2.6, mean: 2.2, sd: 0.13 },
  { key: 'motor_current', label: 'Motor current', unit: 'A', min: 17, max: 20, mean: 18.5, sd: 0.5 },
  { key: 'superheat', label: 'Superheat', unit: 'K', min: 6, max: 10, mean: 8, sd: 0.65 },
];

export const FEATURE_NAMES = [
  ...CHANNELS.map((c) => c.key),
  ...CHANNELS.flatMap((c) => [`${c.key}_roll3_mean`, `${c.key}_roll7_mean`, `${c.key}_roll7_slope`]),
  'pressure_ratio',
];

const H3 = 72;
const H7 = 168;
const NOW = 6; // "current" value = 6-hour mean, which suppresses single-sample noise

function mean(arr, key, n) {
  const start = Math.max(0, arr.length - n);
  let s = 0;
  for (let i = start; i < arr.length; i++) s += arr[i][key];
  return s / (arr.length - start);
}

// Least-squares slope in units per day.
function slope(arr, key, n) {
  const start = Math.max(0, arr.length - n);
  const m = arr.length - start;
  if (m < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < m; i++) {
    const x = i / 24;
    const y = arr[start + i][key];
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = m * sxx - sx * sx;
  return den === 0 ? 0 : (m * sxy - sx * sy) / den;
}

/**
 * @param {Array<Object>} readings hourly readings, oldest first
 * @returns {Float64Array} feature vector ordered as FEATURE_NAMES
 */
export function computeFeatures(readings) {
  const out = new Float64Array(FEATURE_NAMES.length);
  let k = 0;
  for (const c of CHANNELS) out[k++] = mean(readings, c.key, NOW);
  for (const c of CHANNELS) {
    out[k++] = mean(readings, c.key, H3);
    out[k++] = mean(readings, c.key, H7);
    out[k++] = slope(readings, c.key, H7);
  }
  out[k] = mean(readings, 'discharge_pressure', NOW) / mean(readings, 'suction_pressure', NOW);
  return out;
}

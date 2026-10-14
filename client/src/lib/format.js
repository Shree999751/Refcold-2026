export const STATUS = {
  healthy: { label: 'Healthy', tone: 'ok' },
  watch: { label: 'Watch', tone: 'watch' },
  warning: { label: 'Early warning', tone: 'warn' },
  critical: { label: 'Critical', tone: 'crit' },
  tripped: { label: 'Tripped', tone: 'trip' },
  maintenance: { label: 'Recommissioning', tone: 'maint' },
};

export const STATUS_ORDER = { tripped: 0, critical: 1, warning: 2, watch: 3, maintenance: 4, healthy: 5 };

export const CHANNEL_LABELS = {
  suction_temp: 'Suction temperature',
  suction_pressure: 'Suction pressure',
  discharge_temp: 'Discharge temperature',
  discharge_pressure: 'Discharge pressure',
  oil_pressure_delta: 'Oil pressure differential',
  vibration_rms: 'Vibration',
  motor_current: 'Motor current',
  superheat: 'Superheat',
};

const SUFFIX = {
  _roll3_mean: '3-day average',
  _roll7_mean: '7-day average',
  _roll7_slope: '7-day trend',
};

export function featureLabel(name) {
  if (name === 'pressure_ratio') return { channel: 'Pressure ratio', window: 'discharge ÷ suction' };
  for (const [suffix, window] of Object.entries(SUFFIX)) {
    if (name.endsWith(suffix)) return { channel: CHANNEL_LABELS[name.slice(0, -suffix.length)], window };
  }
  return { channel: CHANNEL_LABELS[name] || name, window: 'current' };
}

export const featureText = (name) => {
  const f = featureLabel(name);
  return f.window === 'current' ? f.channel : `${f.channel}, ${f.window}`;
};

const dtf = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const df = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
const tf = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const shortDf = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export const fmtDateTime = (iso) => (iso ? dtf.format(new Date(iso)) : '');
export const fmtDate = (iso) => (iso ? df.format(new Date(iso)) : '');
export const fmtTime = (iso) => (iso ? tf.format(new Date(iso)) : '');
export const fmtShortDate = (ms) => shortDf.format(new Date(ms));

export const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;

export function duration(hours) {
  if (hours === null || hours === undefined) return '';
  const h = Math.max(0, Math.round(hours));
  if (h < 24) return `${h} h`;
  const d = h / 24;
  return `${d.toFixed(d < 10 ? 1 : 0)} days`;
}

export function riskColor(v, thr) {
  if (v >= thr) return 'var(--red)';
  if (v >= thr * 0.6) return 'var(--amber)';
  return 'var(--teal)';
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

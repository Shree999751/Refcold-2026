// Physically-motivated compressor telemetry simulator.
// Used both to generate the training dataset and to drive the live fleet,
// so the deployed model sees the same distribution it was trained on.

import { CHANNELS } from '../ml/features.js';
import { gaussian, uniform } from '../ml/random.js';

// Deltas reached at the moment of failure (progress = 1, severity = 1).
export const FAULT_MODES = {
  floodback: {
    label: 'Liquid floodback',
    summary: 'Liquid refrigerant returns to the compressor and washes oil off the bearings.',
    signature: 'Superheat collapses toward zero while vibration climbs.',
    action:
      'Check the expansion valve superheat setting and evaporator fan operation. Verify the accumulator and crankcase heater before restarting.',
    effects: { superheat: -6.6, suction_temp: -2.2, discharge_temp: -14, vibration_rms: 1.4, motor_current: 1.1, oil_pressure_delta: -18 },
  },
  oil_starvation: {
    label: 'Oil starvation',
    summary: 'Oil fails to return to the crankcase, so bearings run on a thinning film.',
    signature: 'Oil pressure differential sinks steadily; vibration and current follow.',
    action:
      'Inspect the oil level sight glass, oil pump and oil pressure switch. Look for poor oil return from the evaporator or foaming in the crankcase.',
    effects: { oil_pressure_delta: -72, vibration_rms: 1.9, motor_current: 1.6, discharge_temp: 7 },
  },
  thermal_overload: {
    label: 'Thermal overload',
    summary: 'Heat rejection falls behind, so the compressor runs hotter every day.',
    signature: 'Discharge temperature and pressure rise together with motor current.',
    action:
      'Clean the condenser coil and confirm every condenser fan runs. Check head pressure control and purge non-condensables if present.',
    effects: { discharge_temp: 30, motor_current: 4.2, discharge_pressure: 280, vibration_rms: 0.5, superheat: 3.5 },
  },
  refrigerant_leak: {
    label: 'Refrigerant leak',
    summary: 'Charge slowly escapes, starving the evaporator and overheating the motor.',
    signature: 'Suction pressure falls while superheat and discharge temperature rise.',
    action:
      'Run an electronic leak check on joints, valves and service ports. Inspect the sight glass for bubbles, repair, then weigh in the correct charge.',
    effects: { suction_pressure: -95, superheat: 9.5, suction_temp: 3.8, discharge_pressure: -230, motor_current: -2.3, discharge_temp: 11 },
  },
};

export const FAULT_KEYS = Object.keys(FAULT_MODES);

// Daily load cycle amplitude (ambient temperature drives condensing conditions).
const DAILY = { discharge_temp: 2.2, discharge_pressure: 30, motor_current: 0.4, suction_pressure: 3, suction_temp: 0.15, superheat: 0.3 };

export function createUnitProfile(rng) {
  const offsets = {};
  for (const c of CHANNELS) offsets[c.key] = gaussian(rng) * c.sd * 0.35;
  return { offsets, load: uniform(rng, 0.7, 1.3), noise: uniform(rng, 0.8, 1.25) };
}

const round = (v, d) => {
  const p = 10 ** d;
  return Math.round(v * p) / p;
};
const DECIMALS = { suction_temp: 2, suction_pressure: 1, discharge_temp: 2, discharge_pressure: 1, oil_pressure_delta: 1, vibration_rms: 3, motor_current: 2, superheat: 2 };

export class CompressorSim {
  constructor(rng, profile) {
    this.rng = rng;
    this.profile = profile;
    this.hour = 0;
    this.fault = null; // { mode, startHour, durationH, severity }
    this.transient = null; // { kind, start, dur, amp }
  }

  injectFault(mode, severity = 1, durationH = 144) {
    if (!FAULT_MODES[mode]) throw new Error(`Unknown fault mode: ${mode}`);
    this.fault = { mode, startHour: this.hour, durationH, severity };
  }

  clearFault() {
    this.fault = null;
    this.transient = null;
  }

  faultProgress() {
    if (!this.fault) return 0;
    return Math.max(0, (this.hour - this.fault.startHour) / this.fault.durationH);
  }

  hoursToTrip() {
    if (!this.fault) return null;
    return this.fault.startHour + this.fault.durationH - this.hour;
  }

  // Benign events that look a little like faults. They are what makes
  // false alarms possible, which keeps the evaluation honest.
  updateTransient() {
    const r = this.rng;
    if (this.transient && this.hour >= this.transient.start + this.transient.dur) this.transient = null;
    if (this.transient) return;
    const roll = r();
    if (roll < 1 / 48) this.transient = { kind: 'defrost', start: this.hour, dur: 3 + Math.floor(r() * 3), amp: uniform(r, 0.7, 1.2) };
    else if (roll < 1 / 48 + 1 / 220) this.transient = { kind: 'load_surge', start: this.hour, dur: 8 + Math.floor(r() * 28), amp: uniform(r, 0.2, 0.5) };
    else if (roll < 1 / 48 + 1 / 220 + 1 / 900) this.transient = { kind: 'sensor_offset', start: this.hour, dur: 48 + Math.floor(r() * 48), amp: uniform(r, 0.5, 1) };
  }

  transientEffect(key) {
    const t = this.transient;
    if (!t) return 0;
    const x = (this.hour - t.start) / t.dur;
    const bump = Math.sin(Math.PI * Math.min(Math.max(x, 0), 1));
    if (t.kind === 'defrost') {
      const e = { superheat: -1.8, suction_temp: -0.7, discharge_temp: -3 };
      return (e[key] || 0) * bump * t.amp;
    }
    if (t.kind === 'load_surge') {
      return (FAULT_MODES.thermal_overload.effects[key] || 0) * bump * t.amp;
    }
    if (t.kind === 'sensor_offset' && key === 'oil_pressure_delta') {
      return -16 * t.amp * Math.min(1, x * 3);
    }
    return 0;
  }

  step() {
    const r = this.rng;
    const p = this.profile;
    this.updateTransient();
    const progress = Math.min(this.faultProgress(), 1);
    const shape = this.fault ? Math.pow(progress, 1.7) * this.fault.severity : 0;
    const daily = Math.sin((2 * Math.PI * ((this.hour % 24) - 9)) / 24);
    const effects = this.fault ? FAULT_MODES[this.fault.mode].effects : null;

    const out = { t: this.hour };
    for (const c of CHANNELS) {
      let v = c.mean + p.offsets[c.key] + (DAILY[c.key] || 0) * daily * p.load + gaussian(r) * c.sd * 0.55 * p.noise;
      if (effects && effects[c.key]) v += effects[c.key] * shape;
      v += this.transientEffect(c.key);
      out[c.key] = v;
    }
    if (r() < 0.008) out.vibration_rms += 0.5 + r() * 0.8; // isolated mechanical knock
    out.superheat = Math.max(0.2, out.superheat);
    out.oil_pressure_delta = Math.max(5, out.oil_pressure_delta);
    for (const c of CHANNELS) out[c.key] = round(out[c.key], DECIMALS[c.key]);
    this.hour += 1;
    return out;
  }
}

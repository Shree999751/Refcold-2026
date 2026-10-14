# CryoSense

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-0070f3?style=for-the-badge&logo=vercel&logoColor=white)](https://refcold-2026-8kvwu24ln-shreyansh21.vercel.app/)

> 🚀 **Live Demo:** [https://refcold-2026-8kvwu24ln-shreyansh21.vercel.app/](https://refcold-2026-8kvwu24ln-shreyansh21.vercel.app/)

**AI predictive maintenance for industrial refrigeration compressors.**
A working implementation of the REFCOLD India 2026 poster *AI Driven Predictive
Maintenance for Industrial Refrigeration Reliability* (F.R.E.S.H theme, pillar R:
Reliable Quality) by Mudit Vij and Shreyansh Jain, Dayalbagh Educational Institute.

Fixed-threshold cutouts stop a compressor once a limit is crossed, but they carry
no memory of how it got there. CryoSense watches eight sensor channels, turns them
into 33 rolling-window features, and lets three models look for the slow drift that
comes days before a trip.

## What it does

- **Fleet overview** of 12 compressors across four cold-chain sites (Pune, Nashik,
  Delhi, Chennai), streamed live from the backend.
- **Unit detail** with a 240° manifold-style risk gauge, agreement between the three
  models, probable failure mode, a recommended technician action, and an explanation
  of which sensor trends are pushing the risk up.
- **Scenario lab** to inject floodback, oil starvation, thermal overload or a
  refrigerant leak into any unit, speed up time, and watch the lead-time clock.
- **Alerts and service log** with acknowledge and technician dispatch. Servicing a
  unit before it trips is recorded as a failure prevented, with its real lead time.
- **Model report** with ROC curves, precision/recall/F1, feature importance, lead
  time per held-out unit and the reactive vs CryoSense comparison.
- Light theme and a "Night shift" dark theme for control rooms.

## The AI models

All models are implemented from scratch in JavaScript (`server/src/ml`), so the
project runs on Node alone with no Python environment.

| Model | Role | Test AUC | Mean lead time | False alarms / 100 days |
|---|---|---|---|---|
| Logistic Regression | Baseline, class-balanced, standardised | 0.86 | 3.6 days | 0.32 |
| Random Forest | Primary, 300 trees, depth 8, balanced bootstrap | 0.87 | 4.5 days | 0.32 |
| Isolation Forest | Unsupervised, trained on healthy rows only | 0.88 | 3.4 days | 1.06 |

A fourth forest classifies which of the four failure modes is developing.
Training data comes from a physics-informed compressor simulator (170 units,
48 days each, unit-level train/validation/test split so no unit leaks across sets).
Numbers regenerate with `npm run train`.

**Features (33):** six-hour mean of each of the 8 channels, 3-day and 7-day rolling
means and a 7-day rolling slope per channel, plus the discharge/suction pressure
ratio.

## Architecture

```
client/  React 18 + Vite, React Router, Recharts, custom design system
   |  REST + Server-Sent Events (/api/stream)
server/  Node + Express
   |- ml/     features, random forest, logistic regression, isolation forest, metrics
   |- sim/    compressor physics simulator, fleet engine, alerting logic
   |- db/     Firebase Firestore store (falls back to in-memory)
   |- models/ pretrained model.json + metrics.json
Firebase Cloud Firestore
   units, sites, alerts, maintenance_logs, events, telemetry_snapshots, meta
```

Firebase is used through `firebase-admin` on the server only, so credentials never
reach the browser. If no credentials are present the server runs with in-memory
storage, so a live demo never depends on the network.

## Quick start

```bash
npm run install:all
npm run dev          # http://localhost:5173
```

Full commands, Firebase setup, production build and a demo script are in
**`command.txt`**. Credentials go in **`server/.env`** (or drop
`serviceAccountKey.json` into `server/`).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | Health, storage mode, model info |
| GET | `/api/fleet` | Fleet summary and every unit |
| GET | `/api/units/:id` | Unit detail, history, explanation |
| GET | `/api/alerts?status=open` | Alerts |
| GET | `/api/maintenance` | Service log |
| GET | `/api/model` | Training metrics |
| GET | `/api/impact` | Reactive vs CryoSense outcomes |
| GET | `/api/stream` | Live updates (SSE) |
| POST | `/api/units/:id/faults` | Start a fault scenario |
| POST | `/api/units/:id/service` | Send a technician |
| POST | `/api/alerts/:id/acknowledge` | Acknowledge an alert |
| POST | `/api/simulation` | Speed / pause |
| POST | `/api/simulation/reset` | Reset the fleet |

## Note on data

Sensor data is simulated from the healthy ranges on the poster and published
failure signatures. The pipeline accepts real hourly controller readings in the
same eight channels with no model changes.

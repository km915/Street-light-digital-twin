# Street Light Digital Twin Platform

A full-stack digital twin platform for smart street light monitoring, simulation, and predictive maintenance. Built with React, Node.js/Express, PostgreSQL, Python/Flask, and Random Forest ML models.

---

## First-Time Setup

Generate the trained ML models before starting Docker:

```bash
cd ml
python generate_data.py
python train_global_models.py
```

Verify that the following files exist in `ml/models/`:
- `energy_model.pkl`
- `fault_model.pkl`
- `preprocessor.pkl`
- `feature_columns.json`
- `model_metadata.json`

Also generate the password hash for the default admin user and update `init.sql`:

```bash
node -e "const b = require('bcryptjs'); console.log(b.hashSync('admin123', 10))"
```

Replace the placeholder hash in `init.sql` with the output.

---

## Run with Docker

```bash
docker compose up --build
```

Open `http://localhost`

Default login — username: `admin`, password: `admin123`

After login, select the IIT Kharagpur region. On the Fleet page, open Fleet Management and click "Reset to original 50" to load the default street lights.

---

## Run Locally (without Docker)

Three terminals required:

```bash
# Terminal 1 — ML model server
cd ml
pip install flask flask-cors scikit-learn joblib pandas numpy
python flask_model_api.py

# Terminal 2 — Express backend
cd backend
npm install
npm run dev

# Terminal 3 — React frontend
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

PostgreSQL must be running locally. Create a database named `streetlight_twin` and run `init.sql` to create the schema, then run `backend/src/db/seed.js` to seed the default street lights.

---

## System Architecture

```
+------------------+     WebSocket      +-------------------+
|  React Frontend  | <----------------> |  Express Backend  |
|  (Vite + React)  |                    |  (Node.js / JWT)  |
|                  | <-- REST API ----> |                   |
+------------------+                    +--------+----------+
                                                  |
                              +-------------------+-------------------+
                              |                                       |
                     +--------+--------+                   +---------+--------+
                     |   PostgreSQL    |                   |   Flask / Python |
                     |                |                    |   Model Server   |
                     |  street_lights |                    |                  |
                     |  twin_state    |                    |  Random Forest   |
                     |  state_history |                    |  Regressor       |
                     |  maintenance   |                    |  Classifier      |
                     |  regions       |                    |                  |
                     |  users         |                    |  /predict/batch  |
                     +-----------------+                   |  /whatif         |
                                                           |  /retrain        |
                                                           +------------------+
```

### Data Flow

```
Data Source Selection
        |
        +-- Simulated -----> Twin Engine (setInterval tick)
        |                         |
        |                         v
        |                   Calls Flask /predict/batch
        |                         |
        |                         v
        |                   Updates twin_state (PostgreSQL)
        |                         |
        |                         v
        |                   Broadcasts via WebSocket
        |                         |
        +-- Live Feed -----> WebSocket from real sensor network
        |                         |
        |                         v
        |                   Writes to state_history (is_simulated=false)
        |                         |
        +----------------------------> React Dashboard updates live
```

### Directory Structure

```
project/
  ml/
    generate_data.py          synthetic dataset generator
    train_global_models.py    model training script
    flask_model_api.py        prediction server (port 5001)
    models/                   trained .pkl files (not in git)
    street_lights.json        IIT KGP light definitions with coordinates

  backend/
    src/
      db/
        pool.js               PostgreSQL connection
        seed.js               seeds street_lights.json to database
      twin/
        engine.js             twin engine tick loop
        retrainScheduler.js   periodic model retraining
      routes/
        auth.js               login / JWT
        lights.js             fleet REST endpoints + analytics
        whatif.js             what-if simulation engine
        simulation.js         sim control + data source switching
        maintenance.js        per-light and zone maintenance
        fleet.js              add / decommission lights
        regions.js            multi-region management + CSV upload
      middleware/
        auth.js               JWT validation + region scoping
      websocket/
        broadcast.js          WebSocket state broadcaster
    server.js                 entry point

  frontend/
    src/
      api/client.js           axios instance with JWT headers
      context/
        TwinContext.jsx        live state, WebSocket, dark mode
        AuthContext.jsx        login state, region selection
      pages/
        Login.jsx
        RegionSelector.jsx
        FleetView.jsx
        LightDetail.jsx
        MapView.jsx
        WhatIf.jsx
        Analytics.jsx
        Settings.jsx
      components/
        Sidebar.jsx
        Navbar.jsx
        map/LightMarker.jsx
        map/LocationPicker.jsx

  docker-compose.yml
  init.sql
```

---

## Core Features

### Multi-Region Management

The platform supports multiple independent street light networks (regions). Each user account can manage one or more regions. After login, a region selector presents all accessible regions as tiles showing live KPIs (light count, fault alerts, average health). A new region is created by uploading a historical CSV file containing past sensor readings — the platform parses it, seeds the database, and the ML model retrains on the combined dataset.

Required CSV columns: `light_id`, `zone`, `lamp_type`, `rated_power`

Optional columns: `efficiency`, `install_age_days`, `initial_health`, `latitude`, `longitude`, `brightness`, `health_score`, `energy_consumed`, `fault_occurred`, `weather`, `hour`

### Digital Twin Engine

The twin engine runs a server-side tick loop (default 5 seconds per tick = 1 simulated hour). On each tick it:

1. Fetches current state of all lights from PostgreSQL
2. Calls the Flask model server with the current features of all lights in a single batch request
3. Receives predicted energy consumption (kWh/hr) and fault probability for each light
4. Updates `twin_state` with new values including health degradation
5. Broadcasts the full updated state to all connected React clients over WebSocket

Health degradation rules mirror real-world lamp behaviour: LED degrades slowest, MH fastest. Bad weather accelerates degradation. A fault event causes an additional health hit.

### ML Models

Two Random Forest models are trained on historical data (real or synthetic):

**Energy Regressor** — predicts `energy_consumed` (kWh/hr) from: lamp type, weather, rated power, efficiency, hour of day, is_night flag, brightness, ambient light, health score, region ID. Achieves R² > 0.99 on synthetic data.

**Fault Classifier** — predicts fault probability from the same features. Uses `class_weight='balanced'` to handle the imbalanced dataset (roughly 3% fault rate). Evaluated with ROC-AUC rather than accuracy.

Both models use a single global training dataset with `region_id` as a feature, allowing the model to learn region-specific behaviour without requiring separate models per region.

### Data Sources

Three modes are selectable from the navbar:

**No Connection** — dashboard is idle, no data shown.

**Simulated** — the server-side twin engine generates synthetic sensor readings using realistic physics rules (brightness by time of day, health degradation, weather-influenced fault probability). Simulation time starts from the current real-world datetime on every connect. Simulated data is never written to `state_history` and is never used for model retraining.

**Live Feed** — connects to a real WebSocket endpoint broadcasting sensor data from physical street lights. Live readings are written to `state_history` with `is_simulated=false` and are used for periodic model retraining.

### Connecting a Live Data Feed

The platform expects a WebSocket server broadcasting JSON messages in this format:

```json
{
  "type": "TICK",
  "lights": [
    {
      "light_id": "SL-001",
      "brightness": 82.5,
      "status": "ON",
      "health_score": 74.2,
      "energy_consumed": 0.0576,
      "ambient_light": 8.3,
      "weather": "clear",
      "fault_alert": false,
      "fault_probability": 0.04,
      "simulated_hour": 22
    }
  ],
  "simulatedHour": 22,
  "realTimestamp": "2026-06-12T20:00:00.000Z"
}
```

Each message represents one reading cycle. `light_id` values must match the IDs in the region's `street_lights` table. To connect, select "Live Feed" in the navbar dropdown and enter the WebSocket URL (e.g. `ws://192.168.1.100:8080`).

The backend receives each live message, updates `twin_state`, and appends to `state_history` for model retraining. The frontend dashboard updates identically to simulation mode — the live/simulated distinction only affects data persistence and retraining eligibility.

### What-If Simulator

The what-if page runs hour-by-hour predictions for a proposed scenario without modifying any real data. A scenario can include:

- **Scope** — all lights, a specific zone, or a specific lamp type
- **Duration** — 1 day to 1 month (capped at 720 simulated hours)
- **Brightness schedule** — time-based rules (e.g. 18:00-22:00 at 90%, 22:00-05:00 at 60%)
- **Weather sequence** — one weather condition per simulated day, cycling if fewer entries than days
- **Lamp replacement** — simulate upgrading lamp type (e.g. HPS to LED) without changing the real fleet
- **Health reset** — simulate a maintenance event before the scenario runs

Results are shown as five separate line charts (energy consumption, energy saving %, fault probability, fault alerts, health score) each showing baseline vs proposed over the full duration. A per-light snapshot table and fleet KPI summary are also shown. Results can be exported as CSV.

### Fleet Management

Lights can be added or decommissioned from the Fleet page. New lights auto-increment IDs (SL-051 onwards). Virtual lights (added via the UI) are tracked with an `is_virtual` flag. The fleet can be reset to the original 50 lights at any time. Zone-wide or per-light maintenance events reset health score to 95% and are logged with timestamps.

### Map View

All lights with assigned coordinates appear as colour-coded circle markers on a CartoDB Positron map (clean vector tile map showing roads and landmarks). Marker colour indicates status: green (on, healthy), amber (health below 30%), red (fault alert), grey (off). Markers update live from WebSocket. Clicking a marker shows a popup with current state. Location assignment opens an interactive map picker — click anywhere to place the light. Unmapped lights appear in a side panel with an Assign button.

### Analytics

The Analytics page has two sections. The current snapshot section (updates every WebSocket tick) shows health score distribution, zone status overview, lamp type breakdown, and current weather distribution. The 24-hour history section shows per-zone line charts for energy consumption, health score, fault count, and brightness — powered by an in-memory circular buffer maintained by the twin engine. This buffer is cleared when the simulation stops, ensuring historical charts never mix simulation and live data.

### Model Retraining

The scheduler checks every 30 minutes whether the configured interval has elapsed since the last retrain (stored in PostgreSQL, persists across server restarts). Default schedule is weekly. Options are hourly, daily, weekly, monthly, or manual. Only real feed data (`is_simulated=false`) is used for scheduled retraining. A force retrain option uses current simulation state for development and testing. The Settings page shows a progress bar during training and fires a browser alert on completion with model metrics (R², ROC-AUC, rows used).

---

## API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login, returns JWT |
| GET  | `/api/auth/me` | Verify token |

### Lights
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/lights` | All lights in current region |
| GET  | `/api/lights/:id` | Single light + 48h history |
| POST | `/api/lights/:id/override` | Force brightness/weather |
| PATCH | `/api/lights/:id/location` | Save map coordinates |
| GET  | `/api/lights/analytics/fleet` | Fleet KPI summary |
| GET  | `/api/lights/analytics/zone-history` | 24h per-zone history |

### Simulation
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/simulation/state` | Engine state |
| POST | `/api/simulation/control` | pause / resume / setSpeed |
| POST | `/api/simulation/source` | Switch data source |
| POST | `/api/simulation/retrain/trigger` | Retrain on real data |
| POST | `/api/simulation/retrain/force` | Retrain on simulation data |
| GET  | `/api/simulation/retrain/status` | Training progress |

### What-If
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/whatif` | Run scenario simulation |

### Maintenance
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/maintenance/light/:id` | Maintain single light |
| POST | `/api/maintenance/zone/:zone` | Maintain entire zone |
| GET  | `/api/maintenance/log` | Maintenance history |

### Regions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/regions` | All accessible regions |
| POST | `/api/regions` | Create region from CSV upload |

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Recharts, React-Leaflet |
| Backend | Node.js, Express, WebSocket (ws), JWT, bcryptjs |
| Database | PostgreSQL 15 |
| ML Server | Python 3.11, Flask, scikit-learn, pandas, joblib |
| Infrastructure | Docker, Docker Compose, nginx |

---

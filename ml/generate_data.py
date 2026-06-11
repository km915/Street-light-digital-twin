"""
Street Light Digital Twin — Synthetic Data Generator
=====================================================
Outputs two files:
  street_lights.json   — 50 light objects (identity/static data)
  synthetic_data.csv   — ~2.16M rows (50 lights × 180 days × 24 hours)

Each CSV row = one light at one simulated hour.
Columns used directly as ML features + targets.
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path

# ── reproducibility ──────────────────────────────────────────────────────────
np.random.seed(42)

# ── constants ─────────────────────────────────────────────────────────────────
N_LIGHTS   = 50
N_DAYS     = 180   # ~6 months
HOURS      = 24
OUTPUT_DIR = Path(".")

ZONES     = ["Zone-1", "Zone-2", "Zone-3", "Zone-4", "Zone-5"]
LAMP_TYPES = ["LED", "HPS", "MH"]           # High-Pressure Sodium, Metal Halide
RATED_POWERS = {                            # watts per lamp type
    "LED": [50, 70, 100],
    "HPS": [100, 150, 250],
    "MH":  [150, 250, 400],
}

# Weather: (label, probability, fault_multiplier, health_drain_multiplier)
WEATHER_OPTIONS = [
    ("clear",  0.55, 1.0,  1.0),
    ("cloudy", 0.20, 1.1,  1.05),
    ("rainy",  0.15, 1.4,  1.3),
    ("foggy",  0.07, 1.2,  1.15),
    ("stormy", 0.03, 2.5,  2.0),
]
WEATHER_LABELS  = [w[0] for w in WEATHER_OPTIONS]
WEATHER_PROBS   = np.array([w[1] for w in WEATHER_OPTIONS])
WEATHER_PROBS  /= WEATHER_PROBS.sum()   # normalise to 1
WEATHER_FAULT_M = {w[0]: w[2] for w in WEATHER_OPTIONS}
WEATHER_HEALTH_M = {w[0]: w[3] for w in WEATHER_OPTIONS}

# Lamp efficiency (higher = more light per watt, LED is best)
LAMP_EFFICIENCY = {"LED": 1.0, "HPS": 0.75, "MH": 0.65}

# Maintenance cost per fault event (rupees) — used in KPI layer later
MAINTENANCE_COST_PER_FAULT = {"LED": 300, "HPS": 500, "MH": 450}

# ── step 1: create the 50 light objects ───────────────────────────────────────
print("Creating 50 street light objects...")

street_lights = []
for i in range(1, N_LIGHTS + 1):
    zone      = ZONES[(i - 1) % len(ZONES)]          # distribute evenly across zones
    lamp_type = np.random.choice(LAMP_TYPES, p=[0.5, 0.3, 0.2])  # LED majority
    rated_power = int(np.random.choice(RATED_POWERS[lamp_type]))

    # installation age in days (0–5 years) — older lights start with lower health
    install_age_days = int(np.random.uniform(0, 5 * 365))

    light = {
        "id":                   f"SL-{i:03d}",
        "zone":                 zone,
        "lamp_type":            lamp_type,
        "rated_power":          rated_power,
        "install_age_days":     install_age_days,
        "maintenance_cost":     MAINTENANCE_COST_PER_FAULT[lamp_type],
        "efficiency":           LAMP_EFFICIENCY[lamp_type],
        # initial health — older lights start degraded
        "initial_health":       round(max(30.0, 100.0 - install_age_days * 0.015
                                         + np.random.uniform(-5, 5)), 2),
    }
    street_lights.append(light)

# save JSON
json_path = OUTPUT_DIR / "street_lights.json"
with open(json_path, "w") as f:
    json.dump(street_lights, f, indent=2)
print(f"  ✓ Saved {len(street_lights)} lights → {json_path}")


# ── helper functions ──────────────────────────────────────────────────────────

def get_brightness(hour: int, base_policy: float, weather: str) -> float:
    """
    Simulate brightness policy:
      - Lights OFF during daytime (hours 7–18)
      - Full brightness at dusk/dawn (hours 18–22, 5–7)
      - Dimmed overnight (hours 22–5) — midnight dimming policy
    Slight adjustment for foggy/stormy weather (keep brighter for safety).
    """
    if 7 <= hour < 18:
        return 0.0   # daytime, lights off

    if 18 <= hour < 22 or 5 <= hour < 7:
        # dusk/dawn — full brightness
        b = base_policy + np.random.uniform(-3, 3)
    else:
        # midnight (22–5): dim to save energy
        b = base_policy * 0.65 + np.random.uniform(-2, 2)

    # safety boost in bad weather
    if weather in ("foggy", "stormy"):
        b = min(100.0, b + 10)

    return round(float(np.clip(b, 0, 100)), 2)


def get_ambient_light(hour: int, weather: str) -> float:
    """
    Simulate ambient light sensor reading (lux).
    Daytime: high. Night: low. Weather attenuates daytime.
    """
    if 7 <= hour < 18:
        base = np.random.uniform(300, 900)
        attenuation = {"clear": 1.0, "cloudy": 0.6, "rainy": 0.4,
                       "foggy": 0.3, "stormy": 0.15}
        return round(base * attenuation.get(weather, 1.0), 1)
    else:
        # nighttime: near zero, slight moonlight/street noise
        return round(np.random.uniform(0, 15), 1)


def calc_energy(brightness: float, rated_power: int, efficiency: float) -> float:
    """
    Energy consumed in one hour (kWh).
    formula: (brightness% / 100) × rated_power × (1/efficiency_factor) / 1000
    Less efficient lamps use more power for the same brightness.
    """
    if brightness == 0:
        return 0.0
    actual_watts = (brightness / 100) * rated_power * (1 / efficiency)
    return round(actual_watts / 1000, 6)   # kWh for 1 hour


def calc_fault_probability(health: float, weather: str,
                            lamp_type: str, hour: int) -> float:
    """
    Fault probability for this hour.
    Base: derived from health score (low health = higher fault chance).
    Modified by weather, lamp type robustness, and time (storms at night worse).
    """
    # base probability from health — exponential increase as health drops
    base = ((100 - health) / 100) ** 2 * 0.08    # max ~8% at health=0

    # weather multiplier
    base *= WEATHER_FAULT_M[weather]

    # lamp robustness: LED most robust
    lamp_m = {"LED": 0.7, "HPS": 1.0, "MH": 1.2}
    base *= lamp_m[lamp_type]

    # stormy night is worst case
    if weather == "stormy" and (hour >= 20 or hour < 6):
        base *= 1.5

    return float(np.clip(base, 0, 0.95))


def calc_health_drain(weather: str, brightness: float,
                      lamp_type: str, fault: int) -> float:
    """
    How much health this light loses in one hour.
    Lamps degrade faster when: on at high brightness, bad weather, faults occur.
    """
    if brightness == 0:
        # light is off — still ages slightly (weather damage, corrosion)
        base_drain = np.random.uniform(0.0, 0.003)
    else:
        base_drain = np.random.uniform(0.005, 0.015)
        # high brightness accelerates wear
        base_drain += (brightness / 100) * 0.005

    # weather damage
    base_drain *= WEATHER_HEALTH_M[weather]

    # fault events cause a health hit
    if fault:
        base_drain += np.random.uniform(0.5, 2.0)

    # lamp durability
    lamp_durability = {"LED": 0.6, "HPS": 1.0, "MH": 1.3}
    base_drain *= lamp_durability[lamp_type]

    return base_drain


# ── step 2: generate synthetic history ────────────────────────────────────────
print(f"\nGenerating synthetic history ({N_LIGHTS} lights × {N_DAYS} days × {HOURS} hours)...")
total_rows = N_LIGHTS * N_DAYS * HOURS
print(f"  Expected rows: {total_rows:,}")

all_rows = []

for light_idx, light in enumerate(street_lights):
    if (light_idx + 1) % 10 == 0:
        print(f"  Processing light {light_idx + 1}/{N_LIGHTS}...")

    health = light["initial_health"]

    # base brightness policy: slight variation per light (some zones kept brighter)
    zone_brightness_policy = {
        "Zone-1": 90, "Zone-2": 85, "Zone-3": 80,
        "Zone-4": 95, "Zone-5": 75
    }
    base_brightness = zone_brightness_policy[light["zone"]]

    # pre-generate weather for all days for this light (weather persists per day,
    # not per hour — more realistic than changing every hour)
    daily_weather = np.random.choice(
        WEATHER_LABELS, size=N_DAYS, p=WEATHER_PROBS
    )

    for day in range(N_DAYS):
        weather = daily_weather[day]

        for hour in range(HOURS):
            # ── compute this tick's values ─────────────────────────────────
            brightness     = get_brightness(hour, base_brightness, weather)
            ambient_light  = get_ambient_light(hour, weather)
            status         = "ON" if brightness > 0 else "OFF"

            fault_prob     = calc_fault_probability(health, weather,
                                                     light["lamp_type"], hour)
            fault_occurred = int(np.random.random() < fault_prob)

            energy         = calc_energy(brightness, light["rated_power"],
                                         light["efficiency"])

            drain          = calc_health_drain(weather, brightness,
                                               light["lamp_type"], fault_occurred)
            health         = round(max(0.0, health - drain), 4)

            # maintenance cost this hour (non-zero only on fault)
            maintenance_cost = light["maintenance_cost"] if fault_occurred else 0

            all_rows.append({
                # identity
                "light_id":           light["id"],
                "zone":               light["zone"],
                "lamp_type":          light["lamp_type"],
                "rated_power":        light["rated_power"],
                "efficiency":         light["efficiency"],
                # time
                "day":                day,
                "hour":               hour,
                "is_night":           int(brightness > 0),
                # live state (ML features)
                "brightness":         brightness,
                "status":             status,
                "ambient_light":      ambient_light,
                "weather":            weather,
                "health_score":       health,
                # targets (what ML models will predict)
                "energy_consumed":    energy,
                "fault_occurred":     fault_occurred,
                "fault_probability":  round(fault_prob, 6),
                # derived (used in KPI layer)
                "maintenance_cost":   maintenance_cost,
            })

# ── step 3: save CSV ──────────────────────────────────────────────────────────
print("\nBuilding DataFrame and saving CSV...")
df = pd.DataFrame(all_rows)

csv_path = OUTPUT_DIR / "synthetic_data.csv"
df.to_csv(csv_path, index=False)

# ── step 4: print summary stats ───────────────────────────────────────────────
print(f"\n{'='*55}")
print("GENERATION COMPLETE")
print(f"{'='*55}")
print(f"  Rows generated:       {len(df):,}")
print(f"  CSV file size:        {csv_path.stat().st_size / 1_000_000:.1f} MB")
print(f"  JSON file size:       {json_path.stat().st_size / 1_000:.1f} KB")

print(f"\n── Column overview ──────────────────────────────────")
print(df.dtypes.to_string())

print(f"\n── Numeric summary ──────────────────────────────────")
print(df[["brightness","health_score","energy_consumed",
          "fault_occurred","ambient_light"]].describe().round(3).to_string())

print(f"\n── Fault rate by weather ────────────────────────────")
print(df.groupby("weather")["fault_occurred"].mean().round(4).to_string())

print(f"\n── Fault rate by lamp type ──────────────────────────")
print(df.groupby("lamp_type")["fault_occurred"].mean().round(4).to_string())

print(f"\n── Avg energy consumed (kWh/hr) by lamp type ────────")
print(df[df["energy_consumed"] > 0].groupby("lamp_type")["energy_consumed"]
        .mean().round(6).to_string())

print(f"\n── Health score at end of simulation (final day) ────")
final_day = df[df["day"] == N_DAYS - 1]
print(final_day.groupby("lamp_type")["health_score"].mean().round(2).to_string())

print(f"\n── Total faults across all lights ───────────────────")
print(f"  {df['fault_occurred'].sum():,} fault events over {N_DAYS} simulated days")
print(f"  Average faults per light: {df.groupby('light_id')['fault_occurred'].sum().mean():.1f}")

print(f"\n── Zone summary ─────────────────────────────────────")
zone_summary = df.groupby("zone").agg(
    total_energy=("energy_consumed", "sum"),
    total_faults=("fault_occurred", "sum"),
    avg_health=("health_score", "mean")
).round(2)
print(zone_summary.to_string())

print(f"\n✓ Done. Files written to: {OUTPUT_DIR.resolve()}")
print(f"  → street_lights.json")
print(f"  → synthetic_data.csv")

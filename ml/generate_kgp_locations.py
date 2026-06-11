"""
IIT Kharagpur Street Light Location Generator
==============================================
Generates 50 realistic street light positions across IIT KGP campus.

Campus center: approximately 22.3149 N, 87.3105 E

Zone layout based on actual IIT KGP geography:
  Zone-1  Main Building + Nehru Museum + Administrative area (central)
  Zone-2  Halls of Residence — north cluster (LBS, MS, Nehru, RP, Patel)
  Zone-3  Academic Complex — departments (east side, Hijli area)
  Zone-4  Technology Market + Shopping complex + Staff quarters (south)
  Zone-5  Halls of Residence — south cluster (Azad, MMM, VS, RK) + Stadium
"""

import json
import numpy as np
import random

np.random.seed(42)
random.seed(42)

# ── zone definitions — anchor points and spread ───────────────────────────────
# Each zone has a list of road/path waypoints with small random offsets
# Coordinates are realistic for IIT KGP campus

ZONES = {
    "Zone-1": {
        "description": "Main Building, Nehru Museum, Admin, central spine road",
        "lamp_type_weights": {"LED": 0.7, "HPS": 0.2, "MH": 0.1},
        "waypoints": [
            # Main Building area and central road
            (22.31820, 87.30950),
            (22.31780, 87.30980),
            (22.31750, 87.31020),
            (22.31720, 87.31060),
            (22.31690, 87.31100),
            (22.31850, 87.31050),
            (22.31900, 87.31000),
            (22.31870, 87.31150),
            (22.31830, 87.31200),
            (22.31760, 87.31180),
        ]
    },
    "Zone-2": {
        "description": "North halls — LBS, MS, Nehru, RP, Patel halls",
        "lamp_type_weights": {"LED": 0.4, "HPS": 0.4, "MH": 0.2},
        "waypoints": [
            # Roads between north halls of residence
            (22.32100, 87.31200),
            (22.32150, 87.31150),
            (22.32200, 87.31100),
            (22.32050, 87.31250),
            (22.32000, 87.31300),
            (22.32250, 87.31050),
            (22.32300, 87.31000),
            (22.32180, 87.31320),
            (22.32120, 87.31380),
            (22.32060, 87.31420),
        ]
    },
    "Zone-3": {
        "description": "Academic complex — dept buildings, Hijli, east campus",
        "lamp_type_weights": {"LED": 0.5, "HPS": 0.3, "MH": 0.2},
        "waypoints": [
            # Academic zone roads
            (22.31600, 87.31400),
            (22.31550, 87.31450),
            (22.31500, 87.31500),
            (22.31650, 87.31350),
            (22.31700, 87.31300),
            (22.31450, 87.31550),
            (22.31400, 87.31600),
            (22.31750, 87.31400),
            (22.31800, 87.31450),
            (22.31480, 87.31480),
        ]
    },
    "Zone-4": {
        "description": "Tech market, shopping complex, staff quarters, south entrance",
        "lamp_type_weights": {"LED": 0.3, "HPS": 0.5, "MH": 0.2},
        "waypoints": [
            # Tech market and staff housing area
            (22.31200, 87.30800),
            (22.31150, 87.30850),
            (22.31100, 87.30900),
            (22.31250, 87.30750),
            (22.31300, 87.30700),
            (22.31050, 87.30950),
            (22.31000, 87.31000),
            (22.31350, 87.30650),
            (22.31180, 87.30920),
            (22.31080, 87.30870),
        ]
    },
    "Zone-5": {
        "description": "South halls — Azad, MMM, VS, RK halls + stadium + gymkhana",
        "lamp_type_weights": {"LED": 0.4, "HPS": 0.4, "MH": 0.2},
        "waypoints": [
            # South residential + stadium roads
            (22.31400, 87.31100),
            (22.31350, 87.31150),
            (22.31300, 87.31200),
            (22.31450, 87.31050),
            (22.31500, 87.31000),
            (22.31250, 87.31250),
            (22.31200, 87.31300),
            (22.31550, 87.30950),
            (22.31380, 87.31220),
            (22.31280, 87.31180),
        ]
    },
}

LAMP_EFFICIENCY  = {"LED": 1.0, "HPS": 0.75, "MH": 0.65}
LAMP_POWER       = {"LED": [50, 70, 100], "HPS": [100, 150, 250], "MH": [150, 250, 400]}
MAINTENANCE_COST = {"LED": 300, "HPS": 500, "MH": 450}

lights = []
light_num = 1

for zone_name, zone_info in ZONES.items():
    waypoints = zone_info["waypoints"]
    weights   = zone_info["lamp_type_weights"]

    lamp_types = list(weights.keys())
    lamp_probs = list(weights.values())

    for wp in waypoints:
        # small random offset so lights aren't exactly on the waypoint
        lat = wp[0] + np.random.uniform(-0.00015, 0.00015)
        lng = wp[1] + np.random.uniform(-0.00015, 0.00015)

        lamp_type    = np.random.choice(lamp_types, p=lamp_probs)
        rated_power  = int(np.random.choice(LAMP_POWER[lamp_type]))
        install_age  = int(np.random.uniform(0, 5 * 365))
        init_health  = round(max(30.0, 100.0 - install_age * 0.015
                                 + np.random.uniform(-5, 5)), 2)

        lights.append({
            "id":               f"SL-{light_num:03d}",
            "zone":             zone_name,
            "lamp_type":        lamp_type,
            "rated_power":      rated_power,
            "efficiency":       LAMP_EFFICIENCY[lamp_type],
            "install_age_days": install_age,
            "initial_health":   init_health,
            "maintenance_cost": MAINTENANCE_COST[lamp_type],
            "latitude":         round(lat, 6),
            "longitude":        round(lng, 6),
        })
        light_num += 1

# verify count
assert len(lights) == 50, f"Expected 50, got {len(lights)}"

# print summary
print("Zone distribution:")
from collections import Counter
zone_counts = Counter(l["zone"] for l in lights)
for z, c in sorted(zone_counts.items()):
    print(f"  {z}: {c} lights")

print("\nLamp type distribution:")
lamp_counts = Counter(l["lamp_type"] for l in lights)
for lt, c in sorted(lamp_counts.items()):
    print(f"  {lt}: {c} lights")

print("\nSample light:")
print(json.dumps(lights[0], indent=2))

print(f"\nCoordinate ranges:")
lats = [l["latitude"]  for l in lights]
lngs = [l["longitude"] for l in lights]
print(f"  Lat: {min(lats):.5f} to {max(lats):.5f}")
print(f"  Lng: {min(lngs):.5f} to {max(lngs):.5f}")

# save
with open("street_lights.json", "w") as f:
    json.dump(lights, f, indent=2)

print(f"\nSaved {len(lights)} lights to street_lights.json")

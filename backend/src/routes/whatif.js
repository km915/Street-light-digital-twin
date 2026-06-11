// src/routes/whatif.js
const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const axios   = require('axios');
require('dotenv').config();

const FLASK_URL = process.env.FLASK_API_URL || 'http://localhost:5001';

const LAMP_EFFICIENCY = { LED: 1.0, HPS: 0.75, MH: 0.65 };
const ZONE_BRIGHTNESS = {
  'Zone-1': 90, 'Zone-2': 85, 'Zone-3': 80,
  'Zone-4': 95, 'Zone-5': 75
};

// resolve how many hours to simulate from duration string
function resolveDurationHours(duration) {
  const map = {
    '1 week':   7  * 24,
    '1 month':  30 * 24,
    '3 months': 90 * 24,
    '6 months': 180 * 24,
  };
  if (map[duration]) return Math.min(map[duration], 720)  // cap at 1 month;
  const n = parseInt(duration);
  return isNaN(n) ? 24 : n * 24;  // treat plain number as days
}

// get brightness for a given hour from time rules array
// rules: [{ from: 18, to: 22, brightness: 90 }, ...]
// falls back to zone default if no rule covers this hour
function getBrightnessFromRules(hour, rules, zone) {
  if (!rules || rules.length === 0) {
    const base = ZONE_BRIGHTNESS[zone] || 85;
    if (hour >= 7 && hour < 18) return 0;
    if ((hour >= 18 && hour < 22) || (hour >= 5 && hour < 7)) return base;
    return base * 0.65;
  }
  for (const rule of rules) {
    // handle rules that wrap midnight e.g. from:22, to:6
    const wraps = rule.from > rule.to;
    const covers = wraps
      ? (hour >= rule.from || hour < rule.to)
      : (hour >= rule.from && hour < rule.to);
    if (covers) return rule.brightness;
  }
  // hour not covered by any rule — use zone default
  const base = ZONE_BRIGHTNESS[zone] || 85;
  if (hour >= 7 && hour < 18) return 0;
  return base;
}

// get weather for a given simulated day from weather sequence
// sequence: ['clear', 'rainy', 'stormy', ...] — cycles if shorter than duration
function getWeatherForDay(day, sequence) {
  if (!sequence || sequence.length === 0) return null;
  return sequence[day % sequence.length];
}


router.post('/', async (req, res) => {
  try {
    const {
      // scope
      light_id, zone, lamp_type,
      // duration
      duration = '1',        // number of days or preset string
      start_hour = 0,        // which hour of day to start plotting from
      // interventions
      brightness_rules,      // [{ from, to, brightness }]
      weather_sequence,      // ['clear', 'rainy', ...]  one per day
      lamp_replacement,      // { lamp_type, rated_power }
      health_reset,          // true/false — reset health to 95 before simulating
      // legacy single-value support
      brightness,
      weather,
      hour,
    } = req.body;

    // ── fetch affected lights ──────────────────────────────────────────────────
    const conditions = [];
    const params     = [];

    if (light_id) {
      params.push(light_id);
      conditions.push(`ts.light_id = $${params.length}`);
    } else {
      if (zone) { params.push(zone); conditions.push(`sl.zone = $${params.length}`); }
      if (lamp_type) { params.push(lamp_type); conditions.push(`sl.lamp_type = $${params.length}`); }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows: lights } = await pool.query(`
      SELECT ts.light_id, ts.brightness, ts.health_score, ts.weather,
             ts.ambient_light, ts.simulated_hour, ts.energy_consumed,
             sl.lamp_type, sl.rated_power, sl.efficiency,
             sl.zone, sl.maintenance_cost, sl.region_id
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id = sl.id
      ${where}
      ORDER BY ts.light_id
    `, params);

    if (lights.length === 0)
      return res.status(404).json({ error: 'No lights matched the filters' });

    // ── resolve simulation duration ────────────────────────────────────────────
    const totalHours = resolveDurationHours(duration);

    if (totalHours > 720) {
      return res.status(400).json({
        error: 'Maximum simulation duration is 1 month (720 hours). ' +
              'Choose a shorter duration.'
      })
    }

    // estimated time warning in response header
    const estimatedSeconds = Math.round(totalHours * 0.3)
    res.setHeader('X-Estimated-Seconds', estimatedSeconds)

    const totalDays  = Math.ceil(totalHours / 24);

    // ── build hourly simulation ────────────────────────────────────────────────
    // For each hour 0..totalHours, for each light,
    // build baseline and proposed input, call Flask batch, collect results.
    // We batch ALL lights × ALL hours in one Flask call per hour to keep it fast.

    const hourlyResults = [];  // one entry per simulated hour

    for (let h = 0; h < totalHours; h++) {
      const hourOfDay  = (start_hour + h) % 24;
      const dayIndex   = Math.floor(h / 24);

      // weather for this day
      const dayWeather = getWeatherForDay(dayIndex, weather_sequence);

      const baselineInputs = lights.map(l => ({
        lamp_type:     l.lamp_type,
        weather:       l.weather,   // current actual weather
        rated_power:   l.rated_power,
        efficiency:    l.efficiency,
        hour:          hourOfDay,
        is_night:      l.brightness > 0 ? 1 : 0,
        brightness:    parseFloat(l.brightness) || 0,
        ambient_light: parseFloat(l.ambient_light) || 5,
        health_score:  parseFloat(l.health_score),
        region_id:     l.region_id || 1,   // from DB
      }));

      // apply all interventions to proposed inputs
      const proposedInputs = lights.map(l => {
        const resolvedLampType  = lamp_replacement?.lamp_type  || l.lamp_type;
        const resolvedPower     = lamp_replacement?.rated_power || l.rated_power;
        const resolvedEfficiency = LAMP_EFFICIENCY[resolvedLampType] || l.efficiency;
        const resolvedHealth    = health_reset ? 95 : parseFloat(l.health_score);

        // brightness: use rules if provided, else legacy single value, else baseline
        let resolvedBrightness;
        if (brightness_rules && brightness_rules.length > 0) {
          resolvedBrightness = getBrightnessFromRules(hourOfDay, brightness_rules, l.zone);
        } else if (brightness !== undefined) {
          resolvedBrightness = parseFloat(brightness);
        } else {
          resolvedBrightness = parseFloat(l.brightness) || 0;
        }

        const resolvedWeather = dayWeather || weather || l.weather;

        return {
          lamp_type:     resolvedLampType,
          weather:       resolvedWeather,
          rated_power:   resolvedPower,
          efficiency:    resolvedEfficiency,
          hour:          hourOfDay,
          is_night:      resolvedBrightness > 0 ? 1 : 0,
          brightness:    resolvedBrightness,
          ambient_light: parseFloat(l.ambient_light) || 5,
          health_score:  resolvedHealth,
          region_id:     l.region_id || 1,
        };
      });

      // call Flask for this hour
      const { data } = await axios.post(
        `${FLASK_URL}/whatif`,
        { baseline: baselineInputs, proposed: proposedInputs },
        { timeout: 300000 }
      );

      // aggregate across all lights for this hour
      const hourBaseline = {
        total_energy:   data.fleet_summary.total_baseline_energy_kwh,
        avg_fault_prob: lights.reduce((s, _, i) => s + data.per_light[i].baseline_fault_prob, 0) / lights.length,
        fault_alerts:   data.fleet_summary.baseline_fault_alerts,
        avg_health:     lights.reduce((s, l) => s + parseFloat(l.health_score), 0) / lights.length,
      };
      const hourProposed = {
        total_energy:   data.fleet_summary.total_proposed_energy_kwh,
        avg_fault_prob: lights.reduce((s, _, i) => s + data.per_light[i].proposed_fault_prob, 0) / lights.length,
        fault_alerts:   data.fleet_summary.proposed_fault_alerts,
        // health degrades each simulated hour in proposed scenario too
        avg_health:     lights.reduce((s, l) => s + Math.max(0, parseFloat(l.health_score) - 0.01), 0) / lights.length,
      };

      hourlyResults.push({
        hour:     h,
        hour_of_day: hourOfDay,
        day:      dayIndex,
        baseline: hourBaseline,
        proposed: hourProposed,
        energy_saving_pct: hourBaseline.total_energy > 0
          ? parseFloat(((hourBaseline.total_energy - hourProposed.total_energy)
              / hourBaseline.total_energy * 100).toFixed(2))
          : 0,
      });
    }

    // ── per-light snapshot (first hour) for the table ─────────────────────────
    const firstHourBaseline = lights.map(l => ({
      lamp_type: l.lamp_type, weather: l.weather,
      rated_power: l.rated_power, efficiency: l.efficiency,
      hour: start_hour % 24, is_night: l.brightness > 0 ? 1 : 0,
      brightness: parseFloat(l.brightness) || 0,
      ambient_light: parseFloat(l.ambient_light) || 5,
      health_score: parseFloat(l.health_score),
      region_id:     l.region_id || 1,
    }));

    const firstHourProposed = lights.map(l => {
      const resolvedLampType   = lamp_replacement?.lamp_type   || l.lamp_type;
      const resolvedPower      = lamp_replacement?.rated_power || l.rated_power;
      const resolvedEfficiency = LAMP_EFFICIENCY[resolvedLampType] || l.efficiency;
      const resolvedHealth     = health_reset ? 95 : parseFloat(l.health_score);
      let resolvedBrightness;
      if (brightness_rules?.length > 0) {
        resolvedBrightness = getBrightnessFromRules(start_hour % 24, brightness_rules, l.zone);
      } else if (brightness !== undefined) {
        resolvedBrightness = parseFloat(brightness);
      } else {
        resolvedBrightness = parseFloat(l.brightness) || 0;
      }
      return {
        lamp_type: resolvedLampType, weather: weather || l.weather,
        rated_power: resolvedPower, efficiency: resolvedEfficiency,
        hour: start_hour % 24, is_night: resolvedBrightness > 0 ? 1 : 0,
        brightness: resolvedBrightness, ambient_light: parseFloat(l.ambient_light) || 5,
        health_score: resolvedHealth,
        region_id:     l.region_id || 1,
      };
    });

    const { data: snapshotData } = await axios.post(
      `${FLASK_URL}/whatif`,
      { baseline: firstHourBaseline, proposed: firstHourProposed },
      { timeout: 300000 }
    );

    const perLight = snapshotData.per_light.map((r, i) => ({
      ...r,
      light_id:  lights[i].light_id,
      zone:      lights[i].zone,
      lamp_type: lights[i].lamp_type,
      maintenance_cost_baseline: lights[i].maintenance_cost * (r.baseline_fault_prob > 0.5 ? 1 : 0),
      maintenance_cost_proposed: lights[i].maintenance_cost * (r.proposed_fault_prob  > 0.5 ? 1 : 0),
    }));

    const totalMaintenanceSaving = perLight.reduce(
      (s, l) => s + (l.maintenance_cost_baseline - l.maintenance_cost_proposed), 0
    );

    // ── overall KPI summary (averaged across all simulated hours) ─────────────
    const avgEnergySaving = hourlyResults.reduce((s, h) => s + h.energy_saving_pct, 0) / hourlyResults.length;
    const totalBaselineEnergy = hourlyResults.reduce((s, h) => s + h.baseline.total_energy, 0);
    const totalProposedEnergy = hourlyResults.reduce((s, h) => s + h.proposed.total_energy, 0);

    res.json({
      per_light:      perLight,
      hourly_results: hourlyResults,
      fleet_summary: {
        lights_affected:            lights.length,
        total_hours_simulated:      totalHours,
        total_days_simulated:       totalDays,
        avg_energy_saving_pct:      parseFloat(avgEnergySaving.toFixed(2)),
        total_baseline_energy_kwh:  parseFloat(totalBaselineEnergy.toFixed(4)),
        total_proposed_energy_kwh:  parseFloat(totalProposedEnergy.toFixed(4)),
        total_saving_kwh:           parseFloat((totalBaselineEnergy - totalProposedEnergy).toFixed(4)),
        total_maintenance_saving:   totalMaintenanceSaving,
        baseline_fault_alerts:      snapshotData.fleet_summary.baseline_fault_alerts,
        proposed_fault_alerts:      snapshotData.fleet_summary.proposed_fault_alerts,
        scenario: { zone, lamp_type, light_id, brightness, weather, duration, brightness_rules, lamp_replacement, health_reset }
      }
    });

  } catch (err) {
    console.error('[whatif error]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

module.exports = router;
// src/pages/Analytics.jsx
import { useEffect, useState, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts'
import client from '../api/client'
import { useTwin } from '../context/TwinContext'

const ZONE_COLORS  = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f43f5e']
const LAMP_COLORS  = { LED: '#3b82f6', HPS: '#f59e0b', MH: '#8b5cf6' }
const WEATHER_COLORS = {
  clear: '#fbbf24', cloudy: '#94a3b8', rainy: '#3b82f6',
  foggy: '#6b7280', stormy: '#7c3aed'
}
const HEALTH_BRACKETS = ['0-20', '20-40', '40-60', '60-80', '80-100']

export default function Analytics() {
  const { lights, history } = useTwin() // live fleet state from WebSocket

  const [fleetData,       setFleetData]       = useState(null)
  const [maintSummary,    setMaintSummary]    = useState(null)

  // fetch slow-changing data (history, maintenance) every 10s
  useEffect(() => {
    function loadHistory() {
      Promise.all([
        client.get('/lights/analytics/fleet'),
        client.get('/lights/analytics/maintenance-summary'),
      ])
        .then(([fleet, maint]) => {
          setFleetData(fleet.data)
          setMaintSummary(maint.data)
        })
        .catch(err => {
          console.error('Analytics load error:', err.message)
        })
    }

    loadHistory()
    const interval = setInterval(loadHistory, 10000)
    return () => clearInterval(interval)
  }, [])

  const zoneHistory = useMemo(() => {
  if (!history || Object.keys(history).length === 0) {
    return { hourly: [], by_zone: {} }
  }

  const hourMap = {}

  for (const snapshots of Object.values(history)) {
    for (const snap of snapshots) {
      const h = snap.simulated_hour

      if (!hourMap[h]) hourMap[h] = {}

      const z = snap.zone

      if (!hourMap[h][z]) {
        hourMap[h][z] = {
          total_energy: 0,
          health_sum: 0,
          health_count: 0,
          fault_count: 0,
          brightness_sum: 0,
          brightness_count: 0,
        }
      }

      const bucket = hourMap[h][z]

      bucket.total_energy += snap.energy_consumed || 0
      bucket.health_sum += snap.health_score || 0
      bucket.health_count += 1

      if (snap.fault_occurred) {
        bucket.fault_count += 1
      }

      if (snap.brightness > 0) {
        bucket.brightness_sum += snap.brightness
        bucket.brightness_count += 1
      }
    }
  }

  const hourly = Object.entries(hourMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hour, zones]) => {
      const entry = { simulated_hour: Number(hour) }

      for (const [zone, data] of Object.entries(zones)) {
        entry[`${zone}_energy`] =
          parseFloat(data.total_energy.toFixed(6))

        entry[`${zone}_health`] =
          data.health_count > 0
            ? parseFloat(
                (data.health_sum / data.health_count).toFixed(2)
              )
            : 0

        entry[`${zone}_faults`] = data.fault_count

        entry[`${zone}_brightness`] =
          data.brightness_count > 0
            ? parseFloat(
                (
                  data.brightness_sum /
                  data.brightness_count
                ).toFixed(1)
              )
            : 0
      }

      return entry
    })

  return { hourly, by_zone: {} }
}, [history])

  // ── derive snapshot stats from live WebSocket lights ───────────────────────
  // health distribution
  const healthDist = HEALTH_BRACKETS.map(bracket => {
    const [lo, hi] = bracket.split('-').map(Number)
    return {
      bracket,
      count: lights.filter(l => {
        const h = Number(l.health_score)
        return h >= lo && h < hi
      }).length
    }
  })

  // lamp type counts
  const lampCounts = lights.reduce((acc, l) => {
    acc[l.lamp_type] = (acc[l.lamp_type] || 0) + 1
    return acc
  }, {})
  const lampPieData = Object.entries(lampCounts).map(([name, value]) => ({ name, value }))

  // weather distribution
  const weatherCounts = lights.reduce((acc, l) => {
    const w = l.weather || 'clear'
    acc[w] = (acc[w] || 0) + 1
    return acc
  }, {})
  const weatherPieData = Object.entries(weatherCounts).map(([name, value]) => ({ name, value }))

  // zone status (ON / OFF / FAULT) — from live lights
  const zoneStatusMap = {}
  for (const l of lights) {
    if (!zoneStatusMap[l.zone]) zoneStatusMap[l.zone] = { zone: l.zone, ON: 0, OFF: 0, FAULT: 0 }
    if (l.fault_alert)          zoneStatusMap[l.zone].FAULT++
    else if (l.status === 'ON') zoneStatusMap[l.zone].ON++
    else                        zoneStatusMap[l.zone].OFF++
  }
  const zoneStatusData = Object.values(zoneStatusMap).sort((a, b) => a.zone.localeCompare(b.zone))

  // zones list for line chart colors
  const zones = [...new Set(lights.map(l => l.zone))].sort()

  // fleet snapshot from REST (slightly richer than WebSocket payload)
  const fleet = fleetData?.fleet

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-10">

      {/* ================================================================
          SECTION 1 — CURRENT FLEET SNAPSHOT
      ================================================================ */}
      <div>
        <h1 className="text-xl font-bold text-gray-800 mb-1">Fleet Analytics</h1>
        <p className="text-xs text-gray-400 mb-6">
          Section 1 updates live from the twin engine. Section 2 shows the
          last 24 simulated hours of history.
        </p>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[
            { label: 'Total lights',   value: lights.length                                              },
            { label: 'Lights ON',      value: lights.filter(l => l.status === 'ON').length,
              color: 'text-green-600'                                                                     },
            { label: 'Fault alerts',   value: lights.filter(l => l.fault_alert).length,
              color: 'text-red-600'                                                                       },
            { label: 'Avg health',
              value: lights.length
                ? `${(lights.reduce((s, l) => s + Number(l.health_score), 0) / lights.length).toFixed(1)}%`
                : '—',
              color: 'text-green-600'                                                                     },
            { label: 'Total energy',
              value: fleet ? `${Number(fleet.total_energy_kwh).toFixed(4)} kWh` : '—'                    },
            { label: 'Avg brightness',
              value: fleet ? `${fleet.avg_brightness}%` : '—'                                            },
          ].map(k => (
            <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <p className="text-xs text-gray-400 mb-1">{k.label}</p>
              <p className={`text-xl font-bold ${k.color || 'text-gray-700'}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* row 1: health distribution + zone status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-600 mb-1">Health score distribution</h2>
            <p className="text-xs text-gray-400 mb-4">
              How many lights fall into each health bracket right now.
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={healthDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="bracket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={v => `${v} lights`} />
                <Bar dataKey="count" name="Lights" radius={[4, 4, 0, 0]}>
                  {healthDist.map((entry, i) => {
                    const lo = parseInt(entry.bracket)
                    const color = lo >= 60 ? '#22c55e' : lo >= 40 ? '#f59e0b' : '#ef4444'
                    return <Cell key={i} fill={color} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-600 mb-1">Zone status overview</h2>
            <p className="text-xs text-gray-400 mb-4">
              ON / OFF / FAULT count per zone at this moment.
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={zoneStatusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="zone" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="ON"    fill="#22c55e" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="OFF"   fill="#cbd5e1" radius={[0, 0, 0, 0]} stackId="a" />
                <Bar dataKey="FAULT" fill="#ef4444" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>

        {/* row 2: lamp type pie + weather pie */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-600 mb-1">Lamp type breakdown</h2>
            <p className="text-xs text-gray-400 mb-4">
              Composition of the current fleet by lamp technology.
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={lampPieData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {lampPieData.map((entry, i) => (
                    <Cell key={i} fill={LAMP_COLORS[entry.name] || ZONE_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip formatter={v => `${v} lights`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-600 mb-1">Current weather distribution</h2>
            <p className="text-xs text-gray-400 mb-4">
              How many lights are currently under each weather condition.
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={weatherPieData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {weatherPieData.map((entry, i) => (
                    <Cell key={i} fill={WEATHER_COLORS[entry.name] || ZONE_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip formatter={v => `${v} lights`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

        </div>
      </div>

      {/* ================================================================
          SECTION 2 — LAST 24 SIMULATED HOURS
      ================================================================ */}
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-1">Last 24 Simulated Hours</h2>
        <p className="text-xs text-gray-400 mb-6">
          One line per zone. Charts populate as the twin engine accumulates
          history — run the simulation for at least a few minutes to see trends.
        </p>

        {!zoneHistory || zoneHistory.hourly.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8
                          text-center text-gray-400 shadow-sm">
            No history yet. The twin engine writes one row per light per tick.
            Leave the simulation running and refresh in a minute.
          </div>
        ) : (
          <div className="space-y-6">

            {/* energy per zone */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-600 mb-1">
                Total energy consumption per zone (kWh)
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                Sum of all lights in each zone per simulated hour.
                Drops to near zero during daytime hours when lights are off.
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={zoneHistory.hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="simulated_hour"
                         tickFormatter={h => `${String(h).padStart(2,'0')}:00`}
                         tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={h => `Hour ${String(h).padStart(2,'0')}:00`}
                           formatter={v => `${Number(v).toFixed(4)} kWh`} />
                  <Legend />
                  {zones.map((z, i) => (
                    <Line key={z} type="monotone"
                          dataKey={`${z}_energy`} name={z}
                          stroke={ZONE_COLORS[i % ZONE_COLORS.length]}
                          strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* avg health per zone */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-600 mb-1">
                Average health score per zone
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                Gradual downward trend is normal — reflects lamp degradation.
                Sudden upward jumps indicate maintenance events.
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={zoneHistory.hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="simulated_hour"
                         tickFormatter={h => `${String(h).padStart(2,'0')}:00`}
                         tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={h => `Hour ${String(h).padStart(2,'0')}:00`}
                           formatter={v => `${Number(v).toFixed(1)}%`} />
                  <Legend />
                  {zones.map((z, i) => (
                    <Line key={z} type="monotone"
                          dataKey={`${z}_health`} name={z}
                          stroke={ZONE_COLORS[i % ZONE_COLORS.length]}
                          strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* fault count per zone */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-600 mb-1">
                Fault count per zone
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                Number of fault events recorded per zone per simulated hour.
                Spikes during bad weather or when health scores are low.
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={zoneHistory.hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="simulated_hour"
                         tickFormatter={h => `${String(h).padStart(2,'0')}:00`}
                         tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={h => `Hour ${String(h).padStart(2,'0')}:00`}
                           formatter={v => `${v} faults`} />
                  <Legend />
                  {zones.map((z, i) => (
                    <Line key={z} type="monotone"
                          dataKey={`${z}_faults`} name={z}
                          stroke={ZONE_COLORS[i % ZONE_COLORS.length]}
                          strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* avg brightness per zone */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-600 mb-1">
                Average brightness per zone (when ON)
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                Only counts hours when lights are on. Shows the midnight
                dimming policy in action — brightness drops after 22:00.
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={zoneHistory.hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="simulated_hour"
                         tickFormatter={h => `${String(h).padStart(2,'0')}:00`}
                         tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={h => `Hour ${String(h).padStart(2,'0')}:00`}
                           formatter={v => `${Number(v).toFixed(1)}%`} />
                  <Legend />
                  {zones.map((z, i) => (
                    <Line key={z} type="monotone"
                          dataKey={`${z}_brightness`} name={z}
                          stroke={ZONE_COLORS[i % ZONE_COLORS.length]}
                          strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* zone summary table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-600">Zone summary</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-400 uppercase">
                  <tr>
                    {['Zone', 'Lights', 'Faults', 'Avg Health', 'Total Energy'].map(h => (
                      <th key={h} className="px-4 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(fleetData?.by_zone || []).map(z => (
                    <tr key={z.zone} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{z.zone}</td>
                      <td className="px-4 py-2">{z.lights}</td>
                      <td className={`px-4 py-2 font-semibold
                        ${Number(z.faults) > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {z.faults}
                      </td>
                      <td className="px-4 py-2">{z.avg_health}%</td>
                      <td className="px-4 py-2">{Number(z.total_energy_kwh).toFixed(6)} kWh</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}
      </div>

      {/* ================================================================
          SECTION 3 — MAINTENANCE LOG
      ================================================================ */}
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-1">Maintenance Log</h2>
        <p className="text-xs text-gray-400 mb-6">
          All maintenance events performed via the fleet page or individual
          light pages.
        </p>

        {!maintSummary || maintSummary.recent_events.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8
                          text-center text-gray-400 shadow-sm">
            No maintenance events yet. Use the zone maintenance bar on the
            fleet page or the maintain button on any individual light page.
          </div>
        ) : (
          <div className="space-y-6">

            {/* maintenance by zone bar */}
            {maintSummary.by_zone.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-600 mb-4">
                  Maintenance events by zone
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={maintSummary.by_zone}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="zone" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="events" fill="#f59e0b" name="Events"
                         radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* recent events table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-600">
                  Recent maintenance events (last 50)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-400 uppercase">
                    <tr>
                      {['Light', 'Zone', 'Lamp', 'Health Before',
                        'Health After', 'Scope', 'Time'].map(h => (
                        <th key={h} className="px-4 py-2 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {maintSummary.recent_events.map((e, i) => (
                      <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-700">{e.light_id}</td>
                        <td className="px-4 py-2 text-gray-500">{e.zone}</td>
                        <td className="px-4 py-2 text-gray-500">{e.lamp_type}</td>
                        <td className="px-4 py-2 text-red-500">
                          {Number(e.health_before).toFixed(1)}%
                        </td>
                        <td className="px-4 py-2 text-green-600">
                          {Number(e.health_after).toFixed(1)}%
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                            ${e.scope === 'zone'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-gray-100 text-gray-600'}`}>
                            {e.scope}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-400 text-xs">
                          {new Date(e.performed_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </div>

    </div>
  )
}
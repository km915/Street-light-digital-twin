// src/pages/MapView.jsx
import { useState, useEffect } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { useTwin } from '../context/TwinContext'
import LightMarker   from '../components/map/LightMarker'
import LocationPicker from '../components/map/LocationPicker'
import client from '../api/client'

const KGP_CENTER = [22.3149, 87.3105]
const KGP_ZOOM   = 15

const ZONES    = ['All', 'Zone-1', 'Zone-2', 'Zone-3', 'Zone-4', 'Zone-5']
const STATUSES = ['All', 'ON', 'OFF', 'FAULT']

// legend config
const LEGEND = [
  { color: '#22c55e', fill: '#86efac', label: 'ON — healthy'   },
  { color: '#f59e0b', fill: '#fde68a', label: 'Health below 30%' },
  { color: '#ef4444', fill: '#fca5a5', label: 'Fault alert'    },
  { color: '#94a3b8', fill: '#cbd5e1', label: 'OFF'            },
]

export default function MapView() {
  const { lights: wsLights } = useTwin()

  // merge WebSocket live state with coordinate data from REST
  // (WebSocket payload doesn't include lat/lng so we fetch those once)
  const [coordMap,  setCoordMap]  = useState({})   // { 'SL-001': { lat, lng }, ... }
  const [picking,   setPicking]   = useState(null)  // light being assigned a location
  const [savingId,  setSavingId]  = useState(null)

  // filters
  const [zone,   setZone]   = useState('All')
  const [status, setStatus] = useState('All')

  // fetch coordinates once on mount (and whenever a location is saved)
  const [coordVersion, setCoordVersion] = useState(0)

  useEffect(() => {
    client.get('/lights').then(res => {
      const map = {}
      for (const l of res.data) {
        if (l.latitude && l.longitude) {
          map[l.light_id] = {
            lat: Number(l.latitude),
            lng: Number(l.longitude),
          }
        }
      }
      setCoordMap(map)
    })
  }, [coordVersion])

  // merge live state with coordinates
  const enrichedLights = wsLights.map(l => ({
    ...l,
    latitude:  coordMap[l.light_id]?.lat || null,
    longitude: coordMap[l.light_id]?.lng || null,
  }))

  // apply filters
  const filtered = enrichedLights.filter(l => {
    if (zone   !== 'All' && l.zone !== zone)    return false
    if (status === 'FAULT' && !l.fault_alert)    return false
    if (status === 'ON'    && l.status !== 'ON') return false
    if (status === 'OFF'   && l.status !== 'OFF') return false
    return true
  })

  // only lights that have coordinates get markers
  const mappable   = filtered.filter(l => l.latitude && l.longitude)
  const unmapped   = enrichedLights.filter(l => !l.latitude || !l.longitude)

  async function handleSaveLocation(coords) {
    if (!picking) return
    setSavingId(picking.light_id)
    try {
      await client.patch(`/lights/${picking.light_id}/location`, {
        latitude:  coords.lat,
        longitude: coords.lng,
      })
      setCoordVersion(v => v + 1)  // re-fetch coordinates
      setPicking(null)
    } catch (err) {
      alert('Failed to save location: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingId(null)
    }
  }

  const faultCount  = mappable.filter(l => l.fault_alert).length
  const onCount     = mappable.filter(l => l.status === 'ON').length

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">

      {/* top bar */}
      <div className="bg-white dark:bg-gray-900
                      border-b border-gray-200 dark:border-gray-700
                      px-5 py-3 flex flex-wrap gap-4 items-center shrink-0">

        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          IIT Kharagpur Campus
        </span>

        {/* filters */}
        {[
          { label: 'Zone',   opts: ZONES,    val: zone,   set: setZone   },
          { label: 'Status', opts: STATUSES, val: status, set: setStatus },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {f.label}
            </span>
            <select
              value={f.val} onChange={e => f.set(e.target.value)}
              className="border border-gray-200 dark:border-gray-600
                         dark:bg-gray-800 dark:text-gray-300
                         rounded-lg px-2 py-1.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {f.opts.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}

        {/* KPIs */}
        <div className="flex gap-4 ml-auto text-xs text-gray-500 dark:text-gray-400">
          <span>
            <strong className="text-gray-700 dark:text-gray-300">{mappable.length}</strong>
            {' '}on map
          </span>
          <span>
            <strong className="text-green-600">{onCount}</strong> ON
          </span>
          <span>
            <strong className={faultCount > 0 ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'}>
              {faultCount}
            </strong>
            {' '}faults
          </span>
          {unmapped.length > 0 && (
            <span className="text-amber-500">
              {unmapped.length} lights unmapped
            </span>
          )}
        </div>
      </div>

      {/* map + sidebar layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* map */}
        <div className="flex-1 relative">
          <MapContainer
            center={KGP_CENTER}
            zoom={KGP_ZOOM}
            style={{ height: '100%', width: '100%' }}
            zoomControl={true}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>
                           &copy; <a href="https://carto.com/">CARTO</a>'
            />
            {mappable.map(light => (
              <LightMarker key={light.light_id} light={light} />
            ))}
          </MapContainer>

          {/* legend — overlaid on map */}
          <div className="absolute bottom-6 left-4 z-999
                          bg-white dark:bg-gray-900 rounded-xl shadow-lg
                          border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
              Legend
            </p>
            {LEGEND.map(l => (
              <div key={l.label} className="flex items-center gap-2 mb-1">
                <span
                  className="w-3 h-3 rounded-full border-2 shrink-0"
                  style={{ backgroundColor: l.fill, borderColor: l.color }}
                />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {l.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* right panel — unmapped lights */}
        {unmapped.length > 0 && (
          <div className="w-64 shrink-0 bg-white dark:bg-gray-900
                          border-l border-gray-200 dark:border-gray-700
                          overflow-y-auto">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Unassigned lights
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Click "Assign" to place on map.
              </p>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {unmapped.map(light => (
                <div key={light.light_id}
                  className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700
                                  dark:text-gray-300">
                      {light.light_id}
                    </p>
                    <p className="text-xs text-gray-400">
                      {light.zone} · {light.lamp_type}
                    </p>
                  </div>
                  <button
                    onClick={() => setPicking(light)}
                    className="text-xs px-3 py-1 bg-blue-50 dark:bg-blue-900
                               text-blue-600 dark:text-blue-300
                               rounded-lg border border-blue-200 dark:border-blue-700
                               hover:bg-blue-100 transition-colors"
                  >
                    Assign
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* location picker modal */}
      {picking && (
        <LocationPicker
          lightId={picking.light_id}
          currentLat={picking.latitude}
          currentLng={picking.longitude}
          onSave={handleSaveLocation}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
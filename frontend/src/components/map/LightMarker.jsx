// src/components/map/LightMarker.jsx
import { CircleMarker, Popup } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import HealthBar   from '../HealthBar'
import StatusBadge from '../StatusBadge'

function getMarkerColor(light) {
  if (light.fault_alert)              return { color: '#ef4444', fill: '#fca5a5' }
  if (Number(light.health_score) < 30) return { color: '#f59e0b', fill: '#fde68a' }
  if (light.status === 'ON')           return { color: '#22c55e', fill: '#86efac' }
  return                                      { color: '#94a3b8', fill: '#cbd5e1' }
}

export default function LightMarker({ light }) {
  const navigate = useNavigate()
  const colors   = getMarkerColor(light)

  return (
    <CircleMarker
      center={[Number(light.latitude), Number(light.longitude)]}
      radius={light.fault_alert ? 10 : 7}
      pathOptions={{
        color:       colors.color,
        fillColor:   colors.fill,
        fillOpacity: 0.9,
        weight:      2,
      }}
    >
      <Popup>
        <div className="min-w-45 space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-bold text-gray-800">{light.light_id}</span>
            <StatusBadge status={light.status} faultAlert={light.fault_alert} />
          </div>

          <p className="text-xs text-gray-400">
            {light.zone} · {light.lamp_type} · {light.rated_power}W
          </p>

          <HealthBar value={Number(light.health_score)} />

          <div className="flex justify-between text-xs text-gray-500">
            <span>Brightness: {light.brightness}%</span>
            <span>{light.weather}</span>
          </div>

          {light.fault_alert && (
            <div className="text-xs text-red-600 font-medium bg-red-50
                            rounded px-2 py-1">
              Fault risk: {(Number(light.fault_probability) * 100).toFixed(1)}%
            </div>
          )}

          <button
            onClick={() => navigate(`/light/${light.light_id}`)}
            className="w-full text-center text-xs text-blue-600
                       hover:underline mt-1"
          >
            View details
          </button>
        </div>
      </Popup>
    </CircleMarker>
  )
}
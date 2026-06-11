// src/components/LightCard.jsx
import { useNavigate } from 'react-router-dom'
import HealthBar    from './HealthBar'
import StatusBadge  from './StatusBadge'
import WeatherBadge from './WeatherBadge'

export default function LightCard({ light, onDecommission }) {
  const navigate = useNavigate()

  const borderColor = light.fault_alert
    ? 'border-red-400 dark:border-red-600'
    : Number(light.health_score) < 30
    ? 'border-amber-400 dark:border-amber-600'
    : 'border-gray-200 dark:border-gray-700'

  return (
    <div className={`bg-white dark:bg-gray-800 border-2 ${borderColor}
                     rounded-xl p-4 shadow-sm hover:shadow-md
                     transition-all duration-200 relative`}>

      {onDecommission && (
        <button
          onClick={e => { e.stopPropagation(); onDecommission() }}
          className="absolute top-2 right-2 w-5 h-5 rounded-full
                     bg-red-100 dark:bg-red-900 text-red-500 dark:text-red-400
                     text-xs flex items-center justify-center
                     hover:bg-red-200 dark:hover:bg-red-800
                     transition-colors leading-none"
          title="Decommission"
        >
          x
        </button>
      )}

      <div
        onClick={() => navigate(`/light/${light.light_id}`)}
        className="cursor-pointer"
      >
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">
              {light.light_id}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {light.zone} · {light.lamp_type}
            </p>
          </div>
          <StatusBadge status={light.status} faultAlert={light.fault_alert} />
        </div>

        <HealthBar value={Number(light.health_score)} />

        <div className="mt-3 flex justify-between items-center">
          <WeatherBadge weather={light.weather || 'clear'} />
          <div className="text-right">
            <p className="text-xs text-gray-400 dark:text-gray-500">Brightness</p>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {light.brightness}%
            </p>
          </div>
        </div>

        {light.fault_alert && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400 font-medium
                          bg-red-50 dark:bg-red-900/30 rounded px-2 py-1">
            Fault risk: {(Number(light.fault_probability) * 100).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  )
}
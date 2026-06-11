// src/components/HealthBar.jsx
export default function HealthBar({ value }) {
  const pct   = Math.max(0, Math.min(100, value))
  const color = pct > 60 ? 'bg-green-500' : pct > 30 ? 'bg-amber-400' : 'bg-red-500'

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs
                      text-gray-500 dark:text-gray-400 mb-1">
        <span>Health</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
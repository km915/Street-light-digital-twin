// src/components/WeatherBadge.jsx
const config = {
  clear:  { emoji: '',  classes: 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  cloudy: { emoji: '',  classes: 'bg-gray-100  dark:bg-gray-700      text-gray-600   dark:text-gray-300'   },
  rainy:  { emoji: '',  classes: 'bg-blue-50   dark:bg-blue-900/30   text-blue-700   dark:text-blue-400'   },
  foggy:  { emoji: '',  classes: 'bg-gray-100  dark:bg-gray-700      text-gray-500   dark:text-gray-400'   },
  stormy: { emoji: '',  classes: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
}

const LABELS = {
  clear: 'Clear', cloudy: 'Cloudy', rainy: 'Rainy',
  foggy: 'Foggy', stormy: 'Stormy'
}

export default function WeatherBadge({ weather }) {
  const w = config[weather] || config.clear
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${w.classes}`}>
      {LABELS[weather] || weather}
    </span>
  )
}
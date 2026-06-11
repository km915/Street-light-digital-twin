// src/components/StatusBadge.jsx
export default function StatusBadge({ status, faultAlert }) {
  if (faultAlert) return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold
                     bg-red-100 dark:bg-red-900/50
                     text-red-700 dark:text-red-400">
      FAULT
    </span>
  )
  if (status === 'ON') return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold
                     bg-green-100 dark:bg-green-900/50
                     text-green-700 dark:text-green-400">
      ON
    </span>
  )
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold
                     bg-gray-100 dark:bg-gray-700
                     text-gray-500 dark:text-gray-400">
      OFF
    </span>
  )
}
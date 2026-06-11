// src/components/Sidebar.jsx
import { NavLink } from 'react-router-dom'
import { useTwin } from '../context/TwinContext'

const NAV_ITEMS = [
  { to: '/',          icon: '▦', label: 'Fleet'      },
  { to: '/analytics', icon: '◈', label: 'Analytics'  },
  { to: '/whatif',    icon: '⟳', label: 'What-If'    },
  { to: '/map',       icon: '◎', label: 'Map View'   },
  { to: '/settings',  icon: '⚙', label: 'Settings'   },
]

export default function Sidebar({ expanded, onToggle }) {
  const { darkMode, toggleDarkMode } = useTwin()


  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
     transition-colors duration-150
     ${isActive
       ? 'bg-blue-600 text-white'
       : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
     }`

  return (
    <aside className={`
      fixed left-0 top-0 h-full z-40 flex flex-col
      bg-white dark:bg-gray-900
      border-r border-gray-200 dark:border-gray-700
      transition-all duration-300 ease-in-out
      ${expanded ? 'w-52' : 'w-14'}
    `}>

      {/* header */}
      <div className={`
        flex items-center h-14 px-3
        border-b border-gray-200 dark:border-gray-700
        ${expanded ? 'justify-between' : 'justify-center'}
      `}>
        {expanded && (
          <span className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate">
            Street Light Twin
          </span>
        )}
        <button
          onClick={onToggle}
          className="w-8 h-8 flex items-center justify-center rounded-lg
                     text-gray-500 dark:text-gray-400
                     hover:bg-gray-100 dark:hover:bg-gray-800
                     transition-colors text-lg"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '«' : '»'}
        </button>
      </div>

      {/* nav */}
      <nav className="flex-1 flex flex-col gap-1 p-2 overflow-hidden">
        {NAV_ITEMS.map(item => (
          <NavLink key={item.to} to={item.to} className={linkClass} title={item.label}>
            <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
            {expanded && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* dark mode toggle */}
      <div className="p-2 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={toggleDarkMode}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                     text-sm font-medium
                     text-gray-600 dark:text-gray-400
                     hover:bg-gray-100 dark:hover:bg-gray-800
                     hover:text-gray-900 dark:hover:text-gray-200
                     transition-colors duration-150"
          title={darkMode ? 'Light mode' : 'Dark mode'}
        >
          <span className="text-base w-5 text-center shrink-0">
            {darkMode ? '○' : '●'}
          </span>
          {expanded && <span>{darkMode ? 'Light mode' : 'Dark mode'}</span>}
        </button>
      </div>
    </aside>
  )
}
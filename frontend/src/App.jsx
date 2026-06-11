// src/App.jsx
import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { TwinProvider }   from './context/TwinContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar        from './components/Sidebar'
import Navbar         from './components/Navbar'
import FleetView      from './pages/FleetView'
import LightDetail    from './pages/LightDetail'
import WhatIf         from './pages/WhatIf'
import Analytics      from './pages/Analytics'
import Settings       from './pages/Settings'
import MapView        from './pages/MapView'
import Login          from './pages/Login'
import RegionSelector from './pages/RegionSelector'

function ProtectedLayout({ sidebarExpanded, setSidebarExpanded }) {
  const { user, regionId } = useAuth()
  const location = useLocation()

  if (!user)     return <Navigate to="/login"   state={{ from: location }} replace />
  if (!regionId) return <Navigate to="/regions" replace />

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded(e => !e)}
      />
      <div className={`transition-all duration-300 ${sidebarExpanded ? 'ml-52' : 'ml-14'}`}>
        <Navbar sidebarExpanded={sidebarExpanded} />
        <main className="pt-14 min-h-screen">
          <Routes>
            <Route path="/"          element={<FleetView />}   />
            <Route path="/light/:id" element={<LightDetail />} />
            <Route path="/whatif"    element={<WhatIf />}      />
            <Route path="/analytics" element={<Analytics />}   />
            <Route path="/settings"  element={<Settings />}    />
            <Route path="/map"       element={<MapView />}     />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function AppRoutes() {
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const { user, regionId } = useAuth()

  // active = user is logged in and has a region selected
  // this gates WebSocket connection and data fetching
  const isDashboard = Boolean(user && regionId)

  return (
    <TwinProvider active={isDashboard}>
      <Routes>
        <Route path="/login" element={
          user
            ? <Navigate to={regionId ? '/' : '/regions'} replace />
            : <Login />
        } />
        <Route path="/regions" element={
          !user ? <Navigate to="/login" replace /> : <RegionSelector />
        } />
        <Route path="/*" element={
          <ProtectedLayout
            sidebarExpanded={sidebarExpanded}
            setSidebarExpanded={setSidebarExpanded}
          />
        } />
      </Routes>
    </TwinProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
          <AppRoutes />
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
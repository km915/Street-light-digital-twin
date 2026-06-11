// src/components/map/LocationPicker.jsx
import { useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet'

// IIT KGP campus center
const KGP_CENTER = [22.3149, 87.3105]
const KGP_ZOOM   = 15

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng })
    }
  })
  return null
}

export default function LocationPicker({ lightId, currentLat, currentLng, onSave, onClose }) {
  const [picked, setPicked] = useState(
    currentLat && currentLng
      ? { lat: Number(currentLat), lng: Number(currentLng) }
      : null
  )

  const handlePick = useCallback((coords) => {
    setPicked(coords)
  }, [])

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center
                    bg-black bg-opacity-60">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl
                      w-full max-w-2xl mx-4 overflow-hidden">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4
                        border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">
              Assign location — {lightId}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Click anywhere on the map to place this light.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
                       text-xl font-bold w-8 h-8 flex items-center justify-center"
          >
            x
          </button>
        </div>

        {/* map */}
        <div className="h-96">
          <MapContainer
            center={picked ? [picked.lat, picked.lng] : KGP_CENTER}
            zoom={KGP_ZOOM}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>
                           &copy; <a href="https://carto.com/">CARTO</a>'
            />
            <ClickHandler onPick={handlePick} />
            {picked && (
              <CircleMarker
                center={[picked.lat, picked.lng]}
                radius={10}
                pathOptions={{
                  color: '#3b82f6', fillColor: '#93c5fd',
                  fillOpacity: 0.9, weight: 2
                }}
              />
            )}
          </MapContainer>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-5 py-4
                        border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-400">
            {picked
              ? `Selected: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}`
              : 'No location selected — click the map'
            }
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400
                         border border-gray-200 dark:border-gray-600
                         rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                         transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => picked && onSave(picked)}
              disabled={!picked}
              className="px-4 py-2 text-sm text-white bg-blue-600
                         rounded-lg hover:bg-blue-700 disabled:opacity-40
                         transition-colors font-medium"
            >
              Save location
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
import React, { useEffect, useState } from 'react';
import { Car, ZoomIn, ZoomOut } from 'lucide-react';

export function AnimatedMapMockup() {
  const [positions, setPositions] = useState([
    { id: 1, name: 'Taxi 04', speed: 45, type: 'ring', duration: '25s', status: 'Libre', color: 'emerald' },
    { id: 2, name: 'Taxi 12', speed: 60, type: 'diagonal1', duration: '15s', status: 'Ocupado', color: 'amber' },
    { id: 3, name: 'Taxi 08', speed: 50, type: 'diagonal2', duration: '20s', status: 'Libre', color: 'emerald' },
  ]);

  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedTaxiId, setSelectedTaxiId] = useState<number | null>(1); // Auto-select first taxi

  // Update speeds randomly
  useEffect(() => {
    const timer = setInterval(() => {
      setPositions(prev => prev.map(p => {
        const speedDelta = Math.floor(Math.random() * 11) - 5;
        return { ...p, speed: Math.max(15, Math.min(80, p.speed + speedDelta)) };
      }));
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full aspect-[4/3] sm:aspect-auto sm:h-[450px] bg-[#e2e8f0] rounded-[2.5rem] overflow-hidden shadow-2xl border-[6px] border-white">
      
      {/* Background Realistic City Map (Generated Image) */}
      <div 
        className="absolute inset-0 w-full h-full bg-center bg-no-repeat transition-transform duration-700 ease-in-out transform-gpu will-change-transform"
        style={{ 
            backgroundImage: "url('/city-map.jpg')", 
            backgroundSize: 'cover',
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'center center'
        }}
      >
        {/* Animated Cars using CSS offset-path aligned with the radial city structure */}
        {positions.map((unit, index) => {
          const isSelected = selectedTaxiId === unit.id;
          
          return (
          <React.Fragment key={unit.id}>
            {/* 1. The Rotating Car */}
            <div 
                 onClick={() => setSelectedTaxiId(isSelected ? null : unit.id)}
                 className={`absolute z-20 flex items-center justify-center bg-amber-400 w-8 h-8 rounded-lg shadow-xl border-2 border-white cursor-pointer pointer-events-auto transition-transform transform-gpu will-change-transform ${isSelected ? 'scale-125' : 'hover:scale-110'} ${unit.type}`}
                 style={{ 
                    animationDuration: unit.duration,
                    animationDelay: `-${index * 5}s`
                 }}>
              <Car size={18} className="text-amber-900" weight="fill" />
            </div>

            {/* 2. The Upright Label */}
            <div className={`absolute z-30 pointer-events-none transform-gpu will-change-transform ${unit.type}-label`}
                 style={{ 
                    animationDuration: unit.duration,
                    animationDelay: `-${index * 5}s`
                 }}>
              {/* Dynamic Popup Card */}
              <div 
                onClick={() => setSelectedTaxiId(isSelected ? null : unit.id)}
                className={`absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm border-2 border-slate-200 shadow-2xl flex flex-col items-center pointer-events-auto cursor-pointer transition-all duration-300 ease-out origin-bottom ${isSelected ? 'rounded-2xl p-3 min-w-[120px] scale-100 opacity-100' : 'rounded-xl px-3 py-1.5 min-w-[60px] scale-90 opacity-90 hover:scale-100'}`}
              >
                {isSelected ? (
                  <div className="flex flex-col w-full animate-fade-in">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-1.5 mb-1.5 w-full">
                      <span className="text-xs font-black text-slate-900">{unit.name}</span>
                      <span className={`w-2 h-2 rounded-full bg-${unit.color}-500 ${unit.color === 'emerald' ? 'animate-ping' : ''}`} />
                    </div>
                    <div className="flex justify-between items-end w-full mb-1">
                      <span className="text-[9px] font-bold text-slate-500">Velocidad:</span>
                      <span className="text-sm font-black text-amber-600 leading-none">{unit.speed} <span className="text-[9px] text-slate-400">km/h</span></span>
                    </div>
                    <div className="flex justify-between items-center w-full">
                      <span className="text-[9px] font-bold text-slate-500">Estado:</span>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md text-${unit.color}-700 bg-${unit.color}-100 border border-${unit.color}-200`}>
                        {unit.status}
                      </span>
                    </div>
                  </div>
                ) : (
                  <span className="text-xs font-extrabold text-slate-900 whitespace-nowrap leading-tight">{unit.name}</span>
                )}
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-r-2 border-b-2 border-slate-200 rotate-45" />
              </div>
            </div>
          </React.Fragment>
        )})}
      </div>

      {/* Map UI Overlay */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-auto z-10">
        <div className="bg-white/95 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 shadow-md flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
          <span className="text-xs font-black text-slate-700 uppercase tracking-widest">Vista Global Real</span>
        </div>
        
        {/* Interactive Zoom Controls */}
        <div className="flex flex-col gap-2">
          <button 
            onClick={() => setZoomLevel(z => Math.min(2.5, z + 0.3))}
            className="w-10 h-10 bg-white/95 backdrop-blur-md border border-slate-200 rounded-full shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors"
            title="Acercar (Más Zoom)"
          >
            <ZoomIn size={18} className="text-slate-700" />
          </button>
          <button 
            onClick={() => setZoomLevel(z => Math.max(1, z - 0.3))}
            className="w-10 h-10 bg-white/95 backdrop-blur-md border border-slate-200 rounded-full shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors"
            title="Alejar (Menos Zoom)"
          >
            <ZoomOut size={18} className="text-slate-700" />
          </button>
        </div>
      </div>

      {/* Floating Info Overlay */}
      <div className="absolute bottom-4 left-4 right-16 sm:right-4 bg-white/95 backdrop-blur-md border border-slate-200 p-4 rounded-3xl shadow-2xl flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 shrink-0">
            <Car size={24} className="text-blue-600" />
          </div>
          <div>
            <h5 className="text-sm sm:text-base font-black text-slate-900">Control de Ciudad</h5>
            <p className="text-[10px] sm:text-xs text-slate-500 font-bold leading-tight">Mapeo de calles en tiempo real</p>
          </div>
        </div>
      </div>

      <style>{`
        /* 
           The background image is a radial city. 
           We use offset-path to align the cars perfectly with the circular and diagonal streets!
        */
        
        /* 1. Ring Road */
        .ring {
          offset-path: circle(12% at 50% 50%);
          offset-rotate: 0deg;
          animation: drive linear infinite;
        }
        .ring-label {
          offset-path: circle(12% at 50% 50%);
          offset-rotate: 0deg;
          animation: drive linear infinite;
        }

        /* 2. Diagonal Avenue (Top-Right to Center) */
        .diagonal1 {
          offset-path: path("M 80% 20% L 55% 45%");
          offset-rotate: 0deg;
          animation: drive alternate linear infinite;
        }
        .diagonal1-label {
          offset-path: path("M 80% 20% L 55% 45%");
          offset-rotate: 0deg;
          animation: drive alternate linear infinite;
        }

        /* 3. Horizontal Avenue (Bottom-Left to Center) */
        .diagonal2 {
          offset-path: path("M 10% 70% L 40% 60%");
          offset-rotate: 0deg;
          animation: drive alternate linear infinite;
        }
        .diagonal2-label {
          offset-path: path("M 10% 70% L 40% 60%");
          offset-rotate: 0deg;
          animation: drive alternate linear infinite;
        }

        @keyframes drive {
          0% { offset-distance: 0%; }
          100% { offset-distance: 100%; }
        }
      `}</style>
    </div>
  );
}

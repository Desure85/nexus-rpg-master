import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import * as d3 from 'd3';
import { Location } from '../types';
import { 
  MapPin, Lock, Eye, Target, Footprints, Navigation, Plus, Minus, 
  Maximize2, Minimize2, Move, RefreshCw, Trees, Mountain, Castle, 
  Waves, Skull, Home, Tent, Landmark, Wand2 
} from 'lucide-react';

interface LocationMapProps {
  locations: Location[];
  currentLocationId?: string;
  onTravel?: (id: string) => void;
  onExplore?: (id: string) => void;
  onLocationUpdate?: (locations: Location[]) => void;
}

// Helper to choose icon based on name
const getLocationIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes('forest') || n.includes('wood') || n.includes('grove') || n.includes('jungle')) return Trees;
  if (n.includes('mountain') || n.includes('hill') || n.includes('cliff') || n.includes('peak')) return Mountain;
  if (n.includes('cave') || n.includes('dungeon') || n.includes('crypt') || n.includes('mine') || n.includes('tomb')) return Skull;
  if (n.includes('castle') || n.includes('keep') || n.includes('fort') || n.includes('tower') || n.includes('palace')) return Castle;
  if (n.includes('river') || n.includes('lake') || n.includes('sea') || n.includes('ocean') || n.includes('bridge') || n.includes('water')) return Waves;
  if (n.includes('village') || n.includes('town') || n.includes('city') || n.includes('home') || n.includes('house')) return Home;
  if (n.includes('camp') || n.includes('outpost') || n.includes('tent')) return Tent;
  if (n.includes('ruin') || n.includes('temple') || n.includes('shrine') || n.includes('monument')) return Landmark;
  return MapPin;
};

// Helper for danger color
const getDangerColor = (level: number = 1) => {
  if (level >= 4) return 'border-red-500 text-red-500 shadow-red-500/20';
  if (level === 3) return 'border-amber-500 text-amber-500 shadow-amber-500/20';
  return 'border-emerald-500 text-emerald-500 shadow-emerald-500/20';
};

export const LocationMap: React.FC<LocationMapProps> = ({ locations, currentLocationId, onTravel, onExplore, onLocationUpdate }) => {
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [draggedNode, setDraggedNode] = useState<{ id: string, x: number, y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset processing state when location data changes
  useEffect(() => {
    setIsProcessing(false);
  }, [locations, currentLocationId]);

  // Calculate connections for rendering lines
  const connections = locations.flatMap(loc => 
    (loc.connections || []).map(targetId => {
      const target = locations.find(l => l.id === targetId);
      if (!target || loc.id > target.id) return null; // Avoid duplicate lines
      return { source: loc, target };
    })
  ).filter(Boolean) as { source: Location; target: Location }[];

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.2, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.2, 0.5));
  const handleReset = () => setZoom(1);

  const handleAutoLayout = () => {
    if (!onLocationUpdate) return;

    // 1. Initialize nodes with significant jitter to break symmetry
    // If coordinates are missing or default (50,50), spread them out randomly
    const nodes = locations.map(l => {
      const isDefault = !l.coordinates || (l.coordinates.x === 50 && l.coordinates.y === 50);
      return { 
        ...l, 
        x: isDefault ? Math.random() * 100 : (l.coordinates?.x ?? 50), 
        y: isDefault ? Math.random() * 100 : (l.coordinates?.y ?? 50)
      };
    });
    
    const links = connections.map(c => ({
      source: c.source.id,
      target: c.target.id
    }));

    // 2. Run Simulation
    // Use a larger coordinate system (0-1000) for better precision during simulation, then scale back
    const simulation = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(150)) // Longer links
      .force("charge", d3.forceManyBody().strength(-800)) // Stronger repulsion
      .force("center", d3.forceCenter(500, 500)) // Center in 1000x1000 space
      .force("collide", d3.forceCollide().radius(80).iterations(3)) // Larger collision radius
      .stop();

    // Run simulation for enough ticks
    for (let i = 0; i < 300; ++i) simulation.tick();

    // 3. Normalize Coordinates to fit 10-90% range
    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n: any) => {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });

    // Add padding to bounds to prevent edge sticking
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;

    const updatedLocations = locations.map(l => {
      const node = nodes.find(n => n.id === l.id) as any;
      if (node) {
        // Scale to 15-85 range to keep away from edges
        const nx = ((node.x - minX) / width) * 70 + 15;
        const ny = ((node.y - minY) / height) * 70 + 15;
        
        return {
          ...l,
          coordinates: {
            x: Math.max(5, Math.min(95, nx)),
            y: Math.max(5, Math.min(95, ny))
          }
        };
      }
      return l;
    });

    onLocationUpdate(updatedLocations);
  };

  const handleAction = (action: () => void) => {
    setIsProcessing(true);
    action();
  };

  const handleNodeDrag = (id: string, info: any) => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    
    // Calculate delta in percentage relative to the unscaled container
    // info.offset is the total distance from the start of the drag in screen pixels
    const deltaX = info.offset.x / zoom;
    const deltaY = info.offset.y / zoom;
    
    const percentDeltaX = (deltaX / containerRect.width) * 100;
    const percentDeltaY = (deltaY / containerRect.height) * 100;
    
    const originalLoc = locations.find(l => l.id === id);
    if (originalLoc) {
      setDraggedNode({
        id,
        x: (originalLoc.coordinates?.x ?? 50) + percentDeltaX,
        y: (originalLoc.coordinates?.y ?? 50) + percentDeltaY
      });
    }
  };

  const handleNodeDragEnd = (id: string, info: any) => {
    if (!onLocationUpdate || !containerRef.current) {
      setDraggedNode(null);
      return;
    }
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const deltaX = info.offset.x / zoom;
    const deltaY = info.offset.y / zoom;
    
    const percentDeltaX = (deltaX / containerRect.width) * 100;
    const percentDeltaY = (deltaY / containerRect.height) * 100;
    
    const updatedLocations = locations.map(loc => {
      if (loc.id === id) {
        return {
          ...loc,
          coordinates: {
            x: Math.max(0, Math.min(100, (loc.coordinates?.x ?? 50) + percentDeltaX)),
            y: Math.max(0, Math.min(100, (loc.coordinates?.y ?? 50) + percentDeltaY))
          }
        };
      }
      return loc;
    });
    
    onLocationUpdate(updatedLocations);
    setDraggedNode(null);
  };

  const getLocPos = (loc: Location) => {
    if (draggedNode && draggedNode.id === loc.id) {
      return { x: draggedNode.x, y: draggedNode.y };
    }
    return { x: loc.coordinates?.x ?? 50, y: loc.coordinates?.y ?? 50 };
  };

  const MapContent = (
    <div 
      ref={containerRef}
      className={`bg-[#0a0a0a] rounded-xl overflow-hidden border border-white/10 shadow-inner group/map ${
        isMaximized ? 'fixed inset-4 z-[9999] shadow-2xl border-white/20' : 'relative w-full aspect-square'
      }`}
    >
      {/* Grid Background */}
      <div className="absolute inset-0 opacity-20 pointer-events-none" 
        style={{ 
          backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)', 
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: 'center'
        }} 
      />
      
      {/* Map Container - Draggable & Zoomable */}
      <motion.div 
        key={isMaximized ? 'maximized' : 'minimized'}
        className="w-full h-full cursor-move"
        drag
        dragElastic={0.1}
        initial={{ x: 0, y: 0, scale: zoom }}
        animate={{ scale: zoom }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      >
        <div className="relative w-full h-full origin-center flex items-center justify-center">
           {/* Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
            {connections.map(({ source, target }, i) => {
              const sPos = getLocPos(source);
              const tPos = getLocPos(target);
              return (
                <motion.line
                  key={`${source.id}-${target.id}`}
                  animate={{ 
                    x1: `${sPos.x}%`,
                    y1: `${sPos.y}%`,
                    x2: `${tPos.x}%`,
                    y2: `${tPos.y}%`,
                    pathLength: 1,
                    opacity: 1
                  }}
                  initial={{ pathLength: 0, opacity: 0 }}
                  transition={{
                    x1: { duration: 0 },
                    y1: { duration: 0 },
                    x2: { duration: 0 },
                    y2: { duration: 0 },
                    pathLength: { duration: 1, delay: i * 0.1 },
                    opacity: { duration: 1, delay: i * 0.1 }
                  }}
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={2 / zoom}
                />
              );
            })}
          </svg>

          {/* Locations */}
          {locations.map((loc) => {
            const isCurrent = loc.id === currentLocationId;
            const isLocked = loc.status === 'locked';
            const isKnown = loc.status === 'known';
            const isHovered = hoveredLocation === loc.id;
            
            // Use original coordinates for the base position
            const originalX = loc.coordinates?.x ?? 50;
            const originalY = loc.coordinates?.y ?? 50;
            
            const Icon = getLocationIcon(loc.name);
            const dangerClass = getDangerColor(loc.dangerLevel);

            return (
              <motion.div
                key={loc.id}
                className="absolute z-10"
                style={{ 
                  left: `${originalX}%`, 
                  top: `${originalY}%`,
                  // Use negative margins instead of transforms to center the node.
                  // This avoids conflicts with Framer Motion's drag transform.
                  marginLeft: `-${16 / zoom}px`,
                  marginTop: `-${16 / zoom}px`,
                  width: `${32 / zoom}px`,
                  height: `${32 / zoom}px`,
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileHover={{ scale: 1.1, zIndex: 20 }}
                onMouseEnter={() => setHoveredLocation(loc.id)}
                onMouseLeave={() => setHoveredLocation(null)}
                drag={!!onLocationUpdate}
                dragMomentum={false}
                dragElastic={0}
                onDragStart={(e) => e.stopPropagation()}
                onDrag={(e, info) => handleNodeDrag(loc.id, info)}
                onDragEnd={(e, info) => handleNodeDragEnd(loc.id, info)}
                whileDrag={{ scale: 1.2, zIndex: 50, cursor: 'grabbing' }}
              >
                {/* Node Visual */}
                <div 
                  className={`relative w-full h-full rounded-full flex items-center justify-center border-2 transition-colors cursor-pointer shadow-lg bg-[#0a0a0a] ${
                    isCurrent 
                      ? 'border-white text-white shadow-white/20' 
                      : isLocked
                        ? 'border-zinc-700 text-zinc-700 bg-zinc-900'
                        : isKnown
                          ? dangerClass
                          : 'border-white/20 text-white/60'
                  }`}
                  style={{ 
                    borderWidth: `${2 / zoom}px`
                  }}
                >
                  {isCurrent && (
                    <div className="absolute inset-0 rounded-full animate-ping bg-white/20" />
                  )}
                  
                  {isLocked ? <Lock size={12 / zoom} /> : <Icon size={14 / zoom} />}
                  
                  {/* Danger Indicator for Current/Known */}
                  {!isLocked && loc.dangerLevel && loc.dangerLevel > 1 && (
                    <div 
                      className={`absolute -bottom-1 -right-1 rounded-full border border-[#0a0a0a] flex items-center justify-center text-[8px] font-bold
                        ${loc.dangerLevel >= 4 ? 'bg-red-500 text-black' : loc.dangerLevel === 3 ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'}
                      `}
                      style={{ 
                        width: `${12 / zoom}px`, 
                        height: `${12 / zoom}px`,
                        fontSize: `${8 / zoom}px`
                      }}
                    >
                      {loc.dangerLevel}
                    </div>
                  )}
                </div>

                {/* Label */}
                <div 
                  className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap px-2 py-1 rounded bg-black/80 border border-white/10 font-bold text-white pointer-events-none transition-opacity ${isHovered || isCurrent ? 'opacity-100' : 'opacity-0 group-hover/map:opacity-60'}`}
                  style={{ fontSize: `${10 / zoom}px` }}
                >
                  {loc.name}
                </div>

                {/* Interaction Menu (on hover) */}
                <AnimatePresence>
                  {isHovered && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8, y: 5 }}
                      className="absolute top-full left-1/2 -translate-x-1/2 flex flex-col gap-1 bg-black/90 border border-white/20 p-2 rounded-lg z-30 min-w-[120px] shadow-xl backdrop-blur-sm"
                      style={{ marginTop: `${8 / zoom}px`, transform: `scale(${1/zoom})`, transformOrigin: 'top center' }}
                    >
                      <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1 px-1 border-b border-white/10 pb-1">
                        {loc.name}
                      </div>
                      
                      {isCurrent && onExplore && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAction(() => onExplore(loc.id)); }}
                          disabled={isProcessing}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-bold transition-colors text-left ${isProcessing ? 'opacity-50 cursor-wait' : 'hover:bg-emerald-500/20 text-emerald-400'}`}
                        >
                          <Target size={12} /> {isProcessing ? 'Exploring...' : 'Explore'}
                        </button>
                      )}
                      
                      {!isCurrent && !isLocked && onTravel && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAction(() => onTravel(loc.id)); }}
                          disabled={isProcessing}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-bold transition-colors text-left ${isProcessing ? 'opacity-50 cursor-wait' : 'hover:bg-white/10 text-white'}`}
                        >
                          <Footprints size={12} /> {isProcessing ? 'Traveling...' : 'Travel'}
                        </button>
                      )}
                      
                      {isLocked && (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-red-400 text-xs font-bold opacity-60 cursor-not-allowed">
                          <Lock size={12} /> Locked
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
      
      {/* Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-1 z-40">
        <button 
          onClick={handleAutoLayout}
          className="p-2 bg-black/60 backdrop-blur border border-white/10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title="Auto Layout"
        >
          <Wand2 size={16} />
        </button>
        <div className="h-2" />
        <button 
          onClick={handleZoomIn}
          className="p-2 bg-black/60 backdrop-blur border border-white/10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title="Zoom In"
        >
          <Plus size={16} />
        </button>
        <button 
          onClick={handleZoomOut}
          className="p-2 bg-black/60 backdrop-blur border border-white/10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title="Zoom Out"
        >
          <Minus size={16} />
        </button>
        <button 
          onClick={handleReset}
          className="p-2 bg-black/60 backdrop-blur border border-white/10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title="Reset View"
        >
          <RefreshCw size={16} />
        </button>
        <div className="h-2" />
        <button 
          onClick={() => setIsMaximized(!isMaximized)}
          className="p-2 bg-black/60 backdrop-blur border border-white/10 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title={isMaximized ? "Minimize" : "Maximize"}
        >
          {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-40 pointer-events-none">
        <div className="bg-black/60 backdrop-blur p-2 rounded-lg border border-white/10 text-[10px] text-white/40 space-y-1 pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white border border-white" /> Current
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full border border-emerald-500 text-emerald-500" /> Safe (1-2)
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full border border-amber-500 text-amber-500" /> Risky (3)
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full border border-red-500 text-red-500" /> Deadly (4-5)
          </div>
        </div>
      </div>
    </div>
  );

  if (isMaximized) {
    return createPortal(
      <>
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9990]" 
          onClick={() => setIsMaximized(false)}
        />
        {MapContent}
      </>, 
      document.body
    );
  }

  return MapContent;
};

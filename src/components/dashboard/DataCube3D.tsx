import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DollarSign, Users, TrendingUp, Clock, Percent, Target } from 'lucide-react';

interface CubeFace {
  metrics: {
    label: string;
    value: string;
    icon: React.ReactNode;
  }[];
}

interface DataCube3DProps {
  title: string;
  faces: CubeFace[];
  accentColor?: string;
  autoRotateInterval?: number;
  className?: string;
}

export function DataCube3D({
  title,
  faces,
  accentColor = '#14B8A6',
  autoRotateInterval = 10000,
  className,
}: DataCube3DProps) {
  const [currentFace, setCurrentFace] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  
  const totalFaces = Math.min(faces.length, 4);
  
  const rotateTo = useCallback((faceIndex: number) => {
    if (isAnimating || faceIndex === currentFace) return;
    setIsAnimating(true);
    setCurrentFace(faceIndex);
    setTimeout(() => setIsAnimating(false), 600);
  }, [isAnimating, currentFace]);
  
  const rotateNext = useCallback(() => {
    const nextFace = (currentFace + 1) % totalFaces;
    rotateTo(nextFace);
  }, [currentFace, totalFaces, rotateTo]);
  
  // Auto-rotate
  useEffect(() => {
    if (totalFaces <= 1) return;
    
    const interval = setInterval(() => {
      rotateNext();
    }, autoRotateInterval);
    
    return () => clearInterval(interval);
  }, [rotateNext, autoRotateInterval, totalFaces]);
  
  const handleClick = () => {
    if (totalFaces > 1) {
      rotateNext();
    }
  };
  
  // Calculate rotation based on current face
  const getRotation = () => {
    const rotations = [0, -90, -180, -270];
    return rotations[currentFace] || 0;
  };

  return (
    <div className={cn("relative", className)}>
      {/* Title */}
      <div 
        className="text-sm font-semibold mb-2 text-center"
        style={{ color: accentColor }}
      >
        {title}
      </div>
      
      {/* 3D Cube Container */}
      <div 
        className="relative w-full aspect-square cursor-pointer perspective-[800px]"
        onClick={handleClick}
        style={{ minHeight: '160px' }}
      >
        {/* Cube */}
        <div
          className="absolute inset-0 transform-style-3d transition-transform duration-500 ease-out"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateY(${getRotation()}deg)`,
          }}
        >
          {/* Front Face (0) */}
          <CubeFaceComponent
            face={faces[0]}
            accentColor={accentColor}
            style={{
              transform: 'translateZ(80px)',
            }}
          />
          
          {/* Right Face (1) */}
          {totalFaces > 1 && (
            <CubeFaceComponent
              face={faces[1]}
              accentColor={accentColor}
              style={{
                transform: 'rotateY(90deg) translateZ(80px)',
              }}
            />
          )}
          
          {/* Back Face (2) */}
          {totalFaces > 2 && (
            <CubeFaceComponent
              face={faces[2]}
              accentColor={accentColor}
              style={{
                transform: 'rotateY(180deg) translateZ(80px)',
              }}
            />
          )}
          
          {/* Left Face (3) */}
          {totalFaces > 3 && (
            <CubeFaceComponent
              face={faces[3]}
              accentColor={accentColor}
              style={{
                transform: 'rotateY(270deg) translateZ(80px)',
              }}
            />
          )}
        </div>
      </div>
      
      {/* Face Indicator */}
      {totalFaces > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {Array.from({ length: totalFaces }).map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                rotateTo(index);
              }}
              className={cn(
                "w-4 h-1 rounded-full transition-all duration-300",
                index === currentFace
                  ? "opacity-100"
                  : "opacity-30 hover:opacity-50"
              )}
              style={{
                backgroundColor: accentColor,
                transform: `rotate(-15deg)`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CubeFaceComponentProps {
  face?: CubeFace;
  accentColor: string;
  style: React.CSSProperties;
}

function CubeFaceComponent({ face, accentColor, style }: CubeFaceComponentProps) {
  if (!face) return null;
  
  return (
    <div
      className="absolute inset-0 rounded-xl border border-border/50 bg-card/95 backdrop-blur-sm shadow-lg flex flex-col items-center justify-center p-4 backface-hidden"
      style={{
        ...style,
        backfaceVisibility: 'hidden',
      }}
    >
      <div className="w-full space-y-3">
        {face.metrics.map((metric, index) => (
          <div key={index} className="flex items-center gap-3">
            <div
              className="p-1.5 rounded-lg"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <div style={{ color: accentColor }}>
                {metric.icon}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold text-foreground truncate">
                {metric.value}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {metric.label}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Demo component to showcase the 3D cube
export function DataCube3DDemo() {
  const demoFaces: CubeFace[] = [
    {
      metrics: [
        { label: 'Sales Today', value: '$2,450', icon: <DollarSign className="w-4 h-4" /> },
        { label: 'Guests Today', value: '127', icon: <Users className="w-4 h-4" /> },
        { label: 'Avg Ticket', value: '$19.29', icon: <TrendingUp className="w-4 h-4" /> },
      ],
    },
    {
      metrics: [
        { label: 'Sales WTD', value: '$14,200', icon: <DollarSign className="w-4 h-4" /> },
        { label: 'Guests WTD', value: '742', icon: <Users className="w-4 h-4" /> },
        { label: 'Labor %', value: '24.5%', icon: <Percent className="w-4 h-4" /> },
      ],
    },
    {
      metrics: [
        { label: 'Sales MTD', value: '$52,800', icon: <DollarSign className="w-4 h-4" /> },
        { label: 'Hours Today', value: '48.5', icon: <Clock className="w-4 h-4" /> },
        { label: 'Target %', value: '102%', icon: <Target className="w-4 h-4" /> },
      ],
    },
    {
      metrics: [
        { label: 'Proj. Sales', value: '$68,400', icon: <TrendingUp className="w-4 h-4" /> },
        { label: 'Scheduled Hrs', value: '312', icon: <Clock className="w-4 h-4" /> },
        { label: 'Variance', value: '+$1,200', icon: <DollarSign className="w-4 h-4" /> },
      ],
    },
  ];

  return (
    <div className="p-6 space-y-8">
      <h2 className="text-xl font-bold text-foreground">3D Cube Prototype</h2>
      <p className="text-muted-foreground text-sm">Click the cubes to rotate, or wait 10 seconds for auto-rotation. Use the indicators to jump to a specific face.</p>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {/* 4-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">4 Faces</div>
          <DataCube3D
            title="Performance Overview"
            faces={demoFaces}
            accentColor="#14B8A6"
          />
        </div>
        
        {/* 3-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">3 Faces</div>
          <DataCube3D
            title="Sales Metrics"
            faces={demoFaces.slice(0, 3)}
            accentColor="#8B5CF6"
          />
        </div>
        
        {/* 2-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">2 Faces</div>
          <DataCube3D
            title="Quick Stats"
            faces={demoFaces.slice(0, 2)}
            accentColor="#F59E0B"
          />
        </div>
        
        {/* 1-face cube (no rotation) */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">1 Face</div>
          <DataCube3D
            title="Daily Summary"
            faces={demoFaces.slice(0, 1)}
            accentColor="#EC4899"
          />
        </div>
      </div>
    </div>
  );
}

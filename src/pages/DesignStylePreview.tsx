import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Calendar, MessageSquare, CheckSquare, BookOpen, Clock, Flame, Check, ListChecks } from "lucide-react";
import { useNavigate } from "react-router-dom";

type StyleOption = 'current' | 'full-3d' | 'flat-minimal' | 'glassmorphism' | 'sharp-edge';

const DesignStylePreview = () => {
  const navigate = useNavigate();
  const [activeStyle, setActiveStyle] = useState<StyleOption>('current');

  const styleOptions: { id: StyleOption; name: string; description: string }[] = [
    { id: 'current', name: 'Current (Hybrid)', description: '3D dock + cubes, 2D cards' },
    { id: 'full-3d', name: 'Full 3D / Neumorphic', description: 'Everything has depth & shadows' },
    { id: 'sharp-edge', name: 'Sharp Edge', description: 'Square corners, bold & geometric' },
    { id: 'flat-minimal', name: 'Flat Minimal', description: 'Clean 2D, subtle borders' },
    { id: 'glassmorphism', name: 'Glassmorphism', description: 'Frosted glass + blur effects' },
  ];

  // Style-specific classes - Current matches actual dashboard components
  const getTaskCardStyle = (style: StyleOption, accentColor: string = 'hsl(var(--accent))') => {
    switch (style) {
      case 'full-3d':
        return {
          card: 'bg-card rounded-2xl shadow-[6px_6px_12px_rgba(0,0,0,0.12),-3px_-3px_8px_rgba(255,255,255,0.08)] border-0 overflow-hidden',
          borderStyle: { borderLeft: `4px solid ${accentColor}` },
        };
      case 'sharp-edge':
        return {
          card: 'bg-card rounded-none shadow-[4px_4px_0px_rgba(0,0,0,0.15)] border-2 border-foreground/10 overflow-hidden',
          borderStyle: { borderLeft: `5px solid ${accentColor}` },
        };
      case 'flat-minimal':
        return {
          card: 'bg-card rounded-lg border border-border/50 shadow-none overflow-hidden',
          borderStyle: { borderLeft: `4px solid ${accentColor}` },
        };
      case 'glassmorphism':
        return {
          card: 'bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg overflow-hidden',
          borderStyle: { borderLeft: `4px solid ${accentColor}` },
        };
      default:
        // Current: matches TemporaryTaskCard - Card with left border accent
        return {
          card: 'bg-card rounded-xl border shadow-sm overflow-hidden',
          borderStyle: { borderLeft: `4px solid ${accentColor}` },
        };
    }
  };

  const getButtonStyle = (style: StyleOption, variant: 'primary' | 'secondary' = 'primary') => {
    if (variant === 'primary') {
      switch (style) {
        case 'full-3d':
          return 'bg-primary text-primary-foreground rounded-xl shadow-[4px_4px_8px_rgba(0,0,0,0.2),-2px_-2px_6px_rgba(255,255,255,0.1)] border-0 hover:shadow-[2px_2px_4px_rgba(0,0,0,0.2)] active:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.2)] transition-all';
        case 'sharp-edge':
          return 'bg-primary text-primary-foreground rounded-none shadow-[3px_3px_0px_rgba(0,0,0,0.2)] border-0 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_rgba(0,0,0,0.2)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all';
        case 'flat-minimal':
          return 'bg-primary text-primary-foreground rounded-md shadow-none border-0 hover:bg-primary/90';
        case 'glassmorphism':
          return 'bg-primary/80 backdrop-blur-sm text-primary-foreground rounded-xl border border-primary/30 shadow-lg hover:bg-primary/90';
        default:
          // Current: matches actual button styling
          return 'bg-primary text-primary-foreground rounded-lg shadow-sm';
      }
    } else {
      switch (style) {
        case 'full-3d':
          return 'bg-muted text-muted-foreground rounded-xl shadow-[4px_4px_8px_rgba(0,0,0,0.1),-2px_-2px_6px_rgba(255,255,255,0.05)] border-0 hover:shadow-[2px_2px_4px_rgba(0,0,0,0.1)] transition-all';
        case 'sharp-edge':
          return 'bg-muted text-muted-foreground rounded-none shadow-[2px_2px_0px_rgba(0,0,0,0.1)] border border-foreground/10 hover:translate-x-[1px] hover:translate-y-[1px] transition-all';
        case 'flat-minimal':
          return 'bg-transparent text-muted-foreground rounded-md border border-border hover:bg-muted/50';
        case 'glassmorphism':
          return 'bg-white/5 backdrop-blur-sm text-foreground rounded-xl border border-white/10 hover:bg-white/10';
        default:
          return 'bg-muted text-muted-foreground rounded-lg border';
      }
    }
  };

  const getChecklistCardStyle = (style: StyleOption, accentColor: string = '#8B5CF6') => {
    switch (style) {
      case 'full-3d':
        return {
          card: 'aspect-square rounded-2xl shadow-[8px_8px_16px_rgba(0,0,0,0.15),-4px_-4px_12px_rgba(255,255,255,0.1)] border-0 overflow-hidden cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all',
          background: `linear-gradient(135deg, ${accentColor}20 0%, ${accentColor}35 100%)`,
        };
      case 'sharp-edge':
        return {
          card: 'aspect-square rounded-none shadow-[5px_5px_0px_rgba(0,0,0,0.12)] border-2 overflow-hidden cursor-pointer hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0px_rgba(0,0,0,0.12)] transition-all',
          background: `${accentColor}15`,
          borderColor: accentColor,
        };
      case 'flat-minimal':
        return {
          card: 'aspect-square rounded-lg border border-border/50 shadow-none overflow-hidden cursor-pointer hover:bg-muted/50 transition-all',
          background: 'hsl(var(--card))',
        };
      case 'glassmorphism':
        return {
          card: 'aspect-square rounded-2xl backdrop-blur-xl border border-white/20 shadow-lg overflow-hidden cursor-pointer hover:bg-white/15 transition-all',
          background: 'rgba(255,255,255,0.08)',
        };
      default:
        // Current: matches ChecklistCard - more visible gradient like the actual dashboard
        return {
          card: 'aspect-square rounded-xl border overflow-hidden cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all',
          background: `linear-gradient(135deg, ${accentColor}15 0%, ${accentColor}25 100%)`,
          borderColor: `${accentColor}30`,
        };
    }
  };

  const getSalesCubeStyle = (style: StyleOption, accentColor: string = 'hsl(var(--primary))') => {
    switch (style) {
      case 'full-3d':
        return `rounded-2xl shadow-[8px_8px_16px_rgba(0,0,0,0.25),-4px_-4px_12px_rgba(255,255,255,0.1)] p-4 text-white transform`;
      case 'sharp-edge':
        return `rounded-none shadow-[6px_6px_0px_rgba(0,0,0,0.2)] border-2 border-white/20 p-4 text-white`;
      case 'flat-minimal':
        return `rounded-lg p-4 text-white shadow-none`;
      case 'glassmorphism':
        return `rounded-2xl backdrop-blur-xl border border-white/20 p-4 text-white shadow-xl`;
      default:
        // Current: solid color with shadow
        return `rounded-xl p-4 text-white shadow-lg`;
    }
  };

  const getDockStyle = (style: StyleOption) => {
    switch (style) {
      case 'full-3d':
        return 'bg-gradient-to-t from-accent via-accent/90 to-accent/80 rounded-t-3xl shadow-[0_-8px_24px_rgba(0,0,0,0.3)] border-t-2 border-white/20';
      case 'sharp-edge':
        return 'bg-accent rounded-none shadow-[0_-4px_0px_rgba(0,0,0,0.15)] border-t-2 border-white/15';
      case 'flat-minimal':
        return 'bg-accent border-t border-border';
      case 'glassmorphism':
        return 'bg-accent/70 backdrop-blur-2xl rounded-t-2xl border-t border-white/30';
      default:
        // Current: matches actual dock - gradient with rounded top
        return 'bg-gradient-to-t from-accent to-accent/90 rounded-t-2xl shadow-lg';
    }
  };

  const getPageContainerStyle = (style: StyleOption) => {
    switch (style) {
      case 'glassmorphism':
        // Only glassmorphism has the gradient background on the page
        return 'bg-gradient-to-br from-primary/20 via-background to-accent/20 min-h-screen';
      default:
        return '';
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Design Style Preview</h1>
        </div>
      </div>

      {/* Style Selector Tabs */}
      <div className="px-4 py-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {styleOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setActiveStyle(option.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeStyle === option.id
                  ? 'bg-primary text-primary-foreground shadow-lg'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {option.name}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          {styleOptions.find(o => o.id === activeStyle)?.description}
        </p>
      </div>

      {/* Preview Content */}
      <div className={`px-4 space-y-6 pb-8 ${getPageContainerStyle(activeStyle)}`}>
        
        {/* Quick Tasks Section */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Tasks</h2>
          
          {/* Task Card 1 - matches TemporaryTaskCard */}
          {(() => {
            const taskStyle = getTaskCardStyle(activeStyle, 'hsl(var(--accent))');
            return (
              <div className={taskStyle.card} style={taskStyle.borderStyle}>
                <div className="py-2 px-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div 
                      className={`p-1.5 rounded-md shrink-0 ${activeStyle === 'full-3d' ? 'shadow-inner' : ''}`}
                      style={{ backgroundColor: 'hsl(var(--accent) / 0.2)' }}
                    >
                      <Calendar className="h-4 w-4 text-accent" />
                    </div>
                    <div className="min-w-0 flex flex-wrap items-center gap-1.5 flex-1">
                      <p className="font-medium text-sm">Day 3 Training - Diego</p>
                      <span 
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ backgroundColor: 'hsl(var(--accent) / 0.2)', color: 'hsl(var(--accent))' }}
                      >
                        <ListChecks className="h-3 w-3" />
                        0/4
                      </span>
                    </div>
                  </div>
                  <button className={`h-8 px-4 text-xs font-medium flex items-center gap-1.5 ${getButtonStyle(activeStyle, 'primary')}`}>
                    <Check className="h-3.5 w-3.5" />
                    Start
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Task Card 2 */}
          {(() => {
            const taskStyle = getTaskCardStyle(activeStyle, 'hsl(var(--primary))');
            return (
              <div className={taskStyle.card} style={taskStyle.borderStyle}>
                <div className="py-2 px-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div 
                      className={`p-1.5 rounded-md shrink-0 ${activeStyle === 'full-3d' ? 'shadow-inner' : ''}`}
                      style={{ backgroundColor: 'hsl(var(--primary) / 0.2)' }}
                    >
                      <Calendar className="h-4 w-4 text-primary" />
                    </div>
                    <p className="font-medium text-sm">Order Produce</p>
                    <span className="text-xs text-muted-foreground">9:00 AM</span>
                  </div>
                  <button className={`h-8 px-4 text-xs font-medium flex items-center gap-1.5 ${getButtonStyle(activeStyle, 'primary')}`}>
                    <Check className="h-3.5 w-3.5" />
                    Done
                  </button>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Data Cubes Section */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Data Cubes</h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Daily Sales Cube */}
            <div 
              className={getSalesCubeStyle(activeStyle, 'hsl(var(--primary))')}
              style={{ backgroundColor: 'hsl(var(--primary))' }}
            >
              <p className="text-xs font-semibold opacity-90 uppercase tracking-wide">Daily Sales</p>
              <p className="text-2xl font-bold mt-2">$2,847</p>
              <p className="text-xs opacity-75">Sales</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="opacity-75">AI Goal</p>
                  <p className="font-semibold">$2,368</p>
                </div>
                <div>
                  <p className="opacity-75">SDLW</p>
                  <p className="font-semibold">$2,082</p>
                </div>
              </div>
            </div>

            {/* Payment Cube */}
            <div 
              className={getSalesCubeStyle(activeStyle, 'hsl(var(--accent))')}
              style={{ backgroundColor: 'hsl(var(--accent))' }}
            >
              <p className="text-xs font-semibold opacity-90 uppercase tracking-wide">Payment $</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="opacity-75">Cash</p>
                  <p className="font-semibold">$142</p>
                </div>
                <div>
                  <p className="opacity-75">CC</p>
                  <p className="font-semibold">$2,405</p>
                </div>
              </div>
              <div className="mt-2">
                <p className="opacity-75 text-xs">DD</p>
                <p className="font-semibold">$19</p>
              </div>
            </div>
          </div>
        </div>

        {/* Checklists Section - Grid like actual dashboard */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Checklists</h2>
          
          <div className="grid grid-cols-3 gap-3">
            {/* Checklist Card 1 - 82% complete */}
            {(() => {
              const checklistStyle = getChecklistCardStyle(activeStyle, '#8B5CF6');
              return (
                <div 
                  className={checklistStyle.card}
                  style={{ 
                    background: checklistStyle.background,
                    borderColor: checklistStyle.borderColor,
                  }}
                >
                  <div className="relative z-10 h-full flex flex-col p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div 
                        className="flex items-center justify-center w-6 h-6 rounded-md"
                        style={{ backgroundColor: '#8B5CF620' }}
                      >
                        <CheckSquare className="h-3.5 w-3.5" style={{ color: '#8B5CF6' }} />
                      </div>
                      <span className="text-[11px] font-semibold truncate" style={{ color: '#8B5CF6' }}>
                        Morning Line
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <div className="text-4xl font-black" style={{ color: '#8B5CF6' }}>82%</div>
                      <div className="text-xs text-muted-foreground font-medium mt-1">23 of 28</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Checklist Card 2 - Complete */}
            {(() => {
              const checklistStyle = getChecklistCardStyle(activeStyle, '#22c55e');
              return (
                <div 
                  className={checklistStyle.card}
                  style={{ 
                    background: checklistStyle.background,
                    borderColor: checklistStyle.borderColor,
                  }}
                >
                  <div className="relative z-10 h-full flex flex-col p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div 
                        className="flex items-center justify-center w-6 h-6 rounded-md"
                        style={{ backgroundColor: '#22c55e20' }}
                      >
                        <CheckSquare className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />
                      </div>
                      <span className="text-[11px] font-semibold truncate" style={{ color: '#22c55e' }}>
                        Deep Clean
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <div 
                        className={`flex items-center justify-center w-12 h-12 rounded-full mb-2 ${activeStyle === 'full-3d' ? 'shadow-lg' : ''}`}
                        style={{ backgroundColor: '#22c55e' }}
                      >
                        <Check className="h-6 w-6 text-white" strokeWidth={3} />
                      </div>
                      <div className="text-sm font-bold text-foreground">Done!</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Checklist Card 3 - Locked */}
            {(() => {
              const checklistStyle = getChecklistCardStyle(activeStyle, '#6b7280');
              return (
                <div 
                  className={`${checklistStyle.card} opacity-60`}
                  style={{ 
                    background: activeStyle === 'current' ? 'hsl(var(--card))' : checklistStyle.background,
                  }}
                >
                  <div className="relative z-10 h-full flex flex-col p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-muted">
                        <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <span className="text-[11px] font-semibold truncate text-muted-foreground">
                        Shift Change
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <div className="flex items-center justify-center w-12 h-12 rounded-full mb-2 bg-muted">
                        <Clock className="h-6 w-6 text-muted-foreground" strokeWidth={2.5} />
                      </div>
                      <div className="text-xs text-muted-foreground font-medium text-center">Until 2:00 PM</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Sample Dock */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Navigation Dock</h2>
          <div className={`${getDockStyle(activeStyle)} p-4`}>
            <div className="flex justify-around items-center">
              {[
                { icon: Flame, label: 'Dash', active: true },
                { icon: MessageSquare, label: 'Chat', active: false },
                { icon: CheckSquare, label: 'Tasks', active: false },
                { icon: BookOpen, label: 'Logs', active: false },
                { icon: Calendar, label: 'Schedule', active: false },
              ].map((item) => (
                <div key={item.label} className={`flex flex-col items-center gap-1 ${item.active ? 'text-white' : 'text-white/60'}`}>
                  <div className={`p-2 rounded-xl ${item.active ? (activeStyle === 'full-3d' ? 'bg-white/20 shadow-lg' : activeStyle === 'glassmorphism' ? 'bg-white/20 backdrop-blur' : 'bg-white/15') : ''}`}>
                    <item.icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default DesignStylePreview;

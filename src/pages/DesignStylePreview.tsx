import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, Calendar, MessageSquare, CheckSquare, BookOpen, Clock, Flame, Check, ListChecks } from "lucide-react";
import { useNavigate } from "react-router-dom";

type StyleOption = 'current' | 'full-3d' | 'flat-minimal' | 'glassmorphism';

const DesignStylePreview = () => {
  const navigate = useNavigate();
  const [activeStyle, setActiveStyle] = useState<StyleOption>('current');

  const styleOptions: { id: StyleOption; name: string; description: string }[] = [
    { id: 'current', name: 'Current (Hybrid)', description: '3D dock + cubes, 2D cards' },
    { id: 'full-3d', name: 'Full 3D / Neumorphic', description: 'Everything has depth & shadows' },
    { id: 'flat-minimal', name: 'Flat Minimal', description: 'Clean 2D, subtle borders' },
    { id: 'glassmorphism', name: 'Glassmorphism', description: 'Frosted glass + blur effects' },
  ];

  // Style-specific classes
  const getCardStyle = (style: StyleOption) => {
    switch (style) {
      case 'full-3d':
        return 'bg-card rounded-2xl shadow-[8px_8px_16px_rgba(0,0,0,0.15),-4px_-4px_12px_rgba(255,255,255,0.1)] border-0 transform hover:translate-y-[-2px] transition-all';
      case 'flat-minimal':
        return 'bg-card rounded-lg border border-border/50 shadow-none';
      case 'glassmorphism':
        return 'bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg';
      default:
        return 'bg-card rounded-xl border shadow-sm';
    }
  };

  const getButtonStyle = (style: StyleOption, variant: 'primary' | 'secondary' = 'primary') => {
    if (variant === 'primary') {
      switch (style) {
        case 'full-3d':
          return 'bg-primary text-primary-foreground rounded-xl shadow-[4px_4px_8px_rgba(0,0,0,0.2),-2px_-2px_6px_rgba(255,255,255,0.1)] border-0 hover:shadow-[2px_2px_4px_rgba(0,0,0,0.2)] active:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.2)] transition-all';
        case 'flat-minimal':
          return 'bg-primary text-primary-foreground rounded-md shadow-none border-0 hover:bg-primary/90';
        case 'glassmorphism':
          return 'bg-primary/80 backdrop-blur-sm text-primary-foreground rounded-xl border border-primary/30 shadow-lg hover:bg-primary/90';
        default:
          return 'bg-primary text-primary-foreground rounded-lg';
      }
    } else {
      switch (style) {
        case 'full-3d':
          return 'bg-muted text-muted-foreground rounded-xl shadow-[4px_4px_8px_rgba(0,0,0,0.1),-2px_-2px_6px_rgba(255,255,255,0.05)] border-0 hover:shadow-[2px_2px_4px_rgba(0,0,0,0.1)] transition-all';
        case 'flat-minimal':
          return 'bg-transparent text-muted-foreground rounded-md border border-border hover:bg-muted/50';
        case 'glassmorphism':
          return 'bg-white/5 backdrop-blur-sm text-foreground rounded-xl border border-white/10 hover:bg-white/10';
        default:
          return 'bg-muted text-muted-foreground rounded-lg border';
      }
    }
  };

  const getTaskCardStyle = (style: StyleOption) => {
    switch (style) {
      case 'full-3d':
        return 'bg-card rounded-2xl shadow-[6px_6px_12px_rgba(0,0,0,0.12),-3px_-3px_8px_rgba(255,255,255,0.08)] border-l-4 border-l-accent border-0 p-4';
      case 'flat-minimal':
        return 'bg-card rounded-lg border-l-4 border-l-accent border border-border/30 p-4';
      case 'glassmorphism':
        return 'bg-white/8 backdrop-blur-lg rounded-xl border-l-4 border-l-accent border border-white/10 p-4';
      default:
        return 'bg-card rounded-xl border-l-4 border-l-accent shadow-sm p-4';
    }
  };

  const getChecklistStyle = (style: StyleOption) => {
    switch (style) {
      case 'full-3d':
        return 'bg-card rounded-2xl shadow-[6px_6px_12px_rgba(0,0,0,0.12),-3px_-3px_8px_rgba(255,255,255,0.08)] border-0 p-4';
      case 'flat-minimal':
        return 'bg-card rounded-lg border border-border/50 p-4';
      case 'glassmorphism':
        return 'bg-white/8 backdrop-blur-lg rounded-xl border border-white/10 p-4';
      default:
        return 'bg-card rounded-xl border shadow-sm p-4';
    }
  };

  const getSalesCubeStyle = (style: StyleOption, color: 'primary' | 'accent') => {
    const baseColor = color === 'primary' ? 'bg-primary' : 'bg-accent';
    switch (style) {
      case 'full-3d':
        return `${baseColor} rounded-2xl shadow-[8px_8px_16px_rgba(0,0,0,0.25),-4px_-4px_12px_rgba(255,255,255,0.1)] p-4 text-white transform perspective-1000`;
      case 'flat-minimal':
        return `${baseColor} rounded-lg p-4 text-white`;
      case 'glassmorphism':
        return `${baseColor}/70 backdrop-blur-xl rounded-2xl border border-white/20 p-4 text-white shadow-xl`;
      default:
        return `${baseColor} rounded-xl p-4 text-white shadow-lg`;
    }
  };

  const getDockStyle = (style: StyleOption) => {
    switch (style) {
      case 'full-3d':
        return 'bg-gradient-to-t from-accent via-accent/90 to-accent/80 rounded-t-3xl shadow-[0_-8px_24px_rgba(0,0,0,0.3)] border-t-2 border-white/20';
      case 'flat-minimal':
        return 'bg-accent border-t border-accent/20';
      case 'glassmorphism':
        return 'bg-accent/60 backdrop-blur-2xl rounded-t-2xl border-t border-white/30';
      default:
        return 'bg-gradient-to-t from-accent to-accent/90 rounded-t-2xl shadow-lg';
    }
  };

  const getProgressStyle = (style: StyleOption) => {
    switch (style) {
      case 'full-3d':
        return 'h-3 rounded-full shadow-[inset_2px_2px_4px_rgba(0,0,0,0.1)]';
      case 'flat-minimal':
        return 'h-2 rounded-sm';
      case 'glassmorphism':
        return 'h-3 rounded-full bg-white/10';
      default:
        return 'h-2.5 rounded-full';
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
      <div className={`px-4 space-y-4 ${activeStyle === 'glassmorphism' ? 'bg-gradient-to-br from-primary/20 via-background to-accent/20 min-h-screen -mt-4 pt-4' : ''}`}>
        
        {/* Quick Tasks Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Tasks</h2>
          
          {/* Task Card 1 */}
          <div className={getTaskCardStyle(activeStyle)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${activeStyle === 'full-3d' ? 'bg-accent/10 shadow-inner' : activeStyle === 'glassmorphism' ? 'bg-white/10' : 'bg-accent/10'}`}>
                  <Calendar className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="font-medium">Day 3 Training - Diego</p>
                  <div className="flex items-center gap-1 text-xs text-accent">
                    <ListChecks className="h-3 w-3" />
                    <span>0/4</span>
                  </div>
                </div>
              </div>
              <button className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${getButtonStyle(activeStyle, 'primary')}`}>
                <Check className="h-4 w-4" />
                Start
              </button>
            </div>
          </div>

          {/* Task Card 2 - Completed */}
          <div className={`${getTaskCardStyle(activeStyle)} opacity-80`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${activeStyle === 'full-3d' ? 'bg-accent/10 shadow-inner' : activeStyle === 'glassmorphism' ? 'bg-white/10' : 'bg-accent/10'}`}>
                  <Calendar className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <p className="font-medium">Order Produce</p>
                  <p className="text-xs text-muted-foreground">9:00 AM</p>
                </div>
              </div>
              <button className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${getButtonStyle(activeStyle, 'secondary')}`}>
                <Check className="h-4 w-4" />
                Done
              </button>
            </div>
          </div>
        </div>

        {/* Sales Cubes Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Data Cubes</h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Daily Sales Cube */}
            <div className={getSalesCubeStyle(activeStyle, 'primary')}>
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
            <div className={getSalesCubeStyle(activeStyle, 'accent')}>
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

        {/* Checklists Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Checklists</h2>
          
          {/* Checklist Card 1 - In Progress */}
          <div className={getChecklistStyle(activeStyle)}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-primary" />
                <span className="font-medium">Morning Line Check</span>
              </div>
              <Badge variant="outline" className="text-xs">daily</Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <button className={`w-full py-2 text-sm font-medium ${getButtonStyle(activeStyle, 'primary')}`}>
                  Continue • 23/28
                </button>
              </div>
              <span className="text-sm font-semibold text-muted-foreground">82%</span>
            </div>
            <div className={`mt-2 ${getProgressStyle(activeStyle)}`}>
              <Progress value={82} className="h-full" />
            </div>
          </div>

          {/* Checklist Card 2 - Locked */}
          <div className={`${getChecklistStyle(activeStyle)} opacity-60`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Shift Change Line Check</span>
              </div>
              <Badge variant="outline" className="text-xs">daily</Badge>
            </div>
            <button className={`w-full py-2 text-sm ${getButtonStyle(activeStyle, 'secondary')} opacity-50 cursor-not-allowed`} disabled>
              <Clock className="h-4 w-4 mr-2 inline" />
              Locked until 2:00 PM
            </button>
          </div>

          {/* Checklist Card 3 - Not Started */}
          <div className={getChecklistStyle(activeStyle)}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-primary" />
                <span className="font-medium">Daily Deep Cleaning</span>
              </div>
              <Badge variant="outline" className="text-xs">weekly</Badge>
            </div>
            <button className={`w-full py-2 text-sm ${getButtonStyle(activeStyle, 'secondary')}`}>
              Start Checklist
            </button>
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

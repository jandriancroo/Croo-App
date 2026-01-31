import { useState } from 'react';
import { LayoutDashboard, CheckSquare, Calendar, MessageSquare, Scroll, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const mockNavItems = [
  { label: 'Dash', icon: LayoutDashboard },
  { label: 'Tasks', icon: CheckSquare },
  { label: 'Sched', icon: Calendar },
  { label: 'Msgs', icon: MessageSquare },
  { label: 'Logs', icon: Scroll },
];

interface DockStyleProps {
  name: string;
  description: string;
  iconSize: string;
  strokeWidth: { active: number; inactive: number };
  textSize: string;
  padding: string;
  gap: string;
}

const dockStyles: DockStyleProps[] = [
  {
    name: 'Current (Large Bold)',
    description: 'h-7 w-7, strokeWidth 2.5/2',
    iconSize: 'h-7 w-7',
    strokeWidth: { active: 2.5, inactive: 2 },
    textSize: 'text-xs',
    padding: 'py-1',
    gap: 'gap-0.5',
  },
  {
    name: 'Refined (Smaller, Lighter)',
    description: 'h-5 w-5, strokeWidth 2/1.5',
    iconSize: 'h-5 w-5',
    strokeWidth: { active: 2, inactive: 1.5 },
    textSize: 'text-[10px]',
    padding: 'py-1.5',
    gap: 'gap-1',
  },
  {
    name: 'Balanced (Medium)',
    description: 'h-6 w-6, strokeWidth 2/1.75',
    iconSize: 'h-6 w-6',
    strokeWidth: { active: 2, inactive: 1.75 },
    textSize: 'text-[11px]',
    padding: 'py-1',
    gap: 'gap-0.5',
  },
  {
    name: 'Light & Airy',
    description: 'h-5.5 w-5.5, strokeWidth 1.5/1.25',
    iconSize: 'h-[22px] w-[22px]',
    strokeWidth: { active: 1.5, inactive: 1.25 },
    textSize: 'text-[10px]',
    padding: 'py-1.5',
    gap: 'gap-1',
  },
  {
    name: 'Compact Pro',
    description: 'h-5 w-5, strokeWidth 1.75/1.5, tighter spacing',
    iconSize: 'h-5 w-5',
    strokeWidth: { active: 1.75, inactive: 1.5 },
    textSize: 'text-[9px]',
    padding: 'py-2',
    gap: 'gap-0.5',
  },
  {
    name: 'iOS Style',
    description: 'h-6 w-6, strokeWidth 1.5/1.5, uniform weight',
    iconSize: 'h-6 w-6',
    strokeWidth: { active: 1.5, inactive: 1.5 },
    textSize: 'text-[10px]',
    padding: 'py-1',
    gap: 'gap-0.5',
  },
];

const DockPreview = ({ style, selectedIndex }: { style: DockStyleProps; selectedIndex: number }) => {
  return (
    <div className="glass-dock overflow-hidden rounded-2xl">
      <div className={`relative z-10 flex items-center justify-evenly px-2 pt-3 pb-0`}>
        <div className="flex items-center justify-evenly w-full">
          {mockNavItems.map((item, idx) => {
            const Icon = item.icon;
            const isActive = idx === selectedIndex;
            
            return (
              <button
                key={item.label}
                className={`flex-1 flex flex-col items-center ${style.gap} ${style.padding} rounded-xl transition-colors relative select-none ${
                  isActive 
                    ? 'bg-white/20 text-accent-foreground' 
                    : 'text-accent-foreground/70'
                }`}
              >
                <Icon 
                  className={style.iconSize} 
                  strokeWidth={isActive ? style.strokeWidth.active : style.strokeWidth.inactive} 
                />
                <span className={`${style.textSize} ${isActive ? 'font-semibold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ height: '8px' }} />
    </div>
  );
};

export default function DockStylePreview() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="min-h-screen bg-background p-4 pb-32">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Dock Icon Styles</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Compare different icon sizes and stroke weights. Tap on different tabs to see how each style looks with different active states.
        </p>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {mockNavItems.map((item, idx) => (
            <Button
              key={item.label}
              variant={activeTab === idx ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab(idx)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="space-y-6">
          {dockStyles.map((style, idx) => (
            <Card key={idx} className="overflow-hidden">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{style.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{style.description}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <DockPreview style={style} selectedIndex={activeTab} />
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm font-medium mb-2">Which style do you prefer?</p>
          <p className="text-xs text-muted-foreground">
            Let me know which number (1-6) looks best and I'll apply it to the app!
          </p>
        </div>
      </div>
    </div>
  );
}

import { MapPin, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import crooLogo from "@/assets/croo-logo.webp";

const mockLogo = crooLogo;
const mockLocation = "Palm Springs";
const mockInitials = "JD";

export default function HeaderStylePreview() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-muted/30 p-4 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Mobile Header Options</h1>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>Back</Button>
      </div>
      <p className="text-sm text-muted-foreground">Pick your favorite — same teal color, different shape & styling.</p>

      {/* Option 1: Floating pill with generous rounding */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Option 1 — Floating Pill</p>
        <div className="mx-2">
          <div 
            className="flex items-center h-14 px-3 rounded-2xl bg-primary"
            style={{ boxShadow: '0 6px 24px hsl(var(--primary) / 0.35)' }}
          >
            <div className="h-9 w-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img src={mockLogo} alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div className="flex-1 flex justify-center">
              <button className="flex items-center gap-1.5 text-primary-foreground font-medium text-base">
                <MapPin className="h-4 w-4" />
                <span>{mockLocation}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </div>
            <Avatar className="h-9 w-9 ring-2 ring-white/30 flex-shrink-0">
              <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{mockInitials}</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>

      {/* Option 2: Full-bleed with bottom curve */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Option 2 — Full Bleed + Bottom Curve</p>
        <div 
          className="flex items-center h-14 px-4 bg-primary rounded-b-3xl"
          style={{ boxShadow: '0 8px 24px hsl(var(--primary) / 0.3)' }}
        >
          <div className="h-9 w-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden">
            <img src={mockLogo} alt="Logo" className="h-full w-full object-cover" />
          </div>
          <div className="flex-1 flex justify-center">
            <button className="flex items-center gap-1.5 text-primary-foreground font-medium text-base">
              <MapPin className="h-4 w-4" />
              <span>{mockLocation}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </button>
          </div>
          <Avatar className="h-9 w-9 ring-2 ring-white/30 flex-shrink-0">
            <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{mockInitials}</AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* Option 3: Neumorphic inset with soft inner shadow */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Option 3 — Neumorphic Inset</p>
        <div className="mx-2">
          <div 
            className="flex items-center h-14 px-3 rounded-xl bg-primary"
            style={{ 
              boxShadow: '0 6px 20px hsl(var(--primary) / 0.3), inset 0 2px 4px hsl(0 0% 100% / 0.15), inset 0 -2px 4px hsl(0 0% 0% / 0.1)' 
            }}
          >
            <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ boxShadow: '0 2px 8px hsl(0 0% 0% / 0.2)' }}>
              <img src={mockLogo} alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div className="flex-1 flex justify-center">
              <button className="flex items-center gap-1.5 text-primary-foreground font-medium text-base px-3 py-1.5 rounded-lg" style={{ background: 'hsl(0 0% 100% / 0.1)' }}>
                <MapPin className="h-4 w-4" />
                <span>{mockLocation}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </div>
            <Avatar className="h-9 w-9 ring-2 ring-white/30 flex-shrink-0" style={{ boxShadow: '0 2px 8px hsl(0 0% 0% / 0.2)' }}>
              <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{mockInitials}</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>

      {/* Option 4: Stadium shape (super rounded, compact) */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Option 4 — Stadium Bar</p>
        <div className="mx-3">
          <div 
            className="flex items-center h-12 px-1.5 rounded-full bg-primary"
            style={{ boxShadow: '0 4px 16px hsl(var(--primary) / 0.35)' }}
          >
            <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img src={mockLogo} alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div className="flex-1 flex justify-center">
              <button className="flex items-center gap-1.5 text-primary-foreground font-medium text-[15px]">
                <MapPin className="h-3.5 w-3.5" />
                <span>{mockLocation}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </div>
            <Avatar className="h-9 w-9 ring-2 ring-white/25 flex-shrink-0">
              <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{mockInitials}</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>

      {/* Option 5: Flat + thin accent line bottom */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Option 5 — Flat + Accent Line</p>
        <div className="relative">
          <div 
            className="flex items-center h-14 px-4 bg-primary"
          >
            <div className="h-9 w-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img src={mockLogo} alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div className="flex-1 flex justify-center">
              <button className="flex items-center gap-1.5 text-primary-foreground font-medium text-base">
                <MapPin className="h-4 w-4" />
                <span>{mockLocation}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </div>
            <Avatar className="h-9 w-9 ring-2 ring-white/30 flex-shrink-0">
              <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{mockInitials}</AvatarFallback>
            </Avatar>
          </div>
          {/* Accent line */}
          <div className="h-[3px] bg-accent w-full" />
        </div>
      </div>

    </div>
  );
}

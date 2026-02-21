import { MapPin, ChevronDown, LayoutDashboard, CheckSquare, Calendar, MessageSquare, Users, RefreshCw } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import crooLogo from "@/assets/croo-logo.webp";

const mockLocation = "Palm Springs";
const mockInitials = "JD";

const dockNavItems = [
  { label: "Dash", icon: LayoutDashboard },
  { label: "Tasks", icon: CheckSquare },
  { label: "Schedule", icon: Calendar },
  { label: "Chat", icon: MessageSquare },
  { label: "Team", icon: Users },
];

function MockDock() {
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-accent" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}>
      <div className="flex items-center justify-evenly px-2 pt-3 pb-0">
        {dockNavItems.map((item, i) => {
          const Icon = item.icon;
          const isActive = i === 0;
          return (
            <div
              key={item.label}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1 rounded-xl ${
                isActive ? 'bg-white/20 text-accent-foreground' : 'text-accent-foreground/70'
              }`}
            >
              <Icon className="h-8 w-8" strokeWidth={1.75} />
              <span className={`text-[10px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MockContent() {
  return (
    <div className="px-4 py-3 space-y-3">
      <h1 className="text-2xl font-bold">Dash</h1>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Morning Line Check</CardTitle>
            <Badge variant="outline" className="text-xs">daily</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" className="w-full">Start Checklist</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Closing Checklist</CardTitle>
            <Badge variant="outline" className="text-xs">daily</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">🔒 Locked until 9:00 PM</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PullRefreshIndicator() {
  return (
    <div className="flex flex-col items-center justify-center py-4">
      <RefreshCw className="h-6 w-6 text-primary animate-spin" />
      <span className="text-xs text-primary mt-1 font-medium">Release to refresh</span>
    </div>
  );
}

// headerTopPx = how much space the header takes from top
function PhoneMockup({ label, pulled, children, headerTopPx = 56 }: { label: string; pulled?: boolean; children: React.ReactNode; headerTopPx?: number }) {
  const pullGap = pulled ? 80 : 0;
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-muted-foreground">{label}{pulled ? " — pulled" : ""}</p>
      <div className="relative mx-auto w-full max-w-[375px] h-[520px] rounded-3xl border-4 border-foreground/20 bg-background overflow-hidden shadow-xl">
        {children}
        <div
          className="absolute left-0 right-0 bottom-[72px] overflow-hidden"
          style={{ top: `${headerTopPx}px` }}
        >
          {/* Pull gap area */}
          {pulled && <PullRefreshIndicator />}
          <div style={{ transform: pulled ? `translateY(0px)` : undefined }}>
            <MockContent />
          </div>
        </div>
        <MockDock />
      </div>
    </div>
  );
}

function LogoIcon({ rounded = "rounded-xl" }: { rounded?: string }) {
  return (
    <div className={`h-9 w-9 ${rounded} bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden`}>
      <img src={crooLogo} alt="Logo" className="h-full w-full object-cover" />
    </div>
  );
}

function LocationButton({ small = false }: { small?: boolean }) {
  return (
    <button className={`flex items-center gap-1.5 text-primary-foreground font-medium ${small ? 'text-[15px]' : 'text-base'}`}>
      <MapPin className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
      <span>{mockLocation}</span>
      <ChevronDown className={`${small ? "h-3 w-3" : "h-3.5 w-3.5"} opacity-60`} />
    </button>
  );
}

function ProfileAvatar({ extraStyle }: { extraStyle?: React.CSSProperties }) {
  return (
    <Avatar className="h-9 w-9 ring-2 ring-white/30 flex-shrink-0" style={extraStyle}>
      <AvatarFallback className="text-xs bg-white/20 text-primary-foreground">{mockInitials}</AvatarFallback>
    </Avatar>
  );
}

export default function HeaderStylePreview() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-muted/30 p-4 space-y-6 pb-32">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Header Options</h1>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>Back</Button>
      </div>
      <p className="text-sm text-muted-foreground -mt-4">Left = normal &nbsp;|&nbsp; Right = during pull-to-refresh</p>

      {/* Option 1: Floating Pill */}
      <div>
        <p className="text-sm font-bold mb-2">Option 1 — Floating Pill</p>
        <div className="grid grid-cols-2 gap-3">
          <PhoneMockup label="Normal" headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 px-2 pt-1.5 pb-1 bg-background">
              <div className="flex items-center h-12 px-3 rounded-2xl bg-primary" style={{ boxShadow: '0 6px 24px hsl(var(--primary) / 0.35)' }}>
                <LogoIcon />
                <div className="flex-1 flex justify-center"><LocationButton /></div>
                <ProfileAvatar />
              </div>
            </div>
          </PhoneMockup>
          <PhoneMockup label="Pulled" pulled headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 px-2 pt-1.5 pb-1 bg-background">
              <div className="flex items-center h-12 px-3 rounded-2xl bg-primary" style={{ boxShadow: '0 6px 24px hsl(var(--primary) / 0.35)' }}>
                <LogoIcon />
                <div className="flex-1 flex justify-center"><LocationButton /></div>
                <ProfileAvatar />
              </div>
            </div>
          </PhoneMockup>
        </div>
        <p className="text-xs text-muted-foreground mt-1 italic">✅ Gap blends naturally — background matches page</p>
      </div>

      {/* Option 2: Full Bleed + Bottom Curve */}
      <div>
        <p className="text-sm font-bold mb-2">Option 2 — Full Bleed + Bottom Curve</p>
        <div className="grid grid-cols-2 gap-3">
          <PhoneMockup label="Normal" headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center h-14 px-4 bg-primary rounded-b-3xl" style={{ boxShadow: '0 8px 24px hsl(var(--primary) / 0.3)' }}>
              <LogoIcon />
              <div className="flex-1 flex justify-center"><LocationButton /></div>
              <ProfileAvatar />
            </div>
          </PhoneMockup>
          <PhoneMockup label="Pulled" pulled headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center h-14 px-4 bg-primary rounded-b-3xl" style={{ boxShadow: '0 8px 24px hsl(var(--primary) / 0.3)' }}>
              <LogoIcon />
              <div className="flex-1 flex justify-center"><LocationButton /></div>
              <ProfileAvatar />
            </div>
          </PhoneMockup>
        </div>
        <p className="text-xs text-muted-foreground mt-1 italic">⚠️ Beige gap appears between teal header and content</p>
      </div>

      {/* Option 3: Neumorphic Inset */}
      <div>
        <p className="text-sm font-bold mb-2">Option 3 — Neumorphic Inset</p>
        <div className="grid grid-cols-2 gap-3">
          <PhoneMockup label="Normal" headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 px-2 pt-1.5 pb-1 bg-background">
              <div className="flex items-center h-12 px-3 rounded-xl bg-primary" style={{ boxShadow: '0 6px 20px hsl(var(--primary) / 0.3), inset 0 2px 4px hsl(0 0% 100% / 0.15), inset 0 -2px 4px hsl(0 0% 0% / 0.1)' }}>
                <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ boxShadow: '0 2px 8px hsl(0 0% 0% / 0.2)' }}>
                  <img src={crooLogo} alt="Logo" className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 flex justify-center">
                  <button className="flex items-center gap-1.5 text-primary-foreground font-medium text-sm px-2 py-1 rounded-lg" style={{ background: 'hsl(0 0% 100% / 0.1)' }}>
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{mockLocation}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                </div>
                <ProfileAvatar extraStyle={{ boxShadow: '0 2px 8px hsl(0 0% 0% / 0.2)' }} />
              </div>
            </div>
          </PhoneMockup>
          <PhoneMockup label="Pulled" pulled headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 px-2 pt-1.5 pb-1 bg-background">
              <div className="flex items-center h-12 px-3 rounded-xl bg-primary" style={{ boxShadow: '0 6px 20px hsl(var(--primary) / 0.3), inset 0 2px 4px hsl(0 0% 100% / 0.15), inset 0 -2px 4px hsl(0 0% 0% / 0.1)' }}>
                <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ boxShadow: '0 2px 8px hsl(0 0% 0% / 0.2)' }}>
                  <img src={crooLogo} alt="Logo" className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 flex justify-center">
                  <button className="flex items-center gap-1.5 text-primary-foreground font-medium text-sm px-2 py-1 rounded-lg" style={{ background: 'hsl(0 0% 100% / 0.1)' }}>
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{mockLocation}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                </div>
                <ProfileAvatar extraStyle={{ boxShadow: '0 2px 8px hsl(0 0% 0% / 0.2)' }} />
              </div>
            </div>
          </PhoneMockup>
        </div>
        <p className="text-xs text-muted-foreground mt-1 italic">✅ Gap blends naturally — background matches page</p>
      </div>

      {/* Option 4: Stadium Bar */}
      <div>
        <p className="text-sm font-bold mb-2">Option 4 — Stadium Bar</p>
        <div className="grid grid-cols-2 gap-3">
          <PhoneMockup label="Normal" headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 px-3 pt-1.5 pb-1 bg-background">
              <div className="flex items-center h-12 px-1.5 rounded-full bg-primary" style={{ boxShadow: '0 4px 16px hsl(var(--primary) / 0.35)' }}>
                <LogoIcon rounded="rounded-full" />
                <div className="flex-1 flex justify-center"><LocationButton small /></div>
                <ProfileAvatar />
              </div>
            </div>
          </PhoneMockup>
          <PhoneMockup label="Pulled" pulled headerTopPx={56}>
            <div className="absolute top-0 left-0 right-0 z-10 px-3 pt-1.5 pb-1 bg-background">
              <div className="flex items-center h-12 px-1.5 rounded-full bg-primary" style={{ boxShadow: '0 4px 16px hsl(var(--primary) / 0.35)' }}>
                <LogoIcon rounded="rounded-full" />
                <div className="flex-1 flex justify-center"><LocationButton small /></div>
                <ProfileAvatar />
              </div>
            </div>
          </PhoneMockup>
        </div>
        <p className="text-xs text-muted-foreground mt-1 italic">✅ Gap blends naturally — background matches page</p>
      </div>

      {/* Option 5: Flat + Accent Line */}
      <div>
        <p className="text-sm font-bold mb-2">Option 5 — Flat + Accent Line</p>
        <div className="grid grid-cols-2 gap-3">
          <PhoneMockup label="Normal" headerTopPx={59}>
            <div className="absolute top-0 left-0 right-0 z-10">
              <div className="flex items-center h-14 px-4 bg-primary">
                <LogoIcon />
                <div className="flex-1 flex justify-center"><LocationButton /></div>
                <ProfileAvatar />
              </div>
              <div className="h-[3px] bg-accent w-full" />
            </div>
          </PhoneMockup>
          <PhoneMockup label="Pulled" pulled headerTopPx={59}>
            <div className="absolute top-0 left-0 right-0 z-10">
              <div className="flex items-center h-14 px-4 bg-primary">
                <LogoIcon />
                <div className="flex-1 flex justify-center"><LocationButton /></div>
                <ProfileAvatar />
              </div>
              <div className="h-[3px] bg-accent w-full" />
            </div>
          </PhoneMockup>
        </div>
        <p className="text-xs text-muted-foreground mt-1 italic">⚠️ Beige gap appears between accent line and content</p>
      </div>

    </div>
  );
}

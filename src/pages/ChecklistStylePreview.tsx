import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2, Eye, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

// Fake data
const fakeChecklist = { title: "Monthly Deep Cleaning", description: "Complete all deep cleaning tasks by end of month" };
const fakeItems = [
  { id: "1", question: "Dry Storage Shelves - Removed and Washed", type: "image", required: true, completed: true, completer: { name: "Joshua H.", time: "5:04 PM", photo: null } },
  { id: "2", question: "Move Dry Storage Shelves and Sweep and Mop", type: "image", required: true, completed: false },
  { id: "3", question: "Clean behind fryers and drain grease traps", type: "confirmation", required: true, completed: true, completer: { name: "Andrea M.", time: "3:22 PM", photo: null } },
  { id: "4", question: "Wipe down all stainless steel surfaces", type: "confirmation", required: false, completed: false },
];

function CompletedOverlay({ completer, style }: { completer: { name: string; time: string; photo: string | null }; style: "A" | "B" | "C" | "D" | "E" }) {
  if (style === "A") {
    // Current style - big green circle + large avatar
    return (
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] z-10 flex items-center justify-center gap-3">
        <div className="bg-green-600/80 rounded-full p-4 shadow-lg">
          <CheckCircle2 className="h-10 w-10 text-white" />
        </div>
        <div className="flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-lg shadow-md py-1 px-2">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-xs bg-muted">{completer.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
          </Avatar>
          <div className="text-left">
            <div className="text-sm font-medium">{completer.name}</div>
            <div className="text-xs text-muted-foreground">{completer.time}</div>
          </div>
        </div>
      </div>
    );
  }

  if (style === "B") {
    // Compact inline badge — no overlay blur
    return (
      <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] z-10 flex items-center justify-center">
        <Badge variant="secondary" className="gap-1.5 py-1.5 px-3 text-xs shadow-md">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          {completer.name} · {completer.time}
        </Badge>
      </div>
    );
  }

  if (style === "C") {
    // Bottom bar — single row: check, avatar, name, time, preview
    return (
      <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px] z-10 flex flex-col justify-end">
        <div className="flex items-center gap-2 bg-background/90 border-t border-border px-3 py-2">
          <div className="cursor-pointer shrink-0" title="Tap to undo">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </div>
          <Avatar className="h-7 w-7 shrink-0">
            <img src="https://i.pravatar.cc/56?u=josh" alt={completer.name} className="object-cover" />
            <AvatarFallback className="text-[10px] bg-muted">{completer.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium truncate">{completer.name}</span>
          <span className="text-[10px] text-muted-foreground ml-auto">{completer.time}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Preview photo">
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  if (style === "D") {
    // Minimal check + subtle text
    return (
      <div className="absolute inset-0 bg-background/50 z-10 flex items-center justify-center">
        <div className="flex flex-col items-center gap-1">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
          <span className="text-[11px] text-muted-foreground">{completer.name} · {completer.time}</span>
        </div>
      </div>
    );
  }

  // Style E — green left accent + inline row with avatar
  return (
    <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px] z-10 flex items-center px-4">
      <div className="flex items-center gap-2 w-full">
        <div className="w-1 h-8 rounded-full bg-green-600 shrink-0" />
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarFallback className="text-[10px] bg-muted">{completer.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
        </Avatar>
        <span className="text-xs font-medium">{completer.name}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{completer.time}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ChecklistOption({ label, style, description }: { label: string; style: "A" | "B" | "C" | "D" | "E"; description: string }) {
  const sizes = {
    A: { title: "text-3xl", desc: "text-base", question: "text-base", badge: "text-lg px-3 py-1", imgH: "h-64", card: "space-y-6" },
    B: { title: "text-xl", desc: "text-sm", question: "text-sm", badge: "text-sm px-2.5 py-0.5", imgH: "h-36", card: "space-y-3" },
    C: { title: "text-lg", desc: "text-xs", question: "text-sm font-medium", badge: "text-xs px-2 py-0.5", imgH: "h-32", card: "space-y-2.5" },
    D: { title: "text-xl", desc: "text-sm", question: "text-[13px] font-medium", badge: "text-xs px-2 py-0.5", imgH: "h-32", card: "space-y-3" },
    E: { title: "text-lg", desc: "text-xs", question: "text-sm", badge: "text-sm px-2 py-0.5", imgH: "h-24", card: "space-y-2" },
  };
  const s = sizes[style];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-primary">{label}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardContent className="pt-5">
          <div className={s.card}>
            {/* Header */}
            <div>
              <div className="flex items-center justify-between">
                <h3 className={cn("font-bold", s.title)}>{fakeChecklist.title}</h3>
                <Badge variant="secondary" className={s.badge}>63%</Badge>
              </div>
              <p className={cn("text-muted-foreground", s.desc)}>{fakeChecklist.description}</p>
              <div className="flex items-center gap-2 pt-2">
                <Switch id={`hide-${style}`} className="scale-75 origin-left" />
                <Label htmlFor={`hide-${style}`} className="text-xs text-muted-foreground">Hide completed</Label>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-2.5">
              {fakeItems.slice(0, 3).map(item => (
                <div key={item.id} className="space-y-1.5">
                  <div className="px-0.5">
                    <span className={cn(s.question)}>
                      {item.question}
                      {item.required && <span className="text-destructive ml-1">*</span>}
                    </span>
                  </div>
                  <div className="border-t border-border" />
                  <Card className="overflow-hidden relative border">
                    {item.completed && item.completer && item.type === "image" && (
                      <CompletedOverlay completer={item.completer} style={style} />
                    )}
                    {item.type === "image" ? (
                      item.completed ? (
                        <CardContent className="p-0 pointer-events-none">
                          <div className={cn("relative", s.imgH)}>
                            <img 
                              src="https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=300&fit=crop" 
                              alt="Sample" 
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          </div>
                        </CardContent>
                      ) : (
                        <CardContent className="py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Snap a Photo</span>
                            <Button variant="outline" size="icon" className="h-8 w-8">
                              <Camera className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      )
                    ) : item.completed && item.completer ? (
                      <CardContent className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="cursor-pointer shrink-0" title="Tap to undo">
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          </div>
                          <Avatar className="h-7 w-7 shrink-0">
                            <img src="https://i.pravatar.cc/56?u=andrea" alt={item.completer.name} className="object-cover" />
                            <AvatarFallback className="text-[10px] bg-muted">{item.completer.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate">{item.completer.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{item.completer.time}</span>
                        </div>
                      </CardContent>
                    ) : (
                      <CardContent className="py-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox checked={item.completed} />
                          <Label className="text-sm font-normal">{item.question}</Label>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export default function ChecklistStylePreview() {
  return (
    <Layout>
      <div className="space-y-8 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">Checklist Completion Styles</h1>
          <p className="text-muted-foreground text-sm mt-1">5 options for text sizes, image sizes, completion overlays, and badge styles</p>
        </div>

        <ChecklistOption
          label="A — Current (Large)"
          style="A"
          description="Large title, big images, big avatar completion overlay"
        />
        <ChecklistOption
          label="B — Compact Badge Overlay"
          style="B"
          description="Medium title, smaller images, inline badge completion"
        />
        <ChecklistOption
          label="C — Bottom Bar Overlay"
          style="C"
          description="Smaller title, compact images, bottom bar completion"
        />
        <ChecklistOption
          label="D — Minimal Center"
          style="D"
          description="Medium title, moderate images, centered minimal check"
        />
        <ChecklistOption
          label="E — Inline Row"
          style="E"
          description="Small title, smallest images, no blur, inline row"
        />
      </div>
    </Layout>
  );
}

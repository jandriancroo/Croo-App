import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const fonts = [
  { 
    name: "Current (System Default)", 
    class: "", 
    description: "Current font", 
    vibe: "What you're using now",
    readability: 7,
    readabilityNote: "Varies by device, generally good"
  },
  { 
    name: "DM Sans", 
    class: "font-dm-sans", 
    description: "Clean geometric", 
    vibe: "Professional, minimal, Google-style",
    readability: 9,
    readabilityNote: "Excellent x-height, open counters, crisp at all sizes"
  },
  { 
    name: "Figtree", 
    class: "font-figtree", 
    description: "Modern geometric", 
    vibe: "Fresh, business-forward, balanced",
    readability: 9,
    readabilityNote: "Designed for screens, wide apertures, very legible"
  },
  { 
    name: "Manrope", 
    class: "font-manrope", 
    description: "Humanist, Apple-like", 
    vibe: "Professional, warm, readable",
    readability: 10,
    readabilityNote: "High x-height, semi-rounded, exceptional clarity"
  },
];

export function FontPreview() {
  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Font Options</h1>
        <p className="text-muted-foreground">
          Google × Apple × GE inspired options
        </p>
      </div>

      <div className="grid gap-4">
        {fonts.map((font) => (
          <Card key={font.name} className="p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">{font.name}</h2>
                <Badge variant="secondary" className="text-xs">{font.description}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Readability:</span>
                  <Badge 
                    variant={font.readability >= 9 ? "default" : "secondary"} 
                    className={`text-xs ${font.readability === 10 ? 'bg-primary' : ''}`}
                  >
                    {font.readability}/10
                  </Badge>
                </div>
              </div>
            </div>
            
            <div className="text-xs text-muted-foreground -mt-2">
              {font.readabilityNote}
            </div>
            
            <div className={`space-y-3 ${font.class}`}>
              <div className="text-3xl font-bold tracking-tight">
                CrooHQ Dashboard
              </div>
              <div className="text-xl font-semibold">
                Sales $4,582 • Labor 24.3% • Tasks 12/15
              </div>
              <div className="text-base">
                The quick brown fox jumps over the lazy dog. Managing your restaurant has never been easier.
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" className={font.class}>Primary Button</Button>
                <Button size="sm" variant="outline" className={font.class}>Secondary</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

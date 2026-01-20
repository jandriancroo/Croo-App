import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const fonts = [
  { 
    name: "Outfit", 
    class: "font-outfit", 
    description: "Geometric, Google-like", 
    vibe: "Clean, modern, slightly playful"
  },
  { 
    name: "Manrope", 
    class: "font-manrope", 
    description: "Humanist, Apple-like", 
    vibe: "Professional, warm, readable"
  },
  { 
    name: "Space Grotesk", 
    class: "font-grotesk", 
    description: "Industrial, GE-like", 
    vibe: "Bold, distinctive, technical"
  },
  { 
    name: "Plus Jakarta Sans", 
    class: "font-jakarta", 
    description: "Blend of all three", 
    vibe: "Modern, balanced, versatile"
  },
  { 
    name: "Lexend", 
    class: "font-lexend", 
    description: "Optimized readability", 
    vibe: "Clean, accessible, contemporary"
  },
  { 
    name: "Inter", 
    class: "font-inter", 
    description: "System UI style", 
    vibe: "Neutral, professional, familiar"
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
              <span className="text-xs text-muted-foreground italic">{font.vibe}</span>
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

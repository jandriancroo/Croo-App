import { Card } from "@/components/ui/card";

const fonts = [
  { name: "Manrope", class: "font-manrope", description: "Super rounded geometric, very distinctive curves" },
  { name: "Plus Jakarta Sans", class: "font-jakarta", description: "Modern rounded geometric, professional yet warm" },
  { name: "Space Grotesk", class: "font-grotesk", description: "Unique geometric proportions, bold personality" },
  { name: "Lexend", class: "font-lexend", description: "Rounded readability-focused, clean and accessible" },
  { name: "Comfortaa", class: "font-comfortaa", description: "Very rounded, distinctive and friendly" },
];

export function FontPreview() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Font Options Preview</h1>
        <p className="text-muted-foreground">
          Compare these 4 professional font options. Each is clean, slightly bold, and rounded.
        </p>
      </div>

      <div className="grid gap-6">
        {fonts.map((font) => (
          <Card key={font.name} className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{font.name}</h2>
              <span className="text-sm text-muted-foreground">{font.description}</span>
            </div>
            
            <div className={`space-y-3 ${font.class}`}>
              <div className="text-3xl font-bold">
                Croo - Food Service Made Smart
              </div>
              <div className="text-xl font-semibold">
                Schedule • Tasks • Payroll • Messages
              </div>
              <div className="text-base font-normal">
                The quick brown fox jumps over the lazy dog. This is how regular body text will appear throughout the application.
              </div>
              <div className="text-sm font-medium">
                Numbers: 0123456789 | Symbols: !@#$%^&*()
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

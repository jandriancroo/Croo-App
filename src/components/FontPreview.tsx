import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { Type } from "lucide-react";

const fonts = [
  { name: "VanSans", class: "font-vansans", type: "Custom (Local)", note: "App's primary display font. Loaded from /fonts/." },
  { name: "Pacifico", class: "font-pacifico", type: "Google Font", note: "Brush script, used for decorative display text." },
  { name: "Manrope", class: "font-manrope", type: "Google Font", note: "High x-height, semi-rounded, great clarity." },
];

const weights = [
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
];

export function FontPreview() {
  const [previewText, setPreviewText] = useState("CrooHQ Dashboard");

  return (
    <Layout>
      <div className="space-y-4 pb-24">
        <div>
          <div className="flex items-center gap-2">
            <Type className="h-5 w-5 text-primary" />
            <h1 className="text-3xl font-bold">Fonts</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{fonts.length} registered typefaces</p>
          <PageHeaderDivider />
        </div>

        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md py-3 -mx-1 px-1">
          <Input
            placeholder="Type to preview..."
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            className="text-base bg-card border-border/60"
          />
        </div>

        <div className="space-y-3">
          {fonts.map((font) => (
            <Card key={font.name} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{font.name}</h2>
                <Badge variant="secondary" className="text-[10px] shrink-0">{font.type}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">{font.note}</p>

              {/* Large preview */}
              <div className={`${font.class} text-2xl font-bold tracking-tight text-foreground`}>
                {previewText || "Type something above..."}
              </div>

              {/* Weight samples */}
              <div className={`${font.class} space-y-1`}>
                {weights.map((w) => (
                  <div key={w.value} className="flex items-baseline gap-3">
                    <span className="text-[10px] text-muted-foreground w-16 shrink-0">{w.label}</span>
                    <span className="text-base text-foreground truncate" style={{ fontWeight: w.value }}>
                      {previewText || "Type something above..."}
                    </span>
                  </div>
                ))}
              </div>

              {/* Character set */}
              <div className={`${font.class} text-xs text-muted-foreground`}>
                Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz 0123456789
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}

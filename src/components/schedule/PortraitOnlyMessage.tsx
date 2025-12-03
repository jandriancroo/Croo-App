import { RotateCcw, Smartphone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function PortraitOnlyMessage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md text-center">
        <CardContent className="pt-8 pb-8 space-y-6">
          <div className="relative mx-auto w-24 h-24">
            <Smartphone className="w-24 h-24 text-muted-foreground/50 rotate-90" />
            <RotateCcw className="w-8 h-8 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" style={{ animationDuration: '3s' }} />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Rotate to Portrait</h2>
            <p className="text-muted-foreground">
              Please rotate your device to portrait orientation to view your shifts.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

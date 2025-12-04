import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CompletedStampPreview = () => {
  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="text-2xl font-bold mb-6 text-center">Choose Your "COMPLETED" Stamp Style</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {/* Option 1: Military Classified */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-center">Option 1: Military Classified</h2>
          <Card className="relative overflow-hidden h-48">
            <div className="blur-[2px]">
              <CardHeader className="py-3">
                <CardTitle className="text-base">Morning Line Check</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground">5 out of 5</div>
                <div className="text-2xl font-bold text-primary">100%</div>
              </CardContent>
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ bottom: '40px' }}>
              <div 
                className="font-black text-2xl tracking-widest text-red-600 uppercase"
                style={{
                  transform: 'rotate(-12deg)',
                  textShadow: '1px 1px 0 rgba(0,0,0,0.2)',
                  border: '3px double currentColor',
                  padding: '6px 20px',
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  letterSpacing: '0.15em',
                }}
              >
                COMPLETED
              </div>
            </div>
          </Card>
          <p className="text-sm text-muted-foreground text-center">Bold red, stencil-style, double border</p>
        </div>

        {/* Option 2: Vintage Approval */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-center">Option 2: Vintage Approval</h2>
          <Card className="relative overflow-hidden h-48">
            <div className="blur-[2px]">
              <CardHeader className="py-3">
                <CardTitle className="text-base">Morning Line Check</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground">5 out of 5</div>
                <div className="text-2xl font-bold text-primary">100%</div>
              </CardContent>
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ bottom: '40px' }}>
              <div 
                className="flex flex-col items-center justify-center text-green-600"
                style={{
                  width: '100px',
                  height: '100px',
                  border: '4px solid currentColor',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  transform: 'rotate(-8deg)',
                }}
              >
                <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-wide">Complete</span>
              </div>
            </div>
          </Card>
          <p className="text-sm text-muted-foreground text-center">Circular seal with checkmark</p>
        </div>

        {/* Option 3: Modern Minimal */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-center">Option 3: Modern Minimal</h2>
          <Card className="relative overflow-hidden h-48">
            <div className="blur-[2px]">
              <CardHeader className="py-3">
                <CardTitle className="text-base">Morning Line Check</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground">5 out of 5</div>
                <div className="text-2xl font-bold text-primary">100%</div>
              </CardContent>
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ bottom: '40px' }}>
              <div 
                className="px-6 py-2 text-white font-semibold text-lg uppercase tracking-wider"
                style={{
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  borderRadius: '4px',
                  transform: 'rotate(-3deg)',
                  boxShadow: '0 4px 12px rgba(34, 197, 94, 0.4)',
                }}
              >
                ✓ Completed
              </div>
            </div>
          </Card>
          <p className="text-sm text-muted-foreground text-center">Green banner, gradient, sleek</p>
        </div>
      </div>
    </div>
  );
};

export default CompletedStampPreview;

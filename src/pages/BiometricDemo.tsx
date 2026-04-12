import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Shield, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type DemoPhase = 'pin' | 'scanning' | 'verified';

export default function BiometricDemo() {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<DemoPhase>('pin');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLineY, setScanLineY] = useState(0);
  const [showDots, setShowDots] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 480, height: 480 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.log('Camera not available:', err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // When PIN is complete, go to scanning
  useEffect(() => {
    if (pin.length === 4) {
      setPhase('scanning');
      startCamera();
    }
  }, [pin, startCamera]);

  // Scanning animation
  useEffect(() => {
    if (phase !== 'scanning') return;

    let start: number | null = null;
    const SCAN_DURATION = 3000; // 3 seconds

    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const progress = Math.min(elapsed / SCAN_DURATION, 1);

      setScanProgress(progress);
      // Scan line bounces up and down
      const cycle = (elapsed % 1500) / 1500;
      setScanLineY(cycle < 0.5 ? cycle * 2 : 2 - cycle * 2);

      // Show facial dots at 40%
      if (progress > 0.4) setShowDots(true);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Done scanning
        setPhase('verified');
        setTimeout(() => {
          stopCamera();
        }, 2000);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [phase, stopCamera]);

  // Reset
  const handleReset = () => {
    setPin('');
    setPhase('pin');
    setScanProgress(0);
    setScanLineY(0);
    setShowDots(false);
    stopCamera();
  };

  const handleNumberClick = (num: string) => {
    if (pin.length < 4) setPin(prev => prev + num);
  };

  const handleClear = () => setPin('');
  const handleBackspace = () => setPin(prev => prev.slice(0, -1));

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4">
      {/* Back button */}
      <Button
        variant="ghost"
        className="absolute top-4 left-4 text-neutral-400 hover:text-white"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft className="h-4 w-4 mr-2" /> Back
      </Button>

      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center justify-center gap-2">
          <Shield className="h-6 w-6 text-emerald-400" />
          Biometric Punch Clock
        </h1>
        <p className="text-neutral-500 text-sm mt-1">Preview Demo</p>
      </div>

      <Card className="w-full max-w-md bg-neutral-800 border-neutral-700 overflow-hidden">
        <CardContent className="p-0">
          {/* === PIN PHASE === */}
          {phase === 'pin' && (
            <div className="p-8 space-y-6">
              <div className="text-center">
                <p className="text-neutral-400 text-sm font-medium mb-4">Enter Your PIN</p>
                <div className="flex items-center justify-center gap-3 h-14">
                  {[0, 1, 2, 3].map(i => (
                    <div
                      key={i}
                      className={`w-11 h-11 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all duration-200 ${
                        pin.length > i
                          ? 'bg-primary border-primary text-primary-foreground scale-105 shadow-lg'
                          : 'bg-neutral-700/50 border-neutral-600'
                      }`}
                    >
                      {pin.length > i ? '•' : ''}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                  <Button
                    key={num}
                    variant="outline"
                    size="lg"
                    className="h-16 text-2xl font-bold rounded-xl border-2 bg-neutral-700 border-neutral-600 text-white hover:bg-primary hover:text-primary-foreground hover:border-primary active:scale-95 transition-all duration-150"
                    onClick={() => handleNumberClick(num.toString())}
                  >
                    {num}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-16 text-sm font-medium rounded-xl text-neutral-400 hover:bg-destructive/10 hover:text-destructive active:scale-95"
                  onClick={handleClear}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-16 text-2xl font-bold rounded-xl border-2 bg-neutral-700 border-neutral-600 text-white hover:bg-primary hover:text-primary-foreground hover:border-primary active:scale-95 transition-all duration-150"
                  onClick={() => handleNumberClick('0')}
                >
                  0
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-16 text-xl font-medium rounded-xl text-neutral-400 hover:bg-neutral-700 active:scale-95"
                  onClick={handleBackspace}
                >
                  ⌫
                </Button>
              </div>
            </div>
          )}

          {/* === SCANNING PHASE === */}
          {phase === 'scanning' && (
            <div className="relative">
              {/* Camera feed */}
              <div className="relative w-full aspect-square bg-black overflow-hidden">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />

                {/* Dark overlay with scan grid */}
                <div className="absolute inset-0 bg-black/20" />

                {/* Corner brackets */}
                <div className="absolute inset-8">
                  {/* Top-left */}
                  <div className="absolute top-0 left-0 w-10 h-10 border-l-2 border-t-2 border-emerald-400 rounded-tl-lg" />
                  {/* Top-right */}
                  <div className="absolute top-0 right-0 w-10 h-10 border-r-2 border-t-2 border-emerald-400 rounded-tr-lg" />
                  {/* Bottom-left */}
                  <div className="absolute bottom-0 left-0 w-10 h-10 border-l-2 border-b-2 border-emerald-400 rounded-bl-lg" />
                  {/* Bottom-right */}
                  <div className="absolute bottom-0 right-0 w-10 h-10 border-r-2 border-b-2 border-emerald-400 rounded-br-lg" />
                </div>

                {/* Scan line */}
                <div
                  className="absolute left-6 right-6 h-0.5 transition-none"
                  style={{
                    top: `${8 + scanLineY * 84}%`,
                    background: 'linear-gradient(90deg, transparent, #34d399, #10b981, #34d399, transparent)',
                    boxShadow: '0 0 20px 4px rgba(52, 211, 153, 0.4)',
                  }}
                />

                {/* Facial landmark dots */}
                {showDots && (
                  <div className="absolute inset-0" style={{ opacity: showDots ? 1 : 0, transition: 'opacity 0.5s' }}>
                    {/* Left eye */}
                    <div className="absolute w-3 h-3 rounded-full border-2 border-emerald-400 bg-emerald-400/30 animate-pulse"
                      style={{ top: '38%', left: '38%' }}
                    />
                    <div className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400"
                      style={{ top: '39%', left: '39%' }}
                    />
                    
                    {/* Right eye */}
                    <div className="absolute w-3 h-3 rounded-full border-2 border-emerald-400 bg-emerald-400/30 animate-pulse"
                      style={{ top: '38%', left: '58%' }}
                    />
                    <div className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400"
                      style={{ top: '39%', left: '59%' }}
                    />

                    {/* Nose bridge */}
                    <div className="absolute w-2 h-2 rounded-full border border-emerald-400/60 bg-emerald-400/20"
                      style={{ top: '46%', left: '48.5%' }}
                    />

                    {/* Nose tip */}
                    <div className="absolute w-2.5 h-2.5 rounded-full border-2 border-emerald-400 bg-emerald-400/30"
                      style={{ top: '52%', left: '48%' }}
                    />

                    {/* Left lip corner */}
                    <div className="absolute w-2 h-2 rounded-full border border-emerald-400 bg-emerald-400/30 animate-pulse"
                      style={{ top: '60%', left: '41%' }}
                    />
                    {/* Right lip corner */}
                    <div className="absolute w-2 h-2 rounded-full border border-emerald-400 bg-emerald-400/30 animate-pulse"
                      style={{ top: '60%', left: '56%' }}
                    />
                    {/* Upper lip center */}
                    <div className="absolute w-2 h-2 rounded-full border border-emerald-400 bg-emerald-400/30"
                      style={{ top: '58%', left: '48.5%' }}
                    />
                    {/* Lower lip */}
                    <div className="absolute w-2 h-2 rounded-full border border-emerald-400/60 bg-emerald-400/20"
                      style={{ top: '63%', left: '48.5%' }}
                    />

                    {/* Jaw line dots */}
                    {[
                      { top: '50%', left: '30%' },
                      { top: '58%', left: '32%' },
                      { top: '65%', left: '36%' },
                      { top: '68%', left: '42%' },
                      { top: '69%', left: '48.5%' },
                      { top: '68%', left: '55%' },
                      { top: '65%', left: '61%' },
                      { top: '58%', left: '65%' },
                      { top: '50%', left: '67%' },
                    ].map((pos, i) => (
                      <div
                        key={i}
                        className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400/50"
                        style={pos}
                      />
                    ))}

                    {/* Connecting lines between eye dots */}
                    <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.3 }}>
                      {/* Left eye to right eye */}
                      <line x1="39%" y1="39.5%" x2="59%" y2="39.5%" stroke="#34d399" strokeWidth="1" />
                      {/* Left eye to nose */}
                      <line x1="39%" y1="39.5%" x2="49%" y2="52.5%" stroke="#34d399" strokeWidth="0.5" />
                      {/* Right eye to nose */}
                      <line x1="59%" y1="39.5%" x2="49%" y2="52.5%" stroke="#34d399" strokeWidth="0.5" />
                      {/* Nose to mouth */}
                      <line x1="49%" y1="52.5%" x2="49%" y2="58.5%" stroke="#34d399" strokeWidth="0.5" />
                      {/* Mouth line */}
                      <line x1="42%" y1="60.5%" x2="57%" y2="60.5%" stroke="#34d399" strokeWidth="0.5" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Scan status bar */}
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-400 font-mono flex items-center gap-2">
                    <Shield className="h-4 w-4 animate-pulse" />
                    {scanProgress < 0.3
                      ? 'Initializing biometric scan...'
                      : scanProgress < 0.6
                      ? 'Mapping facial landmarks...'
                      : scanProgress < 0.9
                      ? 'Verifying identity...'
                      : 'Finalizing...'}
                  </span>
                  <span className="text-neutral-500 font-mono">{Math.round(scanProgress * 100)}%</span>
                </div>
                <div className="w-full h-2 bg-neutral-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-100"
                    style={{ width: `${scanProgress * 100}%` }}
                  />
                </div>
                <p className="text-neutral-500 text-xs text-center">
                  Hold steady — scanning {Math.round(scanProgress * 68) + 32} facial reference points
                </p>
              </div>
            </div>
          )}

          {/* === VERIFIED PHASE === */}
          {phase === 'verified' && (
            <div className="p-12 text-center space-y-6">
              <div className="relative mx-auto w-24 h-24">
                {/* Pulse rings */}
                <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
                <div className="absolute inset-2 rounded-full bg-emerald-400/30 animate-ping" style={{ animationDelay: '0.2s' }} />
                <div className="relative flex items-center justify-center w-full h-full rounded-full bg-emerald-500/20 border-2 border-emerald-400">
                  <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-emerald-400">Identity Verified</h2>
                <p className="text-neutral-400 mt-1">Employee Biometrics Confirmed</p>
                <p className="text-neutral-600 text-xs mt-3 font-mono">
                  68 reference points matched • 99.7% confidence
                </p>
              </div>

              <div className="pt-4 space-y-3">
                <Button
                  className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl"
                  onClick={handleReset}
                >
                  Clock In
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-neutral-500 hover:text-neutral-300"
                  onClick={handleReset}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-neutral-600 text-xs mt-6 text-center max-w-sm">
        Demo only — photo is captured as an audit trail. The scan animation is a psychological deterrent, not active AI recognition.
      </p>
    </div>
  );
}

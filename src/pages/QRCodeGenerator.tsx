import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function QRCodeGenerator() {
  const url = "https://www.blazepizza.com/tellus";

  const downloadQR = () => {
    const svg = document.getElementById('qr-code');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = 400;
      canvas.height = 400;
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 400, 400);
        ctx.drawImage(img, 0, 0, 400, 400);
      }
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = 'blazepizza-tellus-qr.png';
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 bg-background">
      <h1 className="text-2xl font-bold">Blaze Pizza - Tell Us QR Code</h1>
      <div className="bg-white p-6 rounded-xl shadow-lg">
        <QRCodeSVG 
          id="qr-code"
          value={url}
          size={300}
          level="H"
          includeMargin
        />
      </div>
      <p className="text-muted-foreground text-sm">{url}</p>
      <Button onClick={downloadQR} className="gap-2">
        <Download className="h-4 w-4" />
        Download PNG
      </Button>
    </div>
  );
}

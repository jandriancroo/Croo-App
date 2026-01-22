import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Copy, Check, Printer, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface QRTaskCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  qrCode: string;
  accentColor: string;
}

export function QRTaskCodeDialog({ 
  open, 
  onOpenChange, 
  taskTitle, 
  qrCode,
  accentColor 
}: QRTaskCodeDialogProps) {
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  
  const qrUrl = `${window.location.origin}/qr/${qrCode}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(qrUrl);
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleDownload = () => {
    const svg = document.getElementById('qr-task-code');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = 400;
      canvas.height = 500; // Extra height for title
      if (ctx) {
        // White background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 400, 500);
        
        // Draw QR code
        ctx.drawImage(img, 50, 50, 300, 300);
        
        // Draw title
        ctx.fillStyle = '#000';
        ctx.font = 'bold 24px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(taskTitle, 200, 400);
        
        // Draw instruction
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#666';
        ctx.fillText('Scan to report an issue', 200, 440);
      }
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = `qr-task-${qrCode}.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow popups to print');
      return;
    }

    const svg = document.getElementById('qr-task-code');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBase64 = btoa(unescape(encodeURIComponent(svgData)));

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print QR Code - ${taskTitle}</title>
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              font-family: system-ui, sans-serif;
            }
            .container {
              text-align: center;
              padding: 40px;
            }
            img {
              width: 300px;
              height: 300px;
            }
            h1 {
              margin-top: 20px;
              font-size: 28px;
            }
            p {
              color: #666;
              margin-top: 10px;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <img src="data:image/svg+xml;base64,${svgBase64}" alt="QR Code" />
            <h1>${taskTitle}</h1>
            <p>Scan to report an issue</p>
          </div>
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleOpenPreview = () => {
    window.open(qrUrl, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>QR Code Ready</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center py-4 space-y-4">
          <div 
            ref={qrRef}
            className="bg-white p-4 rounded-xl shadow-sm border"
          >
            <QRCodeSVG 
              id="qr-task-code"
              value={qrUrl}
              size={200}
              level="H"
              includeMargin
              fgColor={accentColor}
            />
          </div>
          
          <div className="text-center">
            <p className="font-semibold">{taskTitle}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Guests scan this to report issues
            </p>
          </div>

          <div className="flex gap-2 w-full">
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 gap-1.5"
              onClick={handleCopyLink}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy Link'}
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 gap-1.5"
              onClick={handleOpenPreview}
            >
              <ExternalLink className="h-4 w-4" />
              Preview
            </Button>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button 
            variant="outline" 
            className="flex-1 gap-2"
            onClick={handlePrint}
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button 
            className="flex-1 gap-2"
            style={{ backgroundColor: accentColor }}
            onClick={handleDownload}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

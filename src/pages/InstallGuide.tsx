import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Smartphone, Share, MoreVertical, Download, Plus } from "lucide-react";
import crooLogo from "@/assets/croo-logo.png";

export default function InstallGuide() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <img src={crooLogo} alt="Croo" width={133} height={64} className="h-16 mx-auto" />
          <h1 className="text-3xl font-bold text-foreground">Add Croo to Your Home Screen</h1>
          <p className="text-muted-foreground">Get quick access to Croo just like a native app!</p>
        </div>

        {/* Instructions Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* iOS Instructions */}
          <Card className="border-2">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mb-2">
                <Smartphone className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-xl">iPhone / iPad</CardTitle>
              <p className="text-sm text-muted-foreground">Using Safari Browser</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <p className="font-medium">Open in Safari</p>
                  <p className="text-sm text-muted-foreground">Make sure you're using the Safari browser (not Chrome or another browser)</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <p className="font-medium">Tap the Share Button</p>
                  <p className="text-sm text-muted-foreground">Look for the share icon at the bottom of Safari</p>
                  <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                    <Share className="h-5 w-5" />
                    <span className="text-sm">Share</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <p className="font-medium">Add to Home Screen</p>
                  <p className="text-sm text-muted-foreground">Scroll down and tap "Add to Home Screen"</p>
                  <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                    <Plus className="h-5 w-5" />
                    <span className="text-sm">Add to Home Screen</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  4
                </div>
                <div>
                  <p className="font-medium">Confirm</p>
                  <p className="text-sm text-muted-foreground">Tap "Add" in the top right corner</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Android Instructions */}
          <Card className="border-2">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mb-2">
                <Smartphone className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-xl">Android</CardTitle>
              <p className="text-sm text-muted-foreground">Using Chrome Browser</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <p className="font-medium">Open in Chrome</p>
                  <p className="text-sm text-muted-foreground">Make sure you're using the Chrome browser</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <p className="font-medium">Tap the Menu</p>
                  <p className="text-sm text-muted-foreground">Look for the three dots in the top right corner</p>
                  <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                    <MoreVertical className="h-5 w-5" />
                    <span className="text-sm">Menu</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <p className="font-medium">Install App</p>
                  <p className="text-sm text-muted-foreground">Tap "Install app" or "Add to Home screen"</p>
                  <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                    <Download className="h-5 w-5" />
                    <span className="text-sm">Install app</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  4
                </div>
                <div>
                  <p className="font-medium">Confirm</p>
                  <p className="text-sm text-muted-foreground">Tap "Install" to add Croo to your home screen</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>Once installed, you can open Croo directly from your home screen!</p>
        </div>
      </div>
    </div>
  );
}

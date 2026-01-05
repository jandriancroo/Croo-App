import { DollarSign, Save, X, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InventoryCountDockProps {
  totalValue: number;
  countedItems: number;
  totalItems: number;
  isSaving?: boolean;
  isListening?: boolean;
  isVoiceSupported?: boolean;
  onSave: () => void;
  onExit: () => void;
  onToggleVoice?: () => void;
}

export const InventoryCountDock = ({
  totalValue,
  countedItems,
  totalItems,
  isSaving = false,
  isListening = false,
  isVoiceSupported = false,
  onSave,
  onExit,
  onToggleVoice,
}: InventoryCountDockProps) => {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <div className="glass-dock">
        <div className="relative z-10 flex items-center justify-between px-3 pt-3 pb-0 gap-2">
          {/* Exit button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onExit}
            className="h-12 w-12 flex-shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-6 w-6" />
          </Button>

          {/* Stats in center */}
          <div className="flex-1 flex items-center justify-center gap-4">
            {/* Items counted */}
            <div className="text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Items</p>
              <p className="text-lg font-bold">
                {countedItems}<span className="text-muted-foreground font-normal">/{totalItems}</span>
              </p>
            </div>
            
            {/* Divider */}
            <div className="h-8 w-px bg-border" />
            
            {/* Total value */}
            <div className="text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Value</p>
              <p className="text-lg font-bold text-primary flex items-center justify-center gap-1">
                <DollarSign className="h-4 w-4" />
                {formatCurrency(totalValue).replace('$', '')}
              </p>
            </div>
          </div>

          {/* Voice button (optional) */}
          {isVoiceSupported && onToggleVoice && (
            <Button
              variant={isListening ? "destructive" : "ghost"}
              size="icon"
              onClick={onToggleVoice}
              className={cn(
                "h-12 w-12 flex-shrink-0 relative",
                !isListening && "text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
              )}
            >
              {isListening ? (
                <MicOff className="h-6 w-6" />
              ) : (
                <Mic className="h-6 w-6" />
              )}
              {isListening && (
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full animate-ping" />
              )}
            </Button>
          )}

          {/* Save button */}
          <Button
            onClick={onSave}
            disabled={isSaving}
            className="h-12 px-5 flex-shrink-0 bg-primary hover:bg-primary/90"
          >
            <Save className="h-5 w-5 mr-2" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
        {/* Safe area spacer */}
        <div style={{ height: 'max(8px, calc(env(safe-area-inset-bottom, 0px) * 0.5))' }} />
      </div>
    </div>
  );
};

export default InventoryCountDock;

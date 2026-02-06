import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MarketplaceIconSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  onIconSelected: () => void;
}

export function MarketplaceIconSelector({ open, onOpenChange, chatId, onIconSelected }: MarketplaceIconSelectorProps) {
  const [icons, setIcons] = useState<{ variant: number; url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIcon, setSelectedIcon] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open) {
      generateIcons();
    }
  }, [open]);

  const generateIcons = async () => {
    setLoading(true);
    try {
      const generatedIcons = [];
      
      for (let i = 1; i <= 3; i++) {
        const { data, error } = await supabase.functions.invoke('image-service?action=generate-marketplace-icon', {
          body: { variant: i }
        });

        if (error) throw error;
        if (data?.imageUrl) {
          generatedIcons.push({ variant: i, url: data.imageUrl });
        }
      }

      setIcons(generatedIcons);
    } catch (error: any) {
      console.error('Error generating icons:', error);
      toast.error('Failed to generate icons');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyIcon = async () => {
    if (selectedIcon === null) return;

    const icon = icons.find(i => i.variant === selectedIcon);
    if (!icon) return;

    setApplying(true);
    try {
      // Convert base64 to blob
      const base64Data = icon.url.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });

      // Upload to storage
      const fileName = `marketplace-icon-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(fileName);

      // Update chat with new icon
      const { error: updateError } = await supabase
        .from('chats')
        .update({ group_image_url: publicUrl })
        .eq('id', chatId);

      if (updateError) throw updateError;

      toast.success('Icon applied successfully!');
      onIconSelected();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error applying icon:', error);
      toast.error('Failed to apply icon');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose Shift Marketplace Icon</DialogTitle>
          <DialogDescription>
            Select your favorite icon design for the Shift Marketplace chat
          </DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-3 text-muted-foreground">Generating icons...</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {icons.map((icon) => (
                <button
                  key={icon.variant}
                  onClick={() => setSelectedIcon(icon.variant)}
                  className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                    selectedIcon === icon.variant
                      ? 'border-primary shadow-lg scale-105'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <img
                    src={icon.url}
                    alt={`Icon option ${icon.variant}`}
                    className="w-full h-full object-cover aspect-square"
                  />
                  {selectedIcon === icon.variant && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <div className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-sm font-semibold">
                        Selected
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
            
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleApplyIcon} 
                disabled={selectedIcon === null || applying}
              >
                {applying ? 'Applying...' : 'Apply Icon'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

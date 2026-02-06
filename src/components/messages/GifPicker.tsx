import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageIcon, Search, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
}

interface GiphyGif {
  id: string;
  images: {
    fixed_height: {
      url: string;
    };
    fixed_height_small: {
      url: string;
    };
    original: {
      url: string;
    };
  };
}

export function GifPicker({ onSelect }: GifPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [categories] = useState(['trending', 'reactions', 'funny', 'happy', 'sad', 'love', 'excited', 'wow']);

  const fetchGifs = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('utility-service?action=fetch-gifs', {
        body: { search: query }
      });
      
      if (error) throw error;
      setGifs(data?.gifs || []);
    } catch (error) {
      console.error('Error fetching GIFs:', error);
      setGifs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchGifs('');
    }
  }, [open, fetchGifs]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (open && search) {
        fetchGifs(search);
      } else if (open && !search) {
        fetchGifs('');
      }
    }, 300);
    return () => clearTimeout(debounce);
  }, [search, open, fetchGifs]);

  const handleSelect = (gif: GiphyGif) => {
    const gifUrl = gif.images.fixed_height?.url || gif.images.original?.url;
    if (gifUrl) {
      onSelect(gifUrl);
      setOpen(false);
      setSearch('');
    }
  };

  const handleCategoryClick = (category: string) => {
    setSearch(category);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" type="button">
          <ImageIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" side="top">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search GIFs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-9"
            />
            {search && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                onClick={() => setSearch('')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          {!search && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant="secondary"
                  size="sm"
                  className="h-6 text-xs capitalize"
                  onClick={() => handleCategoryClick(cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>
          )}
        </div>
        <ScrollArea className="h-64">
          <div className="p-2">
            {loading ? (
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-video rounded" />
                ))}
              </div>
            ) : gifs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No GIFs found
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {gifs.map((gif) => (
                  <button
                    key={gif.id}
                    onClick={() => handleSelect(gif)}
                    className="relative aspect-video overflow-hidden rounded hover:ring-2 hover:ring-primary transition-all"
                  >
                    <img
                      src={gif.images.fixed_height_small?.url || gif.images.fixed_height?.url}
                      alt="GIF"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">Powered by GIPHY</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

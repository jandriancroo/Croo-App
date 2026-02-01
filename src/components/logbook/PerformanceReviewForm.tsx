import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ChevronsUpDown, Loader2, Star, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PerformanceReviewFormProps {
  onSave: (data: PerformanceReviewData) => Promise<void>;
  isSaving: boolean;
}

export interface PerformanceReviewData {
  employeeId: string;
  employeeName: string;
  ratings: { itemId: string; itemName: string; rating: number; notes: string; imageUrls?: string[] }[];
  followUpNotes: string;
}

interface RatingItem {
  id: string;
  name: string;
  description: string | null;
  rating: number;
  notes: string;
}

// Star Rating Component
function StarRating({ 
  value, 
  onChange, 
  max = 10 
}: { 
  value: number; 
  onChange: (value: number) => void; 
  max?: number;
}) {
  const [hoverValue, setHoverValue] = useState(0);

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
        <button
          key={star}
          type="button"
          className="p-0.5 transition-transform hover:scale-110 focus:outline-none"
          onMouseEnter={() => setHoverValue(star)}
          onMouseLeave={() => setHoverValue(0)}
          onClick={() => onChange(star)}
        >
          <Star
            className={cn(
              "h-5 w-5 transition-colors",
              (hoverValue || value) >= star
                ? "fill-primary text-primary"
                : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
      <span className="ml-2 text-sm font-medium text-muted-foreground">
        {value > 0 ? `${value}/10` : "Not rated"}
      </span>
    </div>
  );
}

export function PerformanceReviewForm({ onSave, isSaving }: PerformanceReviewFormProps) {
  const { currentLocation } = useAppLocation();
  
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [ratingItems, setRatingItems] = useState<RatingItem[]>([]);
  const [followUpNotes, setFollowUpNotes] = useState("");

  // Fetch employees for the location
  const { data: employees = [] } = useQuery({
    queryKey: ['location-employees-review', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data: userLocations, error: ulError } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);
      
      if (ulError) throw ulError;
      if (!userLocations || userLocations.length === 0) return [];
      
      const userIds = userLocations.map(ul => ul.user_id);
      
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', userIds)
        .eq('is_active', true)
        .order('full_name');
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation,
  });

  // Fetch review items for the location
  const { data: reviewItemsData = [] } = useQuery({
    queryKey: ['performance-review-items', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('performance_review_items')
        .select('*')
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .order('display_order');
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation,
  });

  // Initialize rating items when data loads
  useEffect(() => {
    if (reviewItemsData.length > 0 && ratingItems.length === 0) {
      setRatingItems(
        reviewItemsData.map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          rating: 0,
          notes: "",
        }))
      );
    }
  }, [reviewItemsData, ratingItems.length]);

  const updateRating = (itemId: string, field: 'rating' | 'notes', value: number | string) => {
    setRatingItems(prev => 
      prev.map(item => 
        item.id === itemId 
          ? { ...item, [field]: value }
          : item
      )
    );
  };

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      toast.error("Please select an employee");
      return;
    }

    // Check that at least one rating is provided
    const hasRatings = ratingItems.some(item => item.rating > 0);
    if (!hasRatings) {
      toast.error("Please provide at least one rating");
      return;
    }

    await onSave({
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.full_name,
      ratings: ratingItems
        .filter(item => item.rating > 0)
        .map(item => ({
          itemId: item.id,
          itemName: item.name,
          rating: item.rating,
          notes: item.notes,
        })),
      followUpNotes: followUpNotes.trim(),
    });
  };

  return (
    <div className="space-y-6">
      {/* Employee Selector */}
      <div className="space-y-2">
        <Label>Employee *</Label>
        <Popover open={employeeOpen} onOpenChange={setEmployeeOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={employeeOpen}
              className="w-full justify-between"
            >
              {selectedEmployee ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={selectedEmployee.profile_photo_url} />
                    <AvatarFallback><User className="h-3 w-3" /></AvatarFallback>
                  </Avatar>
                  {selectedEmployee.full_name}
                </div>
              ) : (
                "Select employee..."
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0">
            <Command>
              <CommandInput placeholder="Search employees..." />
              <CommandList>
                <CommandEmpty>No employee found.</CommandEmpty>
                <CommandGroup>
                  {employees.map((employee: any) => (
                    <CommandItem
                      key={employee.id}
                      value={employee.full_name}
                      onSelect={() => {
                        setSelectedEmployee(employee);
                        setEmployeeOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={employee.profile_photo_url} />
                          <AvatarFallback><User className="h-3 w-3" /></AvatarFallback>
                        </Avatar>
                        {employee.full_name}
                      </div>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          selectedEmployee?.id === employee.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Rating Items */}
      <div className="space-y-4">
        <Label className="text-base font-semibold">Performance Ratings</Label>
        {ratingItems.map((item) => (
          <Card key={item.id} className="overflow-hidden">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{item.name}</span>
                {item.description && (
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                )}
              </div>
              <StarRating
                value={item.rating}
                onChange={(value) => updateRating(item.id, 'rating', value)}
              />
              <Textarea
                placeholder="Notes for this rating (optional)..."
                value={item.notes}
                onChange={(e) => updateRating(item.id, 'notes', e.target.value)}
                rows={2}
                className="text-sm"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Follow-up Notes */}
      <div className="space-y-2">
        <Label>Follow-Up Notes</Label>
        <Textarea
          placeholder="Overall feedback, goals, and action items for the employee..."
          value={followUpNotes}
          onChange={(e) => setFollowUpNotes(e.target.value)}
          rows={4}
        />
      </div>

      {/* Submit Button */}
      <Button 
        onClick={handleSubmit} 
        disabled={isSaving || !selectedEmployee || !ratingItems.some(item => item.rating > 0)}
        className="w-full"
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Submitting Review...
          </>
        ) : (
          "Submit Performance Review"
        )}
      </Button>
    </div>
  );
}

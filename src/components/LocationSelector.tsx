import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocation } from "@/hooks/useLocation";
import { MapPin } from "lucide-react";
import { LocationPickerDialog } from "./LocationPickerDialog";
import { formatLocationName } from "@/utils/locationUtils";
import { toast } from "sonner";

export const LocationSelector = () => {
  const { currentLocation, setCurrentLocation } = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!currentLocation) {
    return null;
  }

  return (
    <>
      <Button 
        variant="outline" 
        className="gap-2 h-10"
        data-location-switcher
        onClick={() => setDialogOpen(true)}
      >
        <MapPin className="h-4 w-4" />
        <span className="hidden sm:inline">{formatLocationName(currentLocation.name, currentLocation.store_number)}</span>
      </Button>

      <LocationPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentLocationId={currentLocation.id}
        onSelectLocation={(loc) => {
          setCurrentLocation({
            id: loc.id,
            name: loc.name,
            location_type: loc.location_type,
            store_number: loc.store_number,
            organization_id: loc.organization_id ?? undefined,
          });

          const displayName = loc.store_number ? `#${loc.store_number} ${loc.name}` : loc.name;
          toast.success(`Switched to ${displayName}`);
        }}
      />
    </>
  );
};


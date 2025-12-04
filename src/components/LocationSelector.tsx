import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocation } from "@/hooks/useLocation";
import { MapPin } from "lucide-react";
import { LocationPickerDialog } from "./LocationPickerDialog";

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
        onClick={() => setDialogOpen(true)}
      >
        <MapPin className="h-4 w-4" />
        <span className="hidden sm:inline">{currentLocation.name}</span>
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
          });
        }}
      />
    </>
  );
};

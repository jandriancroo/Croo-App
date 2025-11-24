import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation } from "@/hooks/useLocation";
import { MapPin, ChevronDown } from "lucide-react";

export const LocationSelector = () => {
  const { currentLocation, locations, setCurrentLocation } = useLocation();

  if (!currentLocation || locations.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <MapPin className="h-4 w-4" />
          <span className="hidden sm:inline">{currentLocation.name}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {locations.map((location) => (
          <DropdownMenuItem
            key={location.id}
            onClick={() => setCurrentLocation(location)}
            className={currentLocation.id === location.id ? "bg-accent" : ""}
          >
            {location.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

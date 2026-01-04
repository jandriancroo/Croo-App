import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import crooLogo from '@/assets/croo-logo.png';

interface CrowSplashAnimationProps {
  onComplete: () => void;
  logoUrl?: string; // Optional override
}

const CrowSplashAnimation: React.FC<CrowSplashAnimationProps> = ({ onComplete, logoUrl }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const { currentLocation } = useAppLocation();

  // Fetch brand logo if not provided
  const { data: brandLogo } = useQuery({
    queryKey: ['splash-brand-logo', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      
      // Get location's organization
      const { data: locationData } = await supabase
        .from('locations')
        .select('organization_id')
        .eq('id', currentLocation.id)
        .single();
      
      if (!locationData?.organization_id) return null;
      
      // Get org with brand
      const { data: orgData } = await supabase
        .from('organizations')
        .select('logo_url, brand_id')
        .eq('id', locationData.organization_id)
        .single();
      
      if (!orgData) return null;
      
      // If org has a brand_id, fetch the brand logo
      if (orgData.brand_id) {
        const { data: brandData } = await supabase
          .from('brands')
          .select('logo_url')
          .eq('id', orgData.brand_id)
          .single();
        
        if (brandData?.logo_url) return brandData.logo_url;
      }
      
      return orgData.logo_url || null;
    },
    enabled: !logoUrl && !!currentLocation?.id,
    staleTime: Infinity, // Cache indefinitely for this session
  });

  const displayLogo = logoUrl || brandLogo || crooLogo;

  useEffect(() => {
    const welcomeTimer = setTimeout(() => setShowWelcome(true), 100);
    const fadeTimer = setTimeout(() => setFadeOut(true), 1200);
    const completeTimer = setTimeout(() => onComplete(), 1700);
    
    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden transition-all duration-500 ease-out ${
        fadeOut ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      }`}
      style={{
        background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.8) 50%, hsl(var(--accent)) 100%)'
      }}
    >
      {/* Logo */}
      <div className="animate-fade-in">
        <img 
          src={displayLogo} 
          alt="Logo" 
          className="h-28 w-auto drop-shadow-lg"
        />
      </div>

      {/* Welcome text */}
      <div 
        className={`mt-4 transition-all duration-400 ${
          showWelcome 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-4'
        }`}
      >
        <span 
          className="font-pacifico text-5xl md:text-6xl text-primary-foreground drop-shadow-md"
        >
          welcome
        </span>
      </div>
    </div>
  );
};

export default CrowSplashAnimation;

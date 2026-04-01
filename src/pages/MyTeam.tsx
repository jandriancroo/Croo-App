import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Loader2, Users, Phone, Cake } from 'lucide-react';
import { format } from 'date-fns';
import { getDisplayName, getInitials } from '@/utils/displayName';

interface TeamMember {
  id: string;
  full_name: string | null;
  nickname: string | null;
  profile_photo_url: string | null;
  phone_number: string | null;
  birthday: string | null;
}

const parseDateOnlyToLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export default function MyTeam() {
  const { currentLocation } = useAppLocation();

  const { data: teamMembers = [], isLoading } = useQuery({
    queryKey: ['my-team', currentLocation?.id],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      // Get users at current location
      const { data: userLocations } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);

      const userIds = userLocations?.map(ul => ul.user_id) || [];
      if (userIds.length === 0) return [];

      // Fetch basic profile info only
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, nickname, profile_photo_url, phone_number, birthday')
        .in('id', userIds)
        .eq('is_active', true)
        .order('full_name', { ascending: true });

      if (error) throw error;
      return profiles as TeamMember[];
    },
    enabled: !!currentLocation?.id,
  });

  const formatBirthday = (birthday: string | null) => {
    if (!birthday) return null;
    try {
      const date = parseDateOnlyToLocalDate(birthday);
      return format(date, 'MMMM d');
    } catch {
      return null;
    }
  };

  const formatPhone = (phone: string | null) => {
    if (!phone) return null;
    // Simple formatting - just return as-is if already formatted
    return phone;
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8" />
            My Team
          </h1>
          <p className="text-muted-foreground">
            {teamMembers.length} team member{teamMembers.length !== 1 ? 's' : ''} at {currentLocation?.name || 'this location'}
          </p>
        </div>

        {teamMembers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No team members found at this location
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {teamMembers.map((member) => {
              const displayName = getDisplayName(member.full_name, (member as any).nickname);
              return (
              <Card key={member.id} className="p-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={member.profile_photo_url || undefined} />
                    <AvatarFallback>
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {displayName}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {formatPhone(member.phone_number) && (
                        <a 
                          href={`tel:${member.phone_number}`}
                          className="flex items-center gap-1 hover:text-primary"
                        >
                          <Phone className="h-3 w-3" />
                          {formatPhone(member.phone_number)}
                        </a>
                      )}
                      {formatBirthday(member.birthday) && (
                        <span className="flex items-center gap-1">
                          <Cake className="h-3 w-3" />
                          {formatBirthday(member.birthday)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}

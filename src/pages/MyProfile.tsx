import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera, Loader2, Check, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CalendarIcon } from 'lucide-react';

const parseDateOnlyToLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const MyProfile = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  // Form state (initialized from query data)
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [birthday, setBirthday] = useState<Date | undefined>(undefined);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);

  // Crop dialog state
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [tempImageSrc, setTempImageSrc] = useState<string>('');

  // React Query for profile with caching
  const { data: profile, isLoading: loading } = useQuery({
    queryKey: queryKeys.users.selfProfile(user?.id || ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, email, phone_number, birthday, profile_photo_url, croo_cash_balance, nickname')
        .eq('id', user!.id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 min cache
    gcTime: 30 * 60 * 1000,
  });

  // Initialize form when profile loads (only once)
  if (profile && !formInitialized) {
    setFullName(profile.full_name || '');
    setNickname((profile as any).nickname || '');
    setPhoneNumber(profile.phone_number || '');
    setBirthday(profile.birthday ? parseDateOnlyToLocalDate(profile.birthday) : undefined);
    setProfilePhotoUrl(profile.profile_photo_url);
    setFormInitialized(true);
  }

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be less than 10MB');
      return;
    }

    // Open crop dialog
    const reader = new FileReader();
    reader.onload = (event) => {
      setTempImageSrc(event.target?.result as string);
      setCropDialogOpen(true);
    };
    reader.readAsDataURL(file);

    // Reset input
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (!user) return;

    setUploadingPhoto(true);
    setCropDialogOpen(false);

    try {
      const file = new File([croppedBlob], 'profile.jpg', { type: 'image/jpeg' });
      const compressedFile = await compressImage(file, 400, 400, 0.85);
      const filePath = `${user.id}/${Date.now()}.jpg`;

      const result = await uploadWithRetry(supabase, 'profile-photos', filePath, compressedFile, 3);
      setProfilePhotoUrl(result.publicUrl);
      toast.success('Photo uploaded');
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      toast.error('Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);

    try {
      const updatePayload: Record<string, any> = {
        full_name: fullName.trim() || null,
        nickname: nickname.trim() || null,
        phone_number: phoneNumber.trim() || null,
        birthday: birthday ? format(birthday, 'yyyy-MM-dd') : null,
      };

      if (profilePhotoUrl !== profile?.profile_photo_url) {
        updatePayload.profile_photo_url = profilePhotoUrl;
      }

      const { error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id);

      if (error) throw error;

      // Also update auth user metadata for profile photo
      if (profilePhotoUrl !== profile?.profile_photo_url) {
        await supabase.auth.updateUser({
          data: {
            profile_photo_url: profilePhotoUrl,
          },
        });
      }

      toast.success('Profile updated');
      navigate(-1);
    } catch (error: any) {
      console.error('Error saving profile:', error);
      toast.error(error.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
      <div className="max-w-lg mx-auto">
        <div className="mb-4">
          <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>My Profile</CardTitle>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Profile Photo */}
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-24 w-24">
                <AvatarImage src={profilePhotoUrl || undefined} />
                <AvatarFallback>
                  {uploadingPhoto ? (
                    <Loader2 className="h-8 w-8 animate-spin" />
                  ) : (
                    <Camera className="h-8 w-8 text-muted-foreground" />
                  )}
                </AvatarFallback>
              </Avatar>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
              >
                <Camera className="mr-2 h-4 w-4" />
                {profilePhotoUrl ? 'Change Photo' : 'Add Photo'}
              </Button>
            </div>

            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
              />
            </div>

            {/* Nickname */}
            <div className="space-y-2">
              <Label htmlFor="nickname">Nickname</Label>
              <Input
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Optional — replaces your first name for display"
              />
              <p className="text-xs text-muted-foreground">
                If set, your nickname will be shown instead of your first name across the app
              </p>
            </div>

            {/* Email (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={profile?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Contact your manager to change your email address
              </p>
            </div>

            {/* Phone Number */}
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>

            {/* Birthday */}
            <div className="space-y-2">
              <Label>Birthday</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !birthday && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {birthday ? format(birthday, 'MMMM d, yyyy') : 'Select your birthday'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={birthday}
                    onSelect={setBirthday}
                    defaultMonth={birthday || new Date(2000, 0)}
                    captionLayout="dropdown-buttons"
                    fromYear={1940}
                    toYear={new Date().getFullYear()}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Save Button */}
            <Button onClick={handleSave} className="w-full" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Crop Dialog */}
      <ImageCropDialog
        open={cropDialogOpen}
        onOpenChange={setCropDialogOpen}
        imageSrc={tempImageSrc}
        onCropComplete={handleCropComplete}
      />
    </Layout>
  );
};

export default MyProfile;

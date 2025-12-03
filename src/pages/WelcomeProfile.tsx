import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import { compressImage } from '@/utils/imageCompression';

const WelcomeProfile = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [birthday, setBirthday] = useState('');
  const [pizzaTopping, setPizzaTopping] = useState('');
  const [phone, setPhone] = useState('');
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) {
    navigate('/auth');
    return null;
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setProfilePhotoFile(file);
    setProfilePhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error('You must be logged in to complete your profile');
      navigate('/auth');
      return;
    }

    setSaving(true);

    try {
      let publicUrl: string | null = null;

      if (profilePhotoFile) {
        // Compress image to reduce memory usage
        const compressedFile = await compressImage(profilePhotoFile, 800, 800, 0.8);
        const filePath = `${user.id}/${Date.now()}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('profile-photos')
          .upload(filePath, compressedFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from('profile-photos')
          .getPublicUrl(filePath);

        publicUrl = data.publicUrl;
      }

      await supabase.auth.updateUser({
        data: {
          birthday: birthday || null,
          favorite_pizza_topping: pizzaTopping || null,
          phone_number: phone || null,
          ...(publicUrl ? { profile_photo_url: publicUrl } : {}),
        },
      });

      const updatePayload: Record<string, any> = {
        birthday: birthday || null,
        phone_number: phone || null,
      };

      if (publicUrl) {
        updatePayload.profile_photo_url = publicUrl;
      }

      await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id);

      toast.success('Profile updated!');
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/10 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-semibold">
            Welcome, {user.user_metadata.full_name || 'there'}!
          </CardTitle>
          <CardDescription>
            Let&apos;s finish setting up your profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-24 w-24">
                <AvatarImage src={profilePhotoPreview || user.user_metadata.profile_photo_url || undefined} />
                <AvatarFallback>
                  <Camera className="h-8 w-8 text-muted-foreground" />
                </AvatarFallback>
              </Avatar>
              <Input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="birthday">Birthday</Label>
              <Input
                id="birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pizza">Favorite Pizza Topping</Label>
              <Input
                id="pizza"
                type="text"
                placeholder="Pepperoni, mushrooms, olives..."
                value={pizzaTopping}
                onChange={(e) => setPizzaTopping(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving...' : 'Continue to Dashboard'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default WelcomeProfile;

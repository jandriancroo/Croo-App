import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Camera, Apple } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import crooLogo from '@/assets/croo-logo.png';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>('signin');

  const handleLocationCodeChange = (value: string) => {
    // Allow only letters and dashes, convert to lowercase
    const cleaned = value.replace(/[^a-zA-Z-]/g, '').toLowerCase();
    setLocationCode(cleaned);
  };

  useEffect(() => {
    // Check if signup parameter is in URL
    if (searchParams.get('signup') === 'true') {
      setActiveTab('signup');
    }
  }, [searchParams]);

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);
    
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Signed in successfully');
      navigate('/dashboard');
    }
    
    setLoading(false);
  };

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    setLoading(true);
    
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    
    if (error) {
      toast.error(error.message);
      setLoading(false);
    }
    // Don't set loading to false on success - page will redirect
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    try {
      setUploading(true);
      
      // Create a temporary URL for preview
      const tempUrl = URL.createObjectURL(file);
      setProfilePhoto(tempUrl);
      
      toast.success('Photo ready to upload');
    } catch (error: any) {
      toast.error('Failed to process image');
    } finally {
      setUploading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!profilePhoto) {
      toast.error('Please add a profile photo');
      return;
    }

    if (!locationCode.trim()) {
      toast.error('Please enter a location code');
      return;
    }
    
    setLoading(true);

    try {
      // Validate location code first (case-insensitive)
      const { data: location, error: locationError } = await supabase
        .from('locations')
        .select('id, name')
        .ilike('location_code', locationCode.trim())
        .single();

      if (locationError || !location) {
        toast.error('Invalid location code. Please check with your manager.');
        setLoading(false);
        return;
      }

      // First, upload the photo to storage with a temporary name
      const fileInput = fileInputRef.current;
      const file = fileInput?.files?.[0];
      
      if (!file) {
        toast.error('Please select a photo');
        return;
      }

      // Generate a unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `temp/${Date.now()}.${fileExt}`;
      
      const { error: uploadError, data } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(fileName);

      // Now sign up with the photo URL
      const { error } = await signUp(email, password, fullName, publicUrl);
      
      if (error) {
        // Clean up uploaded photo if signup fails
        await supabase.storage
          .from('profile-photos')
          .remove([fileName]);
        throw error;
      }

      // Get the newly created user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Assign user to location
        const { error: locationAssignError } = await supabase
          .from('user_locations')
          .insert({
            user_id: user.id,
            location_id: location.id
          });

        if (locationAssignError) {
          console.error('Failed to assign location:', locationAssignError);
        }
      }

      toast.success(`Welcome to ${location.name}!`);
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/10 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2 hover:shadow-3xl transition-all duration-300 hover:scale-[1.02]">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto">
            <img src={crooLogo} alt="Croo Logo" className="h-24 w-auto mx-auto" />
          </div>
          <p className="font-pacifico text-2xl text-[#E67E22] drop-shadow-sm">
            food service made smart
          </p>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@restaurant.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
                
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOAuthSignIn('google')}
                    disabled={loading}
                  >
                    <FcGoogle className="mr-2 h-5 w-5" />
                    Google
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOAuthSignIn('apple')}
                    disabled={loading}
                  >
                    <Apple className="mr-2 h-5 w-5" />
                    Apple
                  </Button>
                </div>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullname">Full Name</Label>
                  <Input
                    id="fullname"
                    type="text"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationCode">Location Code</Label>
                  <Input
                    id="locationCode"
                    type="text"
                    placeholder="happy-river-eagle"
                    value={locationCode}
                    onChange={(e) => handleLocationCodeChange(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the 3-word code provided by your manager
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Profile Photo (Required)</Label>
                  <div className="flex flex-col items-center gap-4">
                    <Avatar className="h-24 w-24">
                      <AvatarImage src={profilePhoto || undefined} />
                      <AvatarFallback>
                        <Camera className="h-8 w-8 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="w-full"
                    >
                      <Camera className="mr-2 h-4 w-4" />
                      {profilePhoto ? 'Change Photo' : 'Add Photo'}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@restaurant.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Creating account...' : 'Create Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

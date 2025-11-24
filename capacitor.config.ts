import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.9db37c9a728f428da26f854a0e9b29a2',
  appName: 'kitchen-check-mate',
  webDir: 'dist',
  server: {
    url: 'https://9db37c9a-728f-428d-a26f-854a0e9b29a2.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;

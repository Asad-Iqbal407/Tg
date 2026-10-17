import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is the same static build the web serves, bundled inside the APK.
const config: CapacitorConfig = {
  appId: 'com.neonarcade.app',
  appName: 'Neon Arcade',
  webDir: 'dist',
};

export default config;

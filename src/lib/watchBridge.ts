import { registerPlugin, Capacitor } from '@capacitor/core';

export interface WatchMetric {
  label: string;
  value: string;
}

export interface WatchCubeFace {
  title: string;
  metrics: WatchMetric[];
}

export interface WatchCube {
  id: string;
  title: string;
  accentColor: string;
  faces: WatchCubeFace[];
}

export interface WatchShift {
  id: string;
  name: string;
  role: string;
  time: string;
  isMe: boolean;
}

export interface WatchPayload {
  updatedAt: string;
  locationName: string;
  cubes: WatchCube[];
  schedule: WatchShift[];
  sales: WatchMetric[];
}

interface WatchBridgePlugin {
  sendSnapshot(options: { payload: string }): Promise<{ delivered: boolean }>;
  isPaired(): Promise<{ paired: boolean; reachable: boolean }>;
}

const noop: WatchBridgePlugin = {
  async sendSnapshot() {
    return { delivered: false };
  },
  async isPaired() {
    return { paired: false, reachable: false };
  },
};

const native = registerPlugin<WatchBridgePlugin>('WatchBridge');

/** Only the native iOS shell can talk to the Apple Watch. */
export const isWatchBridgeAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export const WatchBridge: WatchBridgePlugin = {
  async sendSnapshot(options) {
    if (!isWatchBridgeAvailable()) {
      console.log('[WatchBridge] skipped — not running in the native iOS app');
      return noop.sendSnapshot(options);
    }
    try {
      const res = await native.sendSnapshot(options);
      console.log('[WatchBridge] sendSnapshot delivered =', res?.delivered, 'bytes =', options.payload.length);
      return res;
    } catch (e) {
      console.log('[WatchBridge] sendSnapshot FAILED (plugin missing from app target?)', e);
      return { delivered: false };
    }
  },
  async isPaired() {
    if (!isWatchBridgeAvailable()) return noop.isPaired();
    try {
      return await native.isPaired();
    } catch {
      return { paired: false, reachable: false };
    }
  },
};

export async function pushWatchSnapshot(payload: WatchPayload) {
  const json = JSON.stringify(payload);
  console.log('[WatchBridge] pushing snapshot — cubes:', payload.cubes.length, 'shifts:', payload.schedule.length, 'sales:', payload.sales.length);
  return WatchBridge.sendSnapshot({ payload: json });
}

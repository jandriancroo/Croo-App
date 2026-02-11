// Extend ServiceWorkerRegistration to include PushManager
// This is available in modern browsers but not all TS lib targets include it
interface ServiceWorkerRegistration {
  readonly pushManager: PushManager;
}

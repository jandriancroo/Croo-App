// Cache for QuBeyond sales data - historical data won't change
const CACHE_KEY_PREFIX = 'qu_sales_cache_';
const PROJECTION_CACHE_KEY = 'qu_projections_cache_';
const CACHE_VERSION = 1;

interface CachedSalesData {
  version: number;
  fetchedAt: string;
  data: {
    daily: number;
    hourly: Array<{ hour: string; sales: number; checksCount: number }>;
    guestCount: { daily: number };
  };
}

interface CachedProjections {
  version: number;
  cachedAt: string;
  validUntil: string; // ISO date string - projections valid until this date's close of business
  data: {
    weekProjected: number;
    monthProjected: number;
  };
}

function getCacheKey(locationId: string, date: string): string {
  return `${CACHE_KEY_PREFIX}${locationId}_${date}`;
}

function getProjectionCacheKey(locationId: string): string {
  return `${PROJECTION_CACHE_KEY}${locationId}`;
}

function isDateInPast(dateStr: string): boolean {
  const targetDate = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return targetDate < today;
}

// Get current date in PST timezone
function getCurrentPSTDate(): string {
  const now = new Date();
  const pstOffset = -8; // PST is UTC-8
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const pst = new Date(utc + (3600000 * pstOffset));
  return pst.toISOString().split('T')[0];
}

// Check if current time is after close of business (10 PM PST)
function isAfterCloseOfBusiness(): boolean {
  const now = new Date();
  const pstOffset = -8;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const pst = new Date(utc + (3600000 * pstOffset));
  return pst.getHours() >= 22;
}

export function getCachedSalesData(locationId: string, date: string): CachedSalesData['data'] | null {
  try {
    const key = getCacheKey(locationId, date);
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const parsed: CachedSalesData = JSON.parse(cached);
    
    // Check version
    if (parsed.version !== CACHE_VERSION) return null;
    
    // Only use cache for past dates (historical data won't change)
    if (!isDateInPast(date)) return null;
    
    return parsed.data;
  } catch {
    return null;
  }
}

export function setCachedSalesData(
  locationId: string, 
  date: string, 
  data: CachedSalesData['data']
): void {
  // Only cache past dates
  if (!isDateInPast(date)) return;
  
  try {
    const key = getCacheKey(locationId, date);
    const cacheEntry: CachedSalesData = {
      version: CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      data
    };
    localStorage.setItem(key, JSON.stringify(cacheEntry));
  } catch {
    // localStorage might be full - ignore
  }
}

// Get cached projections - only valid until after close of business
export function getCachedProjections(locationId: string): CachedProjections['data'] | null {
  try {
    const key = getProjectionCacheKey(locationId);
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const parsed: CachedProjections = JSON.parse(cached);
    
    // Check version
    if (parsed.version !== CACHE_VERSION) return null;
    
    const currentDate = getCurrentPSTDate();
    const validUntilDate = parsed.validUntil;
    
    // Cache is valid if:
    // 1. We're still on the same day as when cached, OR
    // 2. We're on the next day but before close of business hasn't happened yet on the cached day
    if (currentDate === validUntilDate) {
      // Same day - cache is valid
      return parsed.data;
    }
    
    // Different day - cache expired
    return null;
  } catch {
    return null;
  }
}

// Cache projections - valid until close of business today
export function setCachedProjections(
  locationId: string,
  data: { weekProjected: number; monthProjected: number }
): void {
  try {
    const key = getProjectionCacheKey(locationId);
    const currentDate = getCurrentPSTDate();
    
    const cacheEntry: CachedProjections = {
      version: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      validUntil: currentDate, // Valid until end of today
      data
    };
    localStorage.setItem(key, JSON.stringify(cacheEntry));
  } catch {
    // localStorage might be full - ignore
  }
}

// Clean up old cache entries (call occasionally)
export function cleanupOldSalesCache(daysToKeep: number = 90): void {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_KEY_PREFIX)) {
        // Extract date from key (format: qu_sales_cache_locationId_YYYY-MM-DD)
        const parts = key.split('_');
        const dateStr = parts[parts.length - 1];
        const cacheDate = new Date(dateStr + 'T00:00:00');
        
        if (cacheDate < cutoffDate) {
          keysToRemove.push(key);
        }
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Ignore cleanup errors
  }
}

// Cache for QuBeyond sales data - historical data won't change
const CACHE_KEY_PREFIX = 'qu_sales_cache_';
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

function getCacheKey(locationId: string, date: string): string {
  return `${CACHE_KEY_PREFIX}${locationId}_${date}`;
}

function isDateInPast(dateStr: string): boolean {
  const targetDate = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return targetDate < today;
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

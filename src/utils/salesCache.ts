// Cache for QuBeyond sales data - historical data won't change
const CACHE_KEY_PREFIX = 'qu_sales_cache_';
const PROJECTION_CACHE_KEY = 'qu_projections_cache_';
const LIVE_SALES_CACHE_KEY = 'qu_live_sales_';
const HOURLY_PATTERN_CACHE_KEY = 'qu_hourly_pattern_';
const CACHE_VERSION = 9;

// 3-minute TTL for live sales data (shared cache for all loads including manual refresh)
const LIVE_SALES_TTL_MS = 3 * 60 * 1000;

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
    todayProjected?: number;
    todayProjectedAt?: string; // ISO timestamp for 30-min expiry check
    todayPaceAdjusted?: number;
    todayPaceAdjustedAt?: string; // ISO timestamp for 30-min expiry check
    todaySource?: string; // 'override' | 'living' | 'initial' | 'calculated'
    weekProjected: number;
    monthProjected: number;
  };
}

interface CachedLiveSales {
  version: number;
  cachedAt: string;
  data: any; // Full sales response from QuBeyond
}

interface CachedHourlyPattern {
  version: number;
  cachedAt: string;
  validForDate: string; // The date this pattern is valid for
  pattern: { hour: number; avgPercent: number }[];
}

function getCacheKey(locationId: string, date: string): string {
  return `${CACHE_KEY_PREFIX}${locationId}_${date}`;
}

function getProjectionCacheKey(locationId: string): string {
  return `${PROJECTION_CACHE_KEY}${locationId}`;
}

function getLiveSalesCacheKey(locationId: string): string {
  return `${LIVE_SALES_CACHE_KEY}${locationId}`;
}

function getHourlyPatternCacheKey(locationId: string): string {
  return `${HOURLY_PATTERN_CACHE_KEY}${locationId}`;
}

// Check if date is in the past (in PST timezone for consistency)
function isDateInPast(dateStr: string): boolean {
  const { date: todayPST } = getPSTDate();
  return dateStr < todayPST; // Simple string comparison works for YYYY-MM-DD format
}

// Get current date/time in PST timezone
function getPSTDate(): { date: string; hour: number } {
  const now = new Date();
  // Use proper timezone conversion
  const pstString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const pstDate = new Date(pstString);
  const year = pstDate.getFullYear();
  const month = String(pstDate.getMonth() + 1).padStart(2, '0');
  const day = String(pstDate.getDate()).padStart(2, '0');
  return { 
    date: `${year}-${month}-${day}`,
    hour: pstDate.getHours()
  };
}

// Check if current time is after close of business (10 PM PST)
function isAfterCloseOfBusiness(): boolean {
  return getPSTDate().hour >= 22;
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

// === LIVE SALES CACHE (5-minute TTL for stale-while-revalidate) ===

export function getCachedLiveSales(locationId: string): { data: any; isStale: boolean; isFresh: boolean; cachedAt: Date | null } | null {
  try {
    const key = getLiveSalesCacheKey(locationId);
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const parsed: CachedLiveSales = JSON.parse(cached);
    
    // Check version
    if (parsed.version !== CACHE_VERSION) return null;
    
    const cachedTime = new Date(parsed.cachedAt).getTime();
    const now = Date.now();
    const ageMs = now - cachedTime;
    const isStale = ageMs > LIVE_SALES_TTL_MS;
    // Fresh means within the 3-minute window - don't make API calls
    const isFresh = ageMs <= LIVE_SALES_TTL_MS;
    
    return { data: parsed.data, isStale, isFresh, cachedAt: new Date(parsed.cachedAt) };
  } catch {
    return null;
  }
}

export function setCachedLiveSales(locationId: string, data: any): void {
  try {
    const key = getLiveSalesCacheKey(locationId);
    const cacheEntry: CachedLiveSales = {
      version: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      data
    };
    localStorage.setItem(key, JSON.stringify(cacheEntry));
  } catch {
    // localStorage might be full - ignore
  }
}

// === HOURLY PATTERN CACHE (valid for entire day) ===

export function getCachedHourlyPattern(locationId: string): { hour: number; avgPercent: number }[] | null {
  try {
    const key = getHourlyPatternCacheKey(locationId);
    const cached = localStorage.getItem(key);
    
    if (!cached) return null;
    
    const parsed: CachedHourlyPattern = JSON.parse(cached);
    
    // Check version
    if (parsed.version !== CACHE_VERSION) return null;
    
    // Only valid for today
    const { date: currentDate } = getPSTDate();
    if (parsed.validForDate !== currentDate) {
      localStorage.removeItem(key);
      return null;
    }
    
    return parsed.pattern;
  } catch {
    return null;
  }
}

export function setCachedHourlyPattern(locationId: string, pattern: { hour: number; avgPercent: number }[]): void {
  try {
    const key = getHourlyPatternCacheKey(locationId);
    const { date: currentDate } = getPSTDate();
    const cacheEntry: CachedHourlyPattern = {
      version: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      validForDate: currentDate,
      pattern
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
    
    const { date: currentDate, hour: currentHour } = getPSTDate();
    const validUntilDate = parsed.validUntil;
    
    // Cache is valid if we're still on the same day AND before close of business (10 PM)
    // Once close of business passes, cache expires for the next day's projections
    if (currentDate === validUntilDate && currentHour < 22) {
      // Check if daily projection is still valid (30-min expiry)
      const result = { ...parsed.data };
      const now = Date.now();
      const thirtyMinutes = 30 * 60 * 1000;
      
      if (result.todayProjectedAt) {
        const projectedTime = new Date(result.todayProjectedAt).getTime();
        
        // If daily projection is older than 30 minutes, clear it
        if (now - projectedTime > thirtyMinutes) {
          result.todayProjected = undefined;
          result.todayProjectedAt = undefined;
        }
      }
      
      // Also expire pace-adjusted projection after 7 minutes (matches live sync interval)
      const sevenMinutes = 7 * 60 * 1000;
      if (result.todayPaceAdjustedAt) {
        const paceTime = new Date(result.todayPaceAdjustedAt).getTime();
        if (now - paceTime > sevenMinutes) {
          result.todayPaceAdjusted = undefined;
          result.todayPaceAdjustedAt = undefined;
        }
      }
      
      return result;
    }
    
    // Different day or after close of business - cache expired
    // Clear the old cache
    localStorage.removeItem(key);
    return null;
  } catch {
    return null;
  }
}

// Cache projections - valid until close of business today
export function setCachedProjections(
  locationId: string,
  data: { todayProjected?: number; todayPaceAdjusted?: number; todaySource?: string; weekProjected: number; monthProjected: number }
): void {
  try {
    const key = getProjectionCacheKey(locationId);
    const { date: currentDate } = getPSTDate();
    const now = new Date().toISOString();
    
    const cacheEntry: CachedProjections = {
      version: CACHE_VERSION,
      cachedAt: now,
      validUntil: currentDate, // Valid until close of business today
      data: {
        ...data,
        todayProjectedAt: data.todayProjected ? now : undefined,
        todayPaceAdjustedAt: data.todayPaceAdjusted ? now : undefined
      }
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
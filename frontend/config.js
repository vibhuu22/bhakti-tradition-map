/**
 * BHAKTI TRADITION MAP - CLIENT CONFIGURATION
 * 
 * This configuration file manages API endpoints and client-side settings.
 * It automatically detects the environment (development/production) and
 * sets the appropriate API base URL for seamless deployment.
 * 
 * FEATURES:
 * - Environment detection (localhost vs production)
 * - API endpoint configuration
 * - Map settings and defaults
 * - UI behavior configuration
 * - Feature flags for functionality control
 */

// ========================================
// ENVIRONMENT DETECTION
// ========================================

/**
 * Detect if we're running in local development environment
 * Checks various indicators like hostname, port, and IP ranges
 */
const isLocalDevelopment = 
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.includes('192.168.') ||
  window.location.hostname.includes('10.0.') ||
  window.location.port === '5500' || // Live Server default port
  window.location.port === '8080' || // Alternative dev port
  window.location.port === '3001';   // React dev server

/**
 * Main configuration object containing all client settings
 */
const config = {
  // ========================================
  // API CONFIGURATION
  // ========================================
  
  /**
   * API Base URL - automatically switches between development and production
   * Update the production URL after deploying your backend to Railway/Vercel
   */
  API_BASE: isLocalDevelopment
    ? 'http://localhost:3000/api'  // Local development server
    : 'https://your-backend-url.up.railway.app/api', // Production server (UPDATE THIS!)

  // ========================================
  // MAP CONFIGURATION
  // ========================================
  
  MAP_CONFIG: {
    DEFAULT_CENTER: [20.5937, 78.9629], // Geographical center of India
    DEFAULT_ZOOM: 5,                     // Initial zoom level
    MAX_ZOOM: 18,                        // Maximum zoom (street level)
    MIN_ZOOM: 3,                         // Minimum zoom (country level)
    
    // Tile layer URLs for different themes
    TILE_LAYERS: {
      light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    }
  },

  // ========================================
  // UI CONFIGURATION
  // ========================================
  
  UI_CONFIG: {
    THEME: 'light',              // Default theme ('light', 'dark', 'auto')
    ANIMATION_DURATION: 300,     // Default animation duration (milliseconds)
    TOAST_DURATION: 5000,        // Toast notification display time
    SEARCH_DEBOUNCE: 300,        // Input debounce delay for search
    MOBILE_BREAKPOINT: 768,      // Mobile breakpoint in pixels
    
    // Loading states
    LOADING_MESSAGES: [
      'Loading sacred places...',
      'Connecting to tradition data...',
      'Mapping spiritual journeys...',
      'Gathering saint information...'
    ]
  },

  // ========================================
  // API REQUEST CONFIGURATION
  // ========================================
  
  API_CONFIG: {
    TIMEOUT: 15000,              // Request timeout (15 seconds)
    RETRY_ATTEMPTS: 3,           // Number of retry attempts
    CACHE_DURATION: 300000,      // Cache duration (5 minutes)
    
    // Request headers
    DEFAULT_HEADERS: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  },

  // ========================================
  // FEATURE FLAGS
  // ========================================
  
  FEATURES: {
    HEATMAP_ENABLED: true,        // Enable heatmap visualization
    CLUSTERING_ENABLED: true,     // Enable marker clustering
    PLACE_SUGGESTIONS: true,      // Enable place name suggestions
    CONTRIBUTION_FORM: true,      // Enable contribution functionality
    ADVANCED_FILTERS: true,       // Enable advanced filtering options
    EXPORT_FUNCTIONALITY: false, // Export data functionality (future)
    OFFLINE_SUPPORT: false,      // Offline functionality (future)
    ANALYTICS_ENABLED: false,    // Analytics tracking (future)
    DARK_MODE: true,             // Dark mode support
    
    // Experimental features
    EXPERIMENTAL: {
      ROUTE_PLANNING: false,     // Route planning between places
      VIRTUAL_TOURS: false,      // Virtual tour functionality
      AUDIO_GUIDES: false        // Audio guide integration
    }
  },

  // ========================================
  // MARKER CONFIGURATION
  // ========================================
  
  MARKER_CONFIG: {
    // Colors for different place types
    COLORS: {
      birth: '#e74c3c',          // Red for birth places
      enlightenment: '#f39c12',  // Orange for enlightenment places
      samadhi: '#9b59b6',        // Purple for samadhi places
      temple: '#3498db',         // Blue for temples
      influence: '#27ae60'       // Green for areas of influence
    },
    
    // Marker icons (using Material Icons)
    ICONS: {
      birth: 'child_care',
      enlightenment: 'wb_sunny',
      samadhi: 'spa',
      temple: 'account_balance',
      influence: 'public'
    },
    
    // Clustering configuration
    CLUSTER: {
      MAX_RADIUS: 50,            // Maximum cluster radius in pixels
      DISABLE_AT_ZOOM: 15,       // Disable clustering at this zoom level
      SPIDER_LEG_POLYLINE_OPTIONS: {
        weight: 1.5,
        color: '#222',
        opacity: 0.5
      }
    }
  },

  // ========================================
  // HEATMAP CONFIGURATION
  // ========================================
  
  HEATMAP_CONFIG: {
    RADIUS: 25,                  // Heatmap point radius
    BLUR: 15,                    // Heatmap blur amount
    MAX_ZOOM: 10,                // Maximum zoom for heatmap visibility
    
    // Gradient colors for heatmap
    GRADIENT: {
      0.0: 'blue',
      0.2: 'cyan',
      0.4: 'lime',
      0.6: 'yellow',
      0.8: 'orange',
      1.0: 'red'
    }
  }
};

// ========================================
// ENVIRONMENT-SPECIFIC OVERRIDES
// ========================================

/**
 * Apply different settings based on environment
 */
if (isLocalDevelopment) {
  // Development environment settings
  config.API_CONFIG.TIMEOUT = 10000;           // Shorter timeout for local
  config.UI_CONFIG.ANIMATION_DURATION = 200;   // Faster animations
  config.DEBUG = true;                          // Enable debug logging
  
  console.log('🔧 Development mode detected');
  console.log('🌐 API Base URL:', config.API_BASE);
  console.log('⚙️ Debug mode enabled');
} else {
  // Production environment settings
  config.DEBUG = false;                        // Disable debug logging
  config.FEATURES.ANALYTICS_ENABLED = true;   // Enable analytics
  config.API_CONFIG.RETRY_ATTEMPTS = 2;       // Fewer retries in production
  
  console.log('🚀 Production mode detected');
  console.log('🌐 API Base URL:', config.API_BASE);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Get complete API endpoint URL
 * @param {string} endpoint - API endpoint path
 * @returns {string} Complete API URL
 */
config.getApiUrl = (endpoint) => {
  const cleanEndpoint = endpoint.replace(/^\//, '');
  return `${config.API_BASE}/${cleanEndpoint}`;
};

/**
 * Check if current environment is development
 * @returns {boolean} True if in development mode
 */
config.isDevelopment = () => isLocalDevelopment;

/**
 * Get environment name string
 * @returns {string} Environment name
 */
config.getEnvironment = () => isLocalDevelopment ? 'development' : 'production';

/**
 * Get marker color for place type
 * @param {string} placeType - Type of place
 * @returns {string} Hex color code
 */
config.getMarkerColor = (placeType) => {
  return config.MARKER_CONFIG.COLORS[placeType] || '#666666';
};

/**
 * Get marker icon for place type
 * @param {string} placeType - Type of place
 * @returns {string} Material icon name
 */
config.getMarkerIcon = (placeType) => {
  return config.MARKER_CONFIG.ICONS[placeType] || 'place';
};

/**
 * Format place type for display
 * @param {string} placeType - Raw place type
 * @returns {string} Formatted place type
 */
config.formatPlaceType = (placeType) => {
  const formatMap = {
    birth: 'Birth Place',
    enlightenment: 'Enlightenment Place',
    samadhi: 'Samadhi Place',
    temple: 'Temple',
    influence: 'Area of Influence'
  };
  
  return formatMap[placeType] || placeType.charAt(0).toUpperCase() + placeType.slice(1);
};

// ========================================
// VALIDATION AND LOGGING
// ========================================

/**
 * Validate configuration on load
 */
if (!config.API_BASE) {
  console.error('❌ API_BASE is not configured properly');
  throw new Error('Configuration error: API_BASE is required');
}

// Log configuration in development mode
if (config.DEBUG) {
  console.log('⚙️ Configuration loaded successfully:', {
    apiBase: config.API_BASE,
    environment: config.getEnvironment(),
    featuresEnabled: Object.keys(config.FEATURES).filter(key => config.FEATURES[key]),
    mapCenter: config.MAP_CONFIG.DEFAULT_CENTER,
    theme: config.UI_CONFIG.THEME
  });
}

// ========================================
// EXPORTS
// ========================================

// Default export
export default config;

// Named exports for convenience
export const {
  API_BASE,
  MAP_CONFIG,
  UI_CONFIG,
  API_CONFIG,
  FEATURES,
  MARKER_CONFIG,
  HEATMAP_CONFIG
} = config;

/**
 * Export utility functions
 */
export const {
  getApiUrl,
  isDevelopment,
  getEnvironment,
  getMarkerColor,
  getMarkerIcon,
  formatPlaceType
} = config;

/**
 * BHAKTI TRADITION MAP - SERVER APPLICATION
 * 
 * This is the main server file that handles:
 * - Database connections to MongoDB
 * - RESTful API endpoints for traditions data
 * - Geocoding services for place names
 * - Contribution system for new saint information
 * - Filter options for frontend filtering
 * 
 * Key Features:
 * - Auto-geocoding using Nominatim (OpenStreetMap)
 * - Advanced filtering with MongoDB queries
 * - Structured data handling for different place types
 * - Error handling and validation
 * - CORS support for cross-origin requests
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { MongoClient } from 'mongodb';

// ========================================
// ENVIRONMENT CONFIGURATION
// ========================================

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'bhakti';
const COLLECTION = process.env.COLLECTION || 'traditions';

// Validate required environment variables
if (!MONGODB_URI) {
  console.error('❌ Missing MONGODB_URI environment variable. Please check your .env file.');
  process.exit(1);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Async handler wrapper to catch errors in route handlers
 * Prevents repetitive try-catch blocks in route definitions
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Validate contribution data before processing
 * Ensures all required fields are present and valid
 */
function validateContributionBody(body) {
  const errors = [];
  
  // Required string fields validation
  const requiredFields = ['saint', 'tradition', 'period', 'traditionType', 'gender', 'language', 'philosophy'];
  
  requiredFields.forEach(field => {
    if (!body[field] || typeof body[field] !== 'string' || !body[field].trim()) {
      errors.push(`Field "${field}" is required and must be a non-empty string`);
    }
  });

  // Places object validation
  if (!body.places || typeof body.places !== 'object') {
    errors.push('Field "places" is required and must be an object');
  }

  return errors;
}

/**
 * Geocode place names using OpenStreetMap's Nominatim service
 * Returns coordinates, display name, and region information
 * 
 * @param {string} placeName - Name of place to geocode
 * @returns {Object|null} - Geocoding result with lat, lon, displayName, region
 */
async function geocodePlace(placeName) {
  try {
    console.log(`🔍 Geocoding: ${placeName}`);
    
    // Construct Nominatim API URL with India country filter
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&limit=1&countrycodes=in`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Bhakti-Tradition-Map/1.0 (contact@example.com)'
      }
    });

    if (!response.ok) {
      console.error(`❌ HTTP error! status: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (Array.isArray(data) && data.length > 0) {
      const place = data[0];
      
      // Extract meaningful location information
      const displayName = place.display_name || placeName;
      const parts = displayName.split(',');
      const region = parts.length > 1 ? parts[1].trim() : '';
      
      const result = {
        lat: parseFloat(place.lat),
        lon: parseFloat(place.lon),
        displayName: displayName,
        region: region
      };
      
      console.log(`✅ Successfully geocoded "${placeName}": ${result.lat}, ${result.lon}`);
      return result;
    } else {
      console.warn(`⚠️ No results found for: "${placeName}"`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Geocoding error for "${placeName}":`, error.message);
    return null;
  }
}

/**
 * Process and geocode all places in a contribution
 * Handles both single places and arrays of places
 * 
 * @param {Object} places - Places object from contribution form
 * @returns {Object} - Processed places with coordinates
 */
async function normalizeAndGeocodePlaces(places = {}) {
  const placeTypes = ['birth', 'enlightenment', 'samadhi', 'temple', 'influence'];
  const geocodedPlaces = {};
  
  for (const type of placeTypes) {
    const placeData = places[type];
    
    if (!placeData) {
      geocodedPlaces[type] = null;
      continue;
    }

    /**
     * Process individual place object
     * Geocode if coordinates are missing
     */
    const processPlace = async (placeObj) => {
      if (!placeObj || !placeObj.name) return null;
      
      let coords = Array.isArray(placeObj.coords) && placeObj.coords.length === 2 ? placeObj.coords : null;
      let region = placeObj.region || null;
      
      // Geocode if coordinates are missing
      if (!coords) {
        const geoData = await geocodePlace(placeObj.name);
        coords = geoData ? [geoData.lat, geoData.lon] : null;
        region = region || (geoData ? geoData.region : null);
      }
      
      return {
        name: placeObj.name,
        coords: coords,
        region: region
      };
    };

    // Handle array of places (e.g., multiple temples)
    if (Array.isArray(placeData)) {
      const processedPlaces = [];
      
      for (const place of placeData) {
        const processed = await processPlace(place);
        if (processed) processedPlaces.push(processed);
      }
      
      geocodedPlaces[type] = processedPlaces.length ? processedPlaces : null;
    } 
    // Handle single place object
    else {
      geocodedPlaces[type] = await processPlace(placeData);
    }
  }
  
  return geocodedPlaces;
}

/**
 * Convert tradition document to map markers
 * Transforms database documents into frontend-compatible marker objects
 * 
 * @param {Object} doc - MongoDB tradition document
 * @returns {Array} - Array of marker objects for map display
 */
function convertToMapMarkers(doc) {
  const markers = [];
  
  if (!doc?.places || typeof doc.places !== 'object') return markers;

  /**
   * Create marker object for a specific place and type
   */
  const createMarker = (place, type) => {
    if (!place?.coords || place.coords.length !== 2) return;
    
    markers.push({
      id: `${doc._id}_${type}_${Math.random().toString(36).slice(2, 9)}`,
      name: place.name,
      coords: place.coords,
      type: type,
      saint: doc.saint,
      tradition: doc.tradition,
      traditionType: doc.traditionType,
      gender: doc.gender,
      period: doc.period,
      language: doc.language,
      philosophy: doc.philosophy,
      texts: doc.texts || [],
      presidingDeity: doc.presidingDeity || null,
      popup: `${place.name} — ${type} of ${doc.saint}`,
      updatedAt: doc.updatedAt || null,
      fullData: doc
    });
  };

  // Process each place type
  for (const [type, placeData] of Object.entries(doc.places)) {
    if (!placeData) continue;
    
    if (Array.isArray(placeData)) {
      placeData.forEach(place => createMarker(place, type));
    } else {
      createMarker(placeData, type);
    }
  }

  return markers;
}

// ========================================
// SERVER INITIALIZATION
// ========================================

async function startServer() {
  const app = express();
  
  // ========================================
  // MIDDLEWARE CONFIGURATION
  // ========================================
  
  // CORS configuration for cross-origin requests
  app.use(cors({
    origin: true, // Allow all origins in development
    credentials: false
  }));
  
  // JSON body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  
  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // ========================================
  // DATABASE CONNECTION
  // ========================================
  
// Replace this section in your server.js:
const client = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4, // Use IPv4, skip trying IPv6
  tls: true,
  tlsAllowInvalidCertificates: true,
  tlsAllowInvalidHostnames: true,
});

  
  await client.connect();
  const db = client.db(DB_NAME);
  const traditionsCollection = db.collection(COLLECTION);
  
  console.log('✅ Connected to MongoDB successfully!');
  
  // Create indexes for better query performance
  await traditionsCollection.createIndex({ saint: 1 });
  await traditionsCollection.createIndex({ tradition: 1 });
  await traditionsCollection.createIndex({ traditionType: 1 });
  
  // ========================================
  // API ROUTES
  // ========================================
  
  /**
   * Health check endpoint
   * Returns server status and environment information
   */
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.1'
    });
  });

  /**
   * Place name suggestions endpoint
   * Provides autocomplete functionality for place inputs
   * Uses OpenStreetMap Nominatim for place suggestions
   */
  app.get('/api/suggest-places/:query', asyncHandler(async (req, res) => {
    const query = (req.params.query || '').trim();
    
    if (query.length < 3) {
      return res.json([]);
    }
    
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=in`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Bhakti-Tradition-Map/1.0 (contact@example.com)'
      }
    });
    
    if (!response.ok) {
      return res.json([]);
    }
    
    const data = await response.json();
    
    const suggestions = data.map(place => ({
      name: (place.display_name || '').split(',')[0]?.trim(),
      fullName: place.display_name,
      coords: [parseFloat(place.lat), parseFloat(place.lon)],
      type: place.type,
      importance: place.importance || 0
    }));
    
    res.json(suggestions);
  }));

  /**
   * Filter options endpoint
   * Provides all available filter options for frontend dropdowns
   * Dynamically generates options from existing data
   */
  app.get('/api/filter-options', asyncHandler(async (req, res) => {
    // Use aggregation pipeline for efficient unique value extraction
    const pipeline = [
      {
        $group: {
          _id: null,
          traditions: { $addToSet: '$tradition' },
          traditionTypes: { $addToSet: '$traditionType' },
          genders: { $addToSet: '$gender' },
          languages: { $addToSet: '$language' },
          periods: { $addToSet: '$period' },
          saints: { $addToSet: '$saint' }
        }
      }
    ];
    
    const result = await traditionsCollection.aggregate(pipeline).toArray();
    
    if (result.length === 0) {
      return res.json({
        traditions: [],
        traditionTypes: [],
        genders: [],
        languages: [],
        periods: [],
        saints: []
      });
    }
    
    const options = result[0];
    
    // Filter out null/undefined values and sort
    Object.keys(options).forEach(key => {
      if (key !== '_id') {
        options[key] = options[key]
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      }
    });
    
    delete options._id;
    res.json(options);
  }));

  /**
   * Traditions endpoint with advanced filtering
   * Main endpoint for retrieving tradition markers with filters
   * Supports text search, exact matches, and place type filtering
   */
  app.get('/api/traditions', asyncHandler(async (req, res) => {
    const {
      tradition,
      traditionType,
      gender,
      period,
      language,
      saint,
      placeType,
      search
    } = req.query;
    
    // Build MongoDB filter query
    const filter = {};
    
    // Text-based filters (case-insensitive regex)
    if (tradition) filter.tradition = new RegExp(String(tradition), 'i');
    if (period) filter.period = new RegExp(String(period), 'i');
    if (language) filter.language = new RegExp(String(language), 'i');
    if (saint) filter.saint = new RegExp(String(saint), 'i');
    
    // Exact match filters
    if (traditionType) filter.traditionType = String(traditionType);
    if (gender) filter.gender = String(gender);
    
    // General search across multiple fields
    if (search) {
      filter.$or = [
        { saint: new RegExp(String(search), 'i') },
        { tradition: new RegExp(String(search), 'i') },
        { philosophy: new RegExp(String(search), 'i') }
      ];
    }
    
    console.log('🔍 Filter query:', filter);
    
    // Retrieve documents from database
    const docs = await traditionsCollection
      .find(filter)
      .sort({ _id: -1 })
      .limit(1000) // Prevent excessive data loading
      .toArray();
    
    console.log(`📊 Found ${docs.length} traditions`);
    
    // Convert to map markers
    let markers = docs.flatMap(convertToMapMarkers);
    
    // Filter by place type if specified
    if (placeType && placeType !== 'all') {
      markers = markers.filter(marker => marker.type === placeType);
    }
    
    console.log(`🗺️ Returning ${markers.length} markers`);
    res.json(markers);
  }));

  /**
   * Contribution endpoint
   * Handles new saint/tradition submissions with auto-geocoding
   * Validates input data and processes place information
   */
  app.post('/api/contribute', asyncHandler(async (req, res) => {
    console.log('📝 New contribution received');
    
    const body = req.body || {};
    
    // Validate required fields
    const validationErrors = validateContributionBody(body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors
      });
    }

    // Process and geocode places
    console.log('🌍 Processing places...');
    const geocodedPlaces = await normalizeAndGeocodePlaces(body.places);

    // Create document for database insertion
    const traditionDocument = {
      saint: body.saint.trim(),
      tradition: body.tradition.trim(),
      places: geocodedPlaces,
      period: body.period.trim(),
      traditionType: body.traditionType.trim(),
      school: body.school ? body.school.trim() : null,
      presidingDeity: body.presidingDeity ? body.presidingDeity.trim() : null,
      sufi: Boolean(body.sufi),
      gender: body.gender.trim(),
      language: body.language.trim(),
      texts: Array.isArray(body.texts) ? body.texts : (body.texts ? [body.texts] : []),
      philosophy: body.philosophy.trim(),
      contributedAt: new Date(),
      updatedAt: new Date()
    };

    // Insert into database
    const result = await traditionsCollection.insertOne(traditionDocument);
    
    console.log(`✅ Contribution added successfully: ${traditionDocument.saint}`);
    
    res.json({
      id: result.insertedId.toString(),
      message: `Thank you for contributing information about ${traditionDocument.saint}!`,
      success: true,
      insertedId: result.insertedId.toString()
    });
  }));

  /**
   * Legacy places endpoint
   * Maintains backward compatibility with older frontend versions
   */
  app.get('/api/places', asyncHandler(async (req, res) => {
    const docs = await traditionsCollection
      .find({})
      .sort({ _id: -1 })
      .toArray();
    
    const places = docs.flatMap(doc => {
      return convertToMapMarkers(doc).map(marker => ({
        id: marker.id,
        name: marker.name,
        coords: marker.coords,
        type: marker.type,
        saint: marker.saint,
        tradition: marker.tradition,
        popup: marker.popup,
        updatedAt: marker.updatedAt
      }));
    });
    
    res.json(places);
  }));

  // ========================================
  // ERROR HANDLING
  // ========================================
  
  /**
   * Global error handler
   * Catches all unhandled errors and returns appropriate responses
   */
  app.use((error, req, res, next) => {
    console.error('💥 Server error:', error);
    
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
      timestamp: new Date().toISOString()
    });
  });

  /**
   * 404 handler for undefined routes
   */
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Route not found',
      path: req.originalUrl,
      method: req.method
    });
  });

  // ========================================
  // SERVER STARTUP
  // ========================================
  
  const server = app.listen(PORT, () => {
    console.log('\n🚀 Bhakti Tradition Map API Server Started');
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/api/health`);
    console.log(`🕉️ Traditions: http://localhost:${PORT}/api/traditions`);
    console.log(`🎛️ Filter options: http://localhost:${PORT}/api/filter-options`);
    console.log(`🔍 Place suggestions: http://localhost:${PORT}/api/suggest-places/{query}`);
    console.log(`✨ Contribute: POST http://localhost:${PORT}/api/contribute`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Graceful shutdown handling
  process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
      client.close();
      process.exit(0);
    });
  });
}

// Start the server
startServer().catch(error => {
  console.error('❌ Server startup failed:', error);
  process.exit(1);
});

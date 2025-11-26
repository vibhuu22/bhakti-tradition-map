/**
 * BHAKTI TRADITION MAP - SERVER APPLICATION
 * 
 * This is the main server file that handles:
 * - Database connections to MongoDB
 * - RESTful API endpoints for traditions data
 * - Geocoding services for place names
 * - Contribution system for new saint information
 * - Filter options for frontend filtering
 * - Static file serving for frontend
 * 
 * Key Features:
 * - Auto-geocoding using Nominatim (OpenStreetMap)
 * - Advanced filtering with MongoDB queries
 * - Intelligent language/tradition parsing
 * - Error handling and validation
 * - CORS support for cross-origin requests
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ES Module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================
// ENVIRONMENT CONFIGURATION
// ========================================

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bhakti';
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
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Parse compound language values into individual items
 * Handles: "Punjabi/Braj Bhasha", "Hindi (Braj, Avadhi dialects)", etc.
 */
function parseLanguageValue(value) {
  if (!value || typeof value !== 'string') return [];
  
  let workingValue = value;
  
  // Remove long parenthetical descriptions (more than 50 chars)
  workingValue = workingValue.replace(/\([^)]{50,}\)/g, '');
  
  // Handle "(X, Y dialects)" pattern - extract X, Y as separate items
  const dialectMatches = workingValue.match(/\(([^)]+)\s*dialects?\)/gi);
  const extractedDialects = [];
  if (dialectMatches) {
    dialectMatches.forEach(match => {
      const inner = match.replace(/\(|\)|dialects?/gi, '').trim();
      const parts = inner.split(/[,\/]/);
      parts.forEach(p => {
        const cleaned = p.trim();
        if (cleaned && cleaned.length > 1) {
          extractedDialects.push(cleaned);
        }
      });
    });
    workingValue = workingValue.replace(/\([^)]+\s*dialects?\)/gi, '');
  }
  
  // Remove remaining parentheticals
  workingValue = workingValue.replace(/\s*\([^)]*\)/g, '');
  
  // Split by separators: comma, slash, semicolon, "and", ampersand
  const separatorRegex = /[,\/;|&]|\s+and\s+/gi;
  const parts = workingValue.split(separatorRegex);
  
  const results = new Set();
  
  [...parts, ...extractedDialects].forEach(part => {
    let cleaned = part.trim();
    if (!cleaned || cleaned.length < 2) return;
    
    // Skip descriptive phrases
    const skipPhrases = ['derived terms', 'influences', 'other local', 'sometimes', 
      'spiritual vernacular', 'common to', 'words', 'from eastern', 'primary', 'secondary'];
    const lowerCleaned = cleaned.toLowerCase();
    if (skipPhrases.some(phrase => lowerCleaned.includes(phrase))) return;
    if (['primary', 'secondary', 'sometimes', 'mostly', 'mainly'].includes(lowerCleaned)) return;
    
    cleaned = normalizeLanguageName(cleaned);
    if (cleaned && cleaned.length > 1) {
      results.add(cleaned);
    }
  });
  
  return Array.from(results);
}

/**
 * Parse compound tradition values into individual items
 * Handles: "Śaiva Siddhānta – Tamil Śaiva Bhakti", "Vīraśaiva / Liṅgāyat", etc.
 */
function parseTraditionValue(value) {
  if (!value || typeof value !== 'string') return [];
  
  const results = new Set();
  
  // Split by en-dash (–) or regular dash with spaces
  const dashParts = value.split(/\s*[–—]\s*|\s+-\s+/);
  
  dashParts.forEach(part => {
    // Handle slash alternatives like "Vīraśaiva / Liṅgāyat"
    const slashParts = part.split(/\s*\/\s*/);
    
    slashParts.forEach(subPart => {
      const parenMatch = subPart.match(/^([^(]+)\s*\(([^)]+)\)/);
      
      if (parenMatch) {
        const mainPart = parenMatch[1].trim();
        const parenContent = parenMatch[2].trim();
        
        if (mainPart && mainPart.length > 2) {
          results.add(normalizeTraditionName(mainPart));
        }
        
        // Check if parentheses contain short alternative (not description)
        const wordCount = parenContent.split(/\s+/).length;
        const isDescription = wordCount > 5 || 
          /devotion|rooted|lineage|philosophical|synthesis|movement|tradition|school|common|spiritual/i.test(parenContent);
        
        if (!isDescription && wordCount <= 4) {
          const altParts = parenContent.split(/\s*\/\s*/);
          altParts.forEach(alt => {
            const cleanAlt = alt.trim();
            if (cleanAlt && cleanAlt.length > 3 && !/canon|Nayanars/i.test(cleanAlt)) {
              results.add(normalizeTraditionName(cleanAlt));
            }
          });
        }
      } else {
        let cleaned = subPart.replace(/\s*\([^)]*\)/g, '').trim();
        cleaned = cleaned.replace(/\s+(tradition|movement|devotion|canon)$/i, '');
        if (cleaned && cleaned.length > 2) {
          results.add(normalizeTraditionName(cleaned));
        }
      }
    });
  });
  
  return Array.from(results);
}

/**
 * Normalize language names
 */
function normalizeLanguageName(name) {
  if (!name) return name;
  
  let cleaned = name.trim().replace(/[()]/g, '').replace(/\s+/g, ' ');
  if (cleaned.length < 2) return null;
  
  const normalizations = {
    'brajbhasa': 'Braj Bhasha', 'brajbhasha': 'Braj Bhasha', 'braj bhasa': 'Braj Bhasha',
    'braj': 'Braj Bhasha', 'brij bhasha': 'Braj Bhasha', 'brijbhasha': 'Braj Bhasha',
    'hindii': 'Hindi', 'hindustani': 'Hindi',
    'sanskirt': 'Sanskrit', 'sankrit': 'Sanskrit', 'sanskrit-derived': 'Sanskrit',
    'bangla': 'Bengali', 'panjabi': 'Punjabi', 'tamizh': 'Tamil', 'telegu': 'Telugu',
    'kannad': 'Kannada', 'gujrati': 'Gujarati', 'avadhi': 'Awadhi', 'maithali': 'Maithili',
    'farsi': 'Persian', 'odiya': 'Odia', 'oriya': 'Odia', 'marwari': 'Marwari',
    'sant bhasha': 'Sant Bhasha', 'kashmiri': 'Kashmiri'
  };
  
  const lowerName = cleaned.toLowerCase();
  if (normalizations[lowerName]) return normalizations[lowerName];
  
  return cleaned.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Normalize tradition names
 */
function normalizeTraditionName(name) {
  if (!name) return name;
  
  let cleaned = name.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2) return null;
  
  const normalizations = {
    'vaisnava': 'Vaishnava', 'vaiṣṇava': 'Vaishnava', 'vaishnavism': 'Vaishnava',
    'saiva': 'Shaiva', 'śaiva': 'Shaiva', 'shaivism': 'Shaiva',
    'siddhānta': 'Siddhanta', 'liṅgāyat': 'Lingayat', 'lingāyat': 'Lingayat',
    'vārkari': 'Varkari', 'gauḍīya': 'Gaudiya', 'gaudīya': 'Gaudiya',
    'vīraśaiva': 'Virashaiva', 'virasaiva': 'Virashaiva',
    'āḻvārs': 'Alvars', 'alwars': 'Alvars', 'nāyanārs': 'Nayanars', 'nayanmars': 'Nayanars'
  };
  
  const lowerName = cleaned.toLowerCase();
  if (normalizations[lowerName]) return normalizations[lowerName];
  
  return cleaned;
}

/**
 * Extract unique values from array of compound values
 */
function extractUniqueValues(values, fieldType = 'language') {
  const uniqueSet = new Set();
  const parseFunction = fieldType === 'tradition' ? parseTraditionValue : parseLanguageValue;
  
  values.forEach(value => {
    const parsed = parseFunction(value);
    parsed.forEach(item => {
      if (item && item.length > 1) uniqueSet.add(item);
    });
  });
  
  return Array.from(uniqueSet).sort((a, b) => a.localeCompare(b));
}

/**
 * Validate contribution data
 */
function validateContributionBody(body) {
  const errors = [];
  const requiredFields = ['saint', 'tradition', 'period', 'startYear', 'endYear', 'traditionType', 'gender', 'language', 'philosophy', 'birthPlace'];
  
  requiredFields.forEach(field => {
    if (!body[field] || typeof body[field] !== 'string' || !body[field].trim()) {
      errors.push(`Field "${field}" is required and must be a non-empty string`);
    }
  });

  if (!body.places || typeof body.places !== 'object') {
    errors.push('Field "places" is required and must be an object');
  }

  return errors;
}

/**
 * Geocode place names using Nominatim
 */
async function geocodePlace(placeName) {
  try {
    console.log(`🔍 Geocoding: ${placeName}`);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&limit=1&countrycodes=in`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Bhakti-Tradition-Map/1.0' }
    });

    if (!response.ok) return null;

    const data = await response.json();
    
    if (Array.isArray(data) && data.length > 0) {
      const place = data[0];
      const displayName = place.display_name || placeName;
      const parts = displayName.split(',');
      
      return {
        lat: parseFloat(place.lat),
        lon: parseFloat(place.lon),
        displayName: displayName,
        region: parts.length > 1 ? parts[1].trim() : ''
      };
    }
    return null;
  } catch (error) {
    console.error(`❌ Geocoding error for "${placeName}":`, error.message);
    return null;
  }
}

/**
 * Process and geocode places
 */
async function normalizeAndGeocodePlaces(places = {}) {
  const placeTypes = ['birth', 'samadhi'];
  const geocodedPlaces = {};
  
  for (const type of placeTypes) {
    const placeData = places[type];
    if (!placeData) {
      geocodedPlaces[type] = null;
      continue;
    }

    const processPlace = async (placeObj) => {
      if (!placeObj || !placeObj.name) return null;
      
      let coords = Array.isArray(placeObj.coords) && placeObj.coords.length === 2 ? placeObj.coords : null;
      let region = placeObj.region || null;
      
      if (!coords) {
        const geoData = await geocodePlace(placeObj.name);
        coords = geoData ? [geoData.lat, geoData.lon] : null;
        region = region || (geoData ? geoData.region : null);
      }
      
      return { name: placeObj.name, coords: coords, region: region };
    };

    if (Array.isArray(placeData)) {
      const processedPlaces = [];
      for (const place of placeData) {
        const processed = await processPlace(place);
        if (processed) processedPlaces.push(processed);
      }
      geocodedPlaces[type] = processedPlaces.length ? processedPlaces : null;
    } else {
      geocodedPlaces[type] = await processPlace(placeData);
    }
  }
  
  return geocodedPlaces;
}

/**
 * Convert tradition document to map markers
 */
function convertToMapMarkers(doc) {
  const markers = [];
  if (!doc?.places || typeof doc.places !== 'object') return markers;

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
      startYear: doc.startYear,
      endYear: doc.endYear,
      language: doc.language,
      philosophy: doc.philosophy,
      texts: doc.texts || [],
      presidingDeity: doc.presidingDeity || null,
      popup: `${place.name} — ${type} of ${doc.saint}`,
      updatedAt: doc.updatedAt || null,
      fullData: doc
    });
  };

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
  
  // Middleware
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // ========================================
  // STATIC FILE SERVING
  // ========================================
  
  // Serve from frontend/ folder (primary)
  const frontendPath = path.join(__dirname, 'frontend');
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    console.log(`📁 Serving static files from: ${frontendPath}`);
  }
  
  // Also serve from root (fallback)
  app.use(express.static(__dirname));

  // ========================================
  // DATABASE CONNECTION
  // ========================================
  
  const client = new MongoClient(MONGODB_URI, {
    tls: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true,
    w: 'majority'
  });
  
  await client.connect();
  const db = client.db(DB_NAME);
  const traditionsCollection = db.collection(COLLECTION);
  
  console.log('✅ Connected to MongoDB successfully!');
  
  // Create indexes
  await traditionsCollection.createIndex({ saint: 1 }).catch(() => {});
  await traditionsCollection.createIndex({ tradition: 1 }).catch(() => {});
  await traditionsCollection.createIndex({ language: 1 }).catch(() => {});

  // ========================================
  // API ROUTES
  // ========================================

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      version: '1.0.1'
    });
  });

  // Place suggestions
  app.get('/api/suggest-places/:query', asyncHandler(async (req, res) => {
    const query = (req.params.query || '').trim();
    if (query.length < 3) return res.json([]);
    
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=in`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Bhakti-Tradition-Map/1.0' }
    });
    
    if (!response.ok) return res.json([]);
    
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

  // Filter options with intelligent parsing
  app.get('/api/filter-options', asyncHandler(async (req, res) => {
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
        traditions: [], traditionTypes: [], genders: [],
        languages: [], periods: [], saints: []
      });
    }
    
    const options = result[0];
    
    // Simple fields - just filter and sort
    ['traditionTypes', 'genders', 'periods', 'saints'].forEach(key => {
      if (options[key]) {
        options[key] = options[key].filter(Boolean).sort((a, b) => a.localeCompare(b));
      }
    });
    
    // Parse compound languages
    if (options.languages) {
      options.languages = extractUniqueValues(options.languages.filter(Boolean), 'language');
      console.log(`📚 Extracted ${options.languages.length} unique languages`);
    }
    
    // Parse compound traditions
    if (options.traditions) {
      options.traditions = extractUniqueValues(options.traditions.filter(Boolean), 'tradition');
      console.log(`🕉️ Extracted ${options.traditions.length} unique traditions`);
    }
    
    delete options._id;
    res.json(options);
  }));

  // Traditions endpoint with advanced filtering
  app.get('/api/traditions', asyncHandler(async (req, res) => {
    const { tradition, traditionType, gender, period, language, saint, placeType, search, startYearMin, startYearMax } = req.query;
    
    const filter = {};
    
    // Period and saint filters
    if (period) filter.period = new RegExp(String(period), 'i');
    if (saint) filter.saint = new RegExp(String(saint), 'i');
    
    // Enhanced tradition filter with variations
    if (tradition) {
      const tradSearch = String(tradition).trim();
      const variations = [tradSearch];
      const lowerTrad = tradSearch.toLowerCase();
      
      if (lowerTrad === 'shaiva' || lowerTrad === 'saiva') {
        variations.push('Śaiva', 'Saiva', 'Shaiva', 'Shaivism');
      } else if (lowerTrad === 'vaishnava' || lowerTrad === 'vaisnava') {
        variations.push('Vaiṣṇava', 'Vaisnava', 'Vaishnava', 'Vaishnavism');
      } else if (lowerTrad === 'lingayat') {
        variations.push('Liṅgāyat', 'Lingāyat', 'Virashaiva', 'Vīraśaiva');
      } else if (lowerTrad === 'varkari') {
        variations.push('Vārkari', 'Varkari Sampradaya');
      } else if (lowerTrad === 'gaudiya') {
        variations.push('Gauḍīya', 'Gaudīya');
      } else if (lowerTrad === 'alvars') {
        variations.push('Āḻvārs', 'Alwars');
      } else if (lowerTrad === 'nayanars') {
        variations.push('Nāyanārs', 'Nayanmars');
      }
      
      const escaped = variations.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      filter.tradition = new RegExp(escaped.join('|'), 'i');
    }
    
    // Enhanced language filter with variations
    if (language) {
      const langSearch = String(language).trim();
      const variations = [langSearch];
      const lowerLang = langSearch.toLowerCase();
      
      if (lowerLang === 'braj bhasha') {
        variations.push('Braj Bhasa', 'BrajBhasha', 'BrajBhasa', 'Brij Bhasha', 'Braj');
      } else if (lowerLang === 'hindi') {
        variations.push('Hindii', 'Hindustani');
      } else if (lowerLang === 'sanskrit') {
        variations.push('Sanskirt', 'Sankrit', 'Sanskrit-derived');
      } else if (lowerLang === 'bengali') {
        variations.push('Bangla');
      } else if (lowerLang === 'punjabi') {
        variations.push('Panjabi');
      } else if (lowerLang === 'tamil') {
        variations.push('Tamizh');
      } else if (lowerLang === 'odia') {
        variations.push('Odiya', 'Oriya');
      }
      
      const escaped = variations.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      filter.language = new RegExp(escaped.join('|'), 'i');
    }
    
    // Exact match filters
    if (traditionType) filter.traditionType = String(traditionType);
    if (gender) filter.gender = String(gender);
    
    // General search
    if (search) {
      filter.$or = [
        { saint: new RegExp(String(search), 'i') },
        { tradition: new RegExp(String(search), 'i') },
        { philosophy: new RegExp(String(search), 'i') }
      ];
    }

    // FIXED: Year range filtering with proper numeric comparison
    if (startYearMin || startYearMax) {
      const yearConditions = [];
      
      if (startYearMin) {
        const minYear = parseInt(startYearMin, 10);
        if (!isNaN(minYear)) {
          yearConditions.push({
            $expr: { $gte: [{ $toInt: { $ifNull: ['$startYear', '0'] } }, minYear] }
          });
        }
      }
      
      if (startYearMax) {
        const maxYear = parseInt(startYearMax, 10);
        if (!isNaN(maxYear)) {
          yearConditions.push({
            $expr: { $lte: [{ $toInt: { $ifNull: ['$startYear', '9999'] } }, maxYear] }
          });
        }
      }
      
      if (yearConditions.length > 0) {
        filter.$and = filter.$and ? [...filter.$and, ...yearConditions] : yearConditions;
      }
    }
    
    console.log('🔍 Filter query:', JSON.stringify(filter, null, 2));
    
    const docs = await traditionsCollection.find(filter).sort({ _id: -1 }).limit(1000).toArray();
    console.log(`📊 Found ${docs.length} traditions`);
    
    let markers = docs.flatMap(convertToMapMarkers);
    
    if (placeType && placeType !== 'all') {
      markers = markers.filter(marker => marker.type === placeType);
    }
    
    console.log(`🗺️ Returning ${markers.length} markers`);
    res.json(markers);
  }));

  // Contribution endpoint
  app.post('/api/contribute', asyncHandler(async (req, res) => {
    console.log('📝 New contribution received');
    
    const body = req.body || {};
    const validationErrors = validateContributionBody(body);
    
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const geocodedPlaces = await normalizeAndGeocodePlaces(body.places);

    const traditionDocument = {
      saint: body.saint.trim(),
      tradition: body.tradition.trim(),
      places: geocodedPlaces,
      period: body.period.trim(),
      startYear: body.startYear.trim(),
      endYear: body.endYear.trim(),
      traditionType: body.traditionType.trim(),
      school: body.school ? body.school.trim() : null,
      presidingDeity: body.presidingDeity ? body.presidingDeity.trim() : null,
      sufi: Boolean(body.sufi),
      birthPlace: body.birthPlace.trim(),
      deathPlace: body.deathPlace ? body.deathPlace.trim() : null,
      gender: body.gender.trim(),
      language: body.language.trim(),
      texts: Array.isArray(body.texts) ? body.texts : (body.texts ? [body.texts] : []),
      philosophy: body.philosophy.trim(),
      contributedAt: new Date(),
      updatedAt: new Date()
    };

    const result = await traditionsCollection.insertOne(traditionDocument);
    
    console.log(`✅ Contribution added successfully: ${traditionDocument.saint}`);
    
    res.json({
      id: result.insertedId.toString(),
      message: `Thank you for contributing information about ${traditionDocument.saint}!`,
      success: true
    });
  }));

  // Legacy places endpoint
  app.get('/api/places', asyncHandler(async (req, res) => {
    const docs = await traditionsCollection.find({}).sort({ _id: -1 }).toArray();
    const places = docs.flatMap(doc => convertToMapMarkers(doc).map(marker => ({
      id: marker.id, name: marker.name, coords: marker.coords,
      type: marker.type, saint: marker.saint, tradition: marker.tradition,
      popup: marker.popup, updatedAt: marker.updatedAt
    })));
    res.json(places);
  }));

  // ========================================
  // ERROR HANDLING & SPA FALLBACK
  // ========================================
  
  app.use((error, req, res, next) => {
    console.error('💥 Server error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  });

  // SPA fallback - serve index.html for non-API routes
  app.use('*', (req, res) => {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(404).json({ error: 'Route not found', path: req.originalUrl });
    }
    
    const frontendIndex = path.join(__dirname, 'frontend', 'index.html');
    const rootIndex = path.join(__dirname, 'index.html');
    
    if (fs.existsSync(frontendIndex)) {
      res.sendFile(frontendIndex);
    } else if (fs.existsSync(rootIndex)) {
      res.sendFile(rootIndex);
    } else {
      res.status(404).send('Frontend not found');
    }
  });

  // Start server
  const server = app.listen(PORT, () => {
    console.log('\n🚀 Bhakti Tradition Map API Server Started');
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/api/health`);
    console.log(`🕉️ Traditions: http://localhost:${PORT}/api/traditions`);
    console.log(`🎛️ Filter options: http://localhost:${PORT}/api/filter-options`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Graceful shutdown
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
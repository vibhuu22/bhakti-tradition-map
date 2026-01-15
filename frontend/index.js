/**
 * BHAKTI TRADITION MAP - MAIN APPLICATION SCRIPT
 * 
 * This is the main client-side JavaScript file for the Bhakti Tradition Map.
 * It handles map initialization, user interactions, API communication,
 * filtering, heatmaps, and the contribution system.
 * 
 * FEATURES:
 * - Interactive Leaflet map with clustering
 * - Advanced filtering system with real-time updates
 * - Place suggestions with autocomplete functionality
 * - Contribution form with validation and auto-geocoding
 * - Toast notifications for user feedback
 * - Responsive design for mobile devices
 * - Accessibility considerations
 * 
 * DEPENDENCIES:
 * - Leaflet.js: Interactive maps
 * - Leaflet.markercluster: Marker clustering
 * - config.js: API configuration
 */

// ========================================
// CONFIGURATION AND IMPORTS
// ========================================

const t1 = performance.now();

import config from './config.js';

// Extract configuration values
const API_BASE = config.API_BASE;
const { MAP_CONFIG, UI_CONFIG, FEATURES } = config;

// Log initialization information
console.log('🌐 API Base URL:', API_BASE);
console.log('🔧 Environment:', config.getEnvironment());

// ========================================
// GLOBAL VARIABLES AND STATE MANAGEMENT
// ========================================

// Map and visualization components
let map = null;
let clusterGroup = null;

// Lineage network layer - holds arrow lines connecting saints chronologically
let lineageLayer = null;
let lineageEnabled = true; // Toggle for lineage network visibility
// Data and filtering state
let allTraditions = [];
let filteredTraditions = [];
let currentFilters = {};
let selectedPlaceType = 'all';
let filterOptions = {};

// Year slider instance
// let yearSlider = null;
// const YEAR_MIN = 600;   // Bhakti movement start
// const YEAR_MAX = 1900;  // End of traditional period

// UI state management
let isDarkMode = localStorage.getItem('darkMode') === 'true';
let isFiltersVisible = false;
let isLegendCollapsed = localStorage.getItem('legendCollapsed') === 'true';

// Place suggestion caching and debouncing
let suggestionCache = new Map();
let suggestionTimeouts = new Map();

// Statistics tracking
let placeTypeCounts = {
  birth: 0,
  enlightenment: 0,
  samadhi: 0,
  temple: 0,
  influence: 0
};

// ========================================
// APPLICATION INITIALIZATION
// ========================================

/**
 * Main application initialization
 * Executed when the DOM is fully loaded
 */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Initializing Bhakti Tradition Map application...');

  try {
    // Initialize core components in sequence
    initializeTheme();
    initializeMap();
    initializeUI();
    // initializeYearSlider();
    initializeEventListeners();
    
    // Load data from API
    await Promise.all([
      loadFilterOptions(),
      loadInitialData()
    ]);
    
    console.log('✅ Application initialization complete');
  } catch (error) {
    console.error('❌ Application initialization failed:', error);
    showToast('Failed to initialize application', 'error');
  }
});

// ========================================
// THEME MANAGEMENT SYSTEM
// ========================================

/**
 * Initialize theme system and apply saved theme preference
 */
function initializeTheme() {
  console.log('🎨 Initializing theme system...');
  
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);
  updateThemeToggleUI(savedTheme);
  
  console.log(`🎨 Theme initialized: ${savedTheme}`);
}

/**
 * Apply a theme to the application
 * @param {string} theme - Theme name ('light', 'dark', or 'auto')
 */
function applyTheme(theme) {
  const body = document.body;
  
  // Remove existing theme classes
  body.classList.remove('theme-light', 'theme-dark');
  
  // Handle auto theme (follows system preference)
  let actualTheme = theme;
  if (theme === 'auto') {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    actualTheme = systemDark ? 'dark' : 'light';
  }
  
  // Apply theme
  body.classList.add(`theme-${actualTheme}`);
  body.setAttribute('data-theme', actualTheme);
  
  // Update global state
  isDarkMode = actualTheme === 'dark';
  
  // Save preference
  localStorage.setItem('theme', theme);
  localStorage.setItem('darkMode', isDarkMode.toString());
  
  // Update map tiles if map is initialized
  if (map) {
    updateMapTiles(actualTheme);
  }
}

/**
 * Update map tile layer based on theme
 * @param {string} theme - Current theme ('light' or 'dark')
 */
function updateMapTiles(theme) {
  const tileUrls = {
    light: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
    dark: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png'
  };
  
  // Remove existing tile layers
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      map.removeLayer(layer);
    }
  });
  
  // Add new tile layer - use tileUrls[theme] to get the correct URL
  L.tileLayer(tileUrls[theme], {
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors',
    subdomains: ['a', 'b', 'c']
  }).addTo(map);
}



/**
 * Update theme toggle UI to reflect current selection
 * @param {string} currentTheme - Currently active theme
 */
function updateThemeToggleUI(currentTheme) {
  const themeItems = document.querySelectorAll('.dropdown-item[data-theme]');
  themeItems.forEach(item => {
    const itemTheme = item.getAttribute('data-theme');
    if (itemTheme === currentTheme) {
      item.style.backgroundColor = 'var(--primary-color)';
      item.style.color = 'white';
    } else {
      item.style.backgroundColor = '';
      item.style.color = '';
    }
  });
}

// ========================================
// MAP INITIALIZATION AND CONFIGURATION
// ========================================

/**
 * Initialize the Leaflet map with custom styling and controls
 */
function initializeMap() {
  console.log('🗺️ Initializing map...');
  
  // Create map instance
  map = L.map('map', {
    center: MAP_CONFIG.DEFAULT_CENTER,
    zoom: MAP_CONFIG.DEFAULT_ZOOM,
    preferCanvas: true,
    zoomControl: false,
    attributionControl: true
  });
  
  // Add custom zoom control
  L.control.zoom({
    position: 'topright'
  }).addTo(map);
  
  // Add initial tile layer
  updateMapTiles(isDarkMode ? 'dark' : 'light');
  
  // Initialize marker clustering
  clusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 50,
    disableClusteringAtZoom: 15,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let sizeClass = 'small';
      if (count > 10) sizeClass = 'medium';
      if (count > 50) sizeClass = 'large';
      
      return new L.DivIcon({
        html: `<div class="marker-cluster marker-cluster-${sizeClass}"><div><span>${count}</span></div></div>`,
        className: 'marker-cluster-custom',
        iconSize: new L.Point(40, 40)
      });
    }
  });
  
  map.addLayer(clusterGroup);

  // Initialize lineage network layer (below markers but above tiles)
  lineageLayer = L.layerGroup().addTo(map);
  
  // Handle cluster events to show/hide lineage lines
  clusterGroup.on('animationend', updateLineageVisibility);
  map.on('zoomend', updateLineageVisibility);
  
  console.log('✅ Map initialized successfully');
}

// ========================================
// USER INTERFACE INITIALIZATION
// ========================================

/**
 * Initialize UI components and their initial states
 */
function initializeUI() {
  console.log('🎛️ Initializing UI components...');
  
  // Initialize filter panel state
  const filtersPanel = document.getElementById('filters-panel');
  if (filtersPanel) {
    filtersPanel.classList.add('hidden');
  }

  // Initialize legend state
  const legendContent = document.querySelector('.legend-content');
  if (legendContent && isLegendCollapsed) {
    legendContent.classList.add('collapsed');
    const toggleIcon = document.querySelector('#toggle-legend .material-icons');
    if (toggleIcon) {
      toggleIcon.textContent = 'keyboard_arrow_up';
    }
  }
  
  // Hide loading overlay initially
  hideLoadingOverlay();
  
  console.log('✅ UI components initialized');
}

/**
 * Initialize the year range slider using noUiSlider
 */
// function initializeYearSlider() {
//   const sliderElement = document.getElementById('year-range-slider');
  
//   if (!sliderElement) {
//     console.warn('Year slider element not found');
//     return;
//   }
  
//   // Create the noUiSlider
//   yearSlider = noUiSlider.create(sliderElement, {
//     start: [YEAR_MIN, YEAR_MAX],
//     connect: true,
//     step: 10,
//     range: {
//       'min': YEAR_MIN,
//       'max': YEAR_MAX
//     },
//     format: {
//       to: value => Math.round(value),
//       from: value => Number(value)
//     },
//     tooltips: false,
//     pips: {
//       mode: 'values',
//       values: [600, 800, 1000, 1200, 1400, 1600, 1800, 1900],
//       density: 4,
//       format: {
//         to: value => value
//       }
//     }
//   });
  
//   // Update display on slide
//   yearSlider.on('update', function(values, handle) {
//     const minYear = Math.round(values[0]);
//     const maxYear = Math.round(values[1]);
    
//     document.getElementById('year-min-display').textContent = minYear;
//     document.getElementById('year-max-display').textContent = maxYear;
//     document.getElementById('search-filter1').value = minYear;
//     document.getElementById('search-filter2').value = maxYear;
//   });
  
//   // Apply filter when user stops sliding
//   yearSlider.on('change', function(values, handle) {
//     const minYear = Math.round(values[0]);
//     const maxYear = Math.round(values[1]);
    
//     console.log(`📅 Year range changed: ${minYear} - ${maxYear}`);
//     updateCurrentFilters();
//     applyCurrentFilters();
//   });
  
//   console.log('✅ Year range slider initialized');
// }

// ========================================
// EVENT LISTENERS
// ========================================

/**
 * Initialize all event listeners for user interactions
 */
function initializeEventListeners() {
  console.log('🎧 Setting up event listeners...');
  
  // Header action buttons
  setupHeaderEventListeners();
  
  // Theme dropdown
  setupThemeEventListeners();
  
  // Filter panel
  setupFilterEventListeners();
  
  // Contribution modal
  setupContributionEventListeners();
  
  // Legend panel
  setupLegendEventListeners();
  
  // Quick filter chips
  setupQuickFilterEventListeners();
  
  // Keyboard shortcuts
  setupKeyboardEventListeners();
  
  console.log('✅ Event listeners initialized');
}

/**
 * Setup header button event listeners
 */
function setupHeaderEventListeners() {
  // Filter toggle button
  const btnFilters = document.getElementById('btn-filters');
  if (btnFilters) {
    btnFilters.addEventListener('click', toggleFiltersPanel);
  }

  // Lineage network toggle button
  const btnLineage = document.getElementById('btn-lineage');
  if (btnLineage) {
    btnLineage.addEventListener('click', toggleLineageNetwork);
  }
  
  // Contribute button
  const btnContribute = document.getElementById('btn-contribute');
  if (btnContribute) {
    btnContribute.addEventListener('click', openContributionModal);
  }
}

/**
 * Setup theme dropdown event listeners
 */
function setupThemeEventListeners() {
  const themeDropdown = document.getElementById('theme-dropdown');
  const themeToggle = themeDropdown?.querySelector('.dropdown-toggle');
  
  if (themeToggle) {
    themeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      themeDropdown.classList.toggle('open');
    });
  }
  
  // Theme selection
  const themeItems = document.querySelectorAll('.dropdown-item[data-theme]');
  themeItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const theme = item.getAttribute('data-theme');
      applyTheme(theme);
      updateThemeToggleUI(theme);
      themeDropdown?.classList.remove('open');
    });
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    themeDropdown?.classList.remove('open');
  });
}

/**
 * Setup filter panel event listeners
 */
function setupFilterEventListeners() {
  // Close filters button
  const closeFilters = document.getElementById('close-filters');
  if (closeFilters) {
    closeFilters.addEventListener('click', toggleFiltersPanel);
  }
  
  // Apply filters button - SINGLE HANDLER
  const applyFiltersBtn = document.getElementById('apply-filters');
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
      updateCurrentFilters();
      applyCurrentFilters();
    });
  }
  
  // Clear filters button
  const clearFilters = document.getElementById('clear-filters');
  if (clearFilters) {
    clearFilters.addEventListener('click', clearAllFilters);
  }
  
  // Search input with debouncing
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentFilters.search = e.target.value;
        applyCurrentFilters();
      }, UI_CONFIG.SEARCH_DEBOUNCE);
    });
  }
  
  // Year filter inputs - Add real-time validation
  const startYearInput = document.getElementById('search-filter1');
  const endYearInput = document.getElementById('search-filter2');
  
  // Add input validation for year fields
  [startYearInput, endYearInput].forEach(input => {
    if (input) {
      input.addEventListener('input', (e) => {
        // Only allow numbers
        e.target.value = e.target.value.replace(/[^\d]/g, '');
      });
    }
  });

  // Filter dropdowns
  const filterSelects = document.querySelectorAll('#filters-panel select');
  filterSelects.forEach(select => {
    select.addEventListener('change', updateCurrentFilters);
  });
}

/**
 * Setup contribution modal event listeners
 */
function setupContributionEventListeners() {
  const modal = document.getElementById('contribution-modal');
  const closeModal = document.getElementById('close-modal');
  const cancelBtn = document.getElementById('cancel-contribution');
  const form = document.getElementById('contribution-form');
  
  // Close modal events
  [closeModal, cancelBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', closeContributionModal);
    }
  });
  
  // Close modal when clicking backdrop
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeContributionModal();
      }
    });
  }
  
  // Form submission
  if (form) {
    form.addEventListener('submit', handleContributionSubmit);
  }
  
  // Place suggestion inputs
  setupPlaceSuggestions();
}

/**
 * Setup legend panel event listeners
 */
function setupLegendEventListeners() {
  const toggleLegend = document.getElementById('toggle-legend');
  if (toggleLegend) {
    toggleLegend.addEventListener('click', toggleLegendPanel);
  }
  
  // Legend item filters
  const legendItems = document.querySelectorAll('.legend-item[data-place-type]');
  legendItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const placeType = item.getAttribute('data-place-type');
      filterByPlaceType(placeType);
    });
  });
}

/**
 * Setup quick filter chip event listeners
 */
function setupQuickFilterEventListeners() {
  const filterChips = document.querySelectorAll('.filter-chip[data-place-type]');
  filterChips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const placeType = chip.getAttribute('data-place-type');
      filterByPlaceType(placeType);
      updateQuickFilterUI(placeType);
    });
  });
}

/**
 * Setup keyboard event listeners for accessibility
 */
function setupKeyboardEventListeners() {
  document.addEventListener('keydown', (e) => {
    // Escape key to close modals and panels
    if (e.key === 'Escape') {
      closeContributionModal();
      if (isFiltersVisible) {
        toggleFiltersPanel();
      }
    }
    
    // Ctrl/Cmd + F to open filters
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      if (!isFiltersVisible) {
        toggleFiltersPanel();
      }
    }
  });
}

// ========================================
// DATA LOADING AND API COMMUNICATION
// ========================================

/**
 * Load filter options from API
 */
async function loadFilterOptions() {
  try {
    showLoadingOverlay('Loading filter options...');
    
    const response = await fetch(`${API_BASE}/filter-options`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    filterOptions = await response.json();
    populateFilterDropdowns();
    
    console.log('✅ Filter options loaded successfully');
  } catch (error) {
    console.error('❌ Failed to load filter options:', error);
    showToast('Failed to load filter options', 'error');
  }
}

/**
 * Load initial tradition data from API
 */
async function loadInitialData() {
  try {
    showLoadingOverlay('Loading sacred places...');
    
    const response = await fetch(`${API_BASE}/traditions`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    allTraditions = await response.json();
    filteredTraditions = [...allTraditions];

    updateMapMarkers();
    updateStatistics();
    updateLegendCounts();
    
    hideLoadingOverlay();

    console.log(`✅ Loaded ${allTraditions.length} traditions successfully`);
    showToast(`Loaded ${allTraditions.length} sacred places`, 'success');
  } catch (error) {
    console.error('❌ Failed to load initial data:', error);
    hideLoadingOverlay();
    showToast('Failed to load tradition data', 'error');
  }
}

/**
 * Populate filter dropdown options
 */
function populateFilterDropdowns() {
  const dropdowns = {
    'saint-filter': filterOptions.saints || [],
    'tradition-filter': filterOptions.traditions || [],
    'tradition-type-filter': filterOptions.traditionTypes || [],
    'gender-filter': filterOptions.genders || [],
    'language-filter': filterOptions.languages || [],
    'period-filter': filterOptions.periods || []
  };
  
  Object.entries(dropdowns).forEach(([selectId, options]) => {
    const select = document.getElementById(selectId);
    if (select) {
      // Clear existing options except the first one (All...)
      const firstOption = select.firstElementChild;
      select.innerHTML = '';
      if (firstOption) {
        select.appendChild(firstOption);
      }
      
      // Add new options
      options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        select.appendChild(optionElement);
      });
    }
  });
}

// ========================================
// FILTERING SYSTEM
// ========================================

/**
 * Update current filters from form inputs
 */
function updateCurrentFilters() {
  const filterInputs = {
    saint: document.getElementById('saint-filter')?.value || '',
    tradition: document.getElementById('tradition-filter')?.value || '',
    traditionType: document.getElementById('tradition-type-filter')?.value || '',
    gender: document.getElementById('gender-filter')?.value || '',
    language: document.getElementById('language-filter')?.value || '',
    period: document.getElementById('period-filter')?.value || '',
    placeType: document.getElementById('place-type-filter')?.value || '',
    search: document.getElementById('search-input')?.value || '',
    startYearMin: document.getElementById('search-filter1')?.value,
    startYearMax: document.getElementById('search-filter2')?.value
  };
  
  // Remove empty values
  currentFilters = Object.fromEntries(
    Object.entries(filterInputs).filter(([_, value]) => value !== '')
  );
  
  console.log('📋 Updated filters:', currentFilters);
}

/**
 * Apply current filters to the data
 */
async function applyCurrentFilters() {
  try {
    showLoadingOverlay('Applying filters...');
    
    // Build query parameters
    const params = new URLSearchParams();
    Object.entries(currentFilters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    
    console.log('🔍 Filter query params:', params.toString());
    
    // Fetch filtered data
    const response = await fetch(`${API_BASE}/traditions?${params}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    filteredTraditions = await response.json();
    
    console.log('📊 Received filtered traditions:', filteredTraditions.length);
    
    updateMapMarkers();
    updateLegendCounts();
    
    hideLoadingOverlay();
    
    const count = filteredTraditions.length;
    showToast(`Found ${count} place${count !== 1 ? 's' : ''}`, 'info');
    
    console.log(`🔍 Applied filters, showing ${count} places`);
  } catch (error) {
    console.error('❌ Failed to apply filters:', error);
    hideLoadingOverlay();
    showToast('Failed to apply filters', 'error');
  }
}

/**
 * Clear all filters and reload data
 */
function clearAllFilters() {
  // Clear filter form
  const filterForm = document.querySelector('#filters-panel');
  if (filterForm) {
    const inputs = filterForm.querySelectorAll('input, select');
    inputs.forEach(input => {
      if (input.type === 'text' || input.type === 'search') {
        input.value = '';
      } else if (input.tagName === 'SELECT') {
        input.selectedIndex = 0;
      }
    });
  }
  
  // Clear year filter inputs specifically
  document.getElementById('search-filter1').value = '';
  document.getElementById('search-filter2').value = '';
  // Reset year slider to full range
// if (yearSlider) {
//   yearSlider.set([YEAR_MIN, YEAR_MAX]);
// }
  
  // Clear current filters
  currentFilters = {};
  selectedPlaceType = 'all';
  
  // Reset data
  filteredTraditions = [...allTraditions];
  updateMapMarkers();
  updateLegendCounts();
  updateQuickFilterUI('all');
  
  showToast('Filters cleared', 'info');
}

/**
 * Filter by specific place type
 * @param {string} placeType - Place type to filter by
 */
function filterByPlaceType(placeType) {
  selectedPlaceType = placeType;
  
  if (placeType === 'all') {
    filteredTraditions = [...allTraditions];
  } else {
    filteredTraditions = allTraditions.filter(tradition => tradition.type === placeType);
  }
  
  updateMapMarkers();
  updateLegendCounts();
  
  const count = filteredTraditions.length;
  const typeName = placeType === 'all' ? 'places' : `${placeType} places`;
  showToast(`Showing ${count} ${typeName}`, 'info');
}

// ========================================
// MAP MARKER MANAGEMENT
// ========================================

/**
 * Update map markers based on current data
 * Uses the global filteredTraditions array
 */
function updateMapMarkers() {
  // Clear existing markers
  clusterGroup.clearLayers();
  
  // Add new markers from filteredTraditions
  filteredTraditions.forEach(tradition => {
    const marker = createMarker(tradition);
    if (marker) {
      clusterGroup.addLayer(marker);
    }
  });

   // Update the lineage network after markers are placed
   if (lineageEnabled) {
    updateLineageNetwork();
  }
  
  console.log(`🗺️ Updated map with ${filteredTraditions.length} markers`);
}

/**
 * Create a marker for a tradition place
 * @param {Object} tradition - Tradition data
 * @returns {L.Marker} Leaflet marker
 */
function createMarker(tradition) {
  if (!tradition.coords || !Array.isArray(tradition.coords) || tradition.coords.length !== 2) {
    return null;
  }
  
  const [lat, lng] = tradition.coords;
  
  // Create custom icon
  const icon = createCustomIcon(tradition.type, tradition.saint);
  
  // Create marker
  const marker = L.marker([lat, lng], { icon });
  
  // Add popup
  const popupContent = createPopupContent(tradition);
  marker.bindPopup(popupContent, {
    maxWidth: 350,
    className: 'custom-popup'
  });
  
  return marker;
}

/**
 * Create custom marker icon
 * @param {string} type - Place type
 * @param {string} saint - Saint name
 * @returns {L.DivIcon} Custom Leaflet icon
 */
function createCustomIcon(type, saint) {
  const iconMap = {
    birth: 'spa'
  };
  
  const icon = iconMap[type] || 'place';
  const colorClass = `marker-${type}`;
  
  return L.divIcon({
    html: `
      <div class="unified-marker-container">
        <div class="custom-marker ${colorClass}">
          <span class="material-icons marker-symbol">${icon}</span>
        </div>
        <div class="saint-label-attached">${saint || 'Unknown'}</div>
      </div>
    `,
    className: 'unified-marker-icon',
    iconSize: [36, 60],
    iconAnchor: [18, 60]
  });
}

/**
 * Create popup content for a marker
 * @param {Object} tradition - Tradition data
 * @returns {string} HTML content for popup
 */
function createPopupContent(tradition) {
  const typeLabel = config.formatPlaceType(tradition.type);
  
  // Get the year info from the original tradition data
  const yearInfo = tradition.startYear ? 
    `<div class="popup-field">
      <span class="material-icons">event</span>
      <div>
        <strong>Period:</strong> ${tradition.startYear}${tradition.endYear ? ' - ' + tradition.endYear : ''}
      </div>
    </div>` : '';
  
  return `
    <div class="popup-content">
      <div class="popup-header">
        <h3>
          <span class="material-icons">${config.getMarkerIcon(tradition.type)}</span>
          ${tradition.name}
        </h3>
        <span class="place-type-badge">${typeLabel}</span>
      </div>
      <div class="popup-body">
        <div class="popup-field">
          <span class="material-icons">person</span>
          <div>
            <strong>Saint:</strong> ${tradition.saint || 'Unknown'}
          </div>
        </div>
        <div class="popup-field">
          <span class="material-icons">account_balance</span>
          <div>
            <strong>Tradition:</strong> ${tradition.tradition || 'Unknown'}
          </div>
        </div>
        ${yearInfo}
        ${tradition.traditionType ? `
        <div class="popup-field">
          <span class="material-icons">category</span>
          <div>
            <strong>Type:</strong> ${tradition.traditionType}
          </div>
        </div>
        ` : ''}
        ${tradition.language ? `
        <div class="popup-field">
          <span class="material-icons">language</span>
          <div>
            <strong>Language:</strong> ${tradition.language}
          </div>
        </div>
        ` : ''}
        ${tradition.philosophy ? `
        <div class="popup-philosophy">
          <strong>Philosophy & Teachings:</strong>
          <p>${tradition.philosophy}</p>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ========================================
// LINEAGE NETWORK MANAGEMENT
// ========================================

/**
 * Update the lineage network - creates arrow lines from earlier to later saints
 * based on their startYear values
 */
function updateLineageNetwork() {
  if (!lineageLayer) return;
  
  // Clear existing lineage lines
  lineageLayer.clearLayers();
  
  // Filter traditions that have valid coordinates and startYear
  const traditionsWithYear = filteredTraditions.filter(t => 
    t.coords && 
    Array.isArray(t.coords) && 
    t.coords.length === 2 &&
    t.startYear &&
    !isNaN(parseInt(t.startYear, 10))
  );
  
  if (traditionsWithYear.length < 2) {
    console.log('📊 Not enough data points for lineage network');
    return;
  }
  
  // Sort by startYear (chronologically)
  const sortedTraditions = [...traditionsWithYear].sort((a, b) => {
    return parseInt(a.startYear, 10) - parseInt(b.startYear, 10);
  });
  
  // Create connections between consecutive saints (chronological chain)
  const connections = [];
  for (let i = 0; i < sortedTraditions.length - 1; i++) {
    const current = sortedTraditions[i];
    const next = sortedTraditions[i + 1];
    
    connections.push({
      from: current,
      to: next,
      fromYear: parseInt(current.startYear, 10),
      toYear: parseInt(next.startYear, 10)
    });
  }
  
  console.log(`🔗 Creating ${connections.length} lineage connections`);
  
  // Create arrow lines for each connection
  connections.forEach(connection => {
    createLineageArrow(connection);
  });
  
  // Update visibility based on current clustering state
  updateLineageVisibility();
}

/**
 * Create an arrow line between two tradition markers
 * @param {Object} connection - Connection object with from/to traditions
 */
function createLineageArrow(connection) {
  const { from, to, fromYear, toYear } = connection;
  
  // Create the polyline with an arrow
  const fromLatLng = L.latLng(from.coords[0], from.coords[1]);
  const toLatLng = L.latLng(to.coords[0], to.coords[1]);
  
  // Calculate the year difference for color intensity
  const yearDiff = toYear - fromYear;
  const opacity = Math.max(0.3, Math.min(0.8, 0.3 + (yearDiff / 500) * 0.5));
  
  // Create a curved line (using a bezier-like approach with intermediate point)
  const midLat = (from.coords[0] + to.coords[0]) / 2;
  const midLng = (from.coords[1] + to.coords[1]) / 2;
  
  // Add some curve offset based on distance
  const distance = fromLatLng.distanceTo(toLatLng);
  const curveOffset = Math.min(distance * 0.0001, 2); // Limit curve
  
  // Create intermediate point for curve (offset perpendicular to the line)
  const dx = to.coords[1] - from.coords[1];
  const dy = to.coords[0] - from.coords[0];
  const perpLat = midLat + (dx * curveOffset * 0.01);
  const perpLng = midLng - (dy * curveOffset * 0.01);
  
  // Create polyline with curve
  const linePoints = [
    fromLatLng,
    L.latLng(perpLat, perpLng),
    toLatLng
  ];
  
  // Main line
  const polyline = L.polyline(linePoints, {
    color: getLineageColor(fromYear),
    weight: 2,
    opacity: opacity,
    smoothFactor: 1,
    dashArray: '5, 10',
    className: 'lineage-line'
  });
  
  // Store connection data on the polyline for visibility checking
  polyline._lineageData = {
    fromCoords: from.coords,
    toCoords: to.coords,
    fromSaint: from.saint,
    toSaint: to.saint,
    fromYear: fromYear,
    toYear: toYear
  };
  
  // Add tooltip showing connection info
  const tooltipContent = `
    <div class="lineage-tooltip">
      <strong>${from.saint}</strong> (${fromYear} CE)
      <br/>↓<br/>
      <strong>${to.saint}</strong> (${toYear} CE)
      <br/><small>${toYear - fromYear} years</small>
    </div>
  `;
  polyline.bindTooltip(tooltipContent, {
    sticky: true,
    className: 'lineage-tooltip-container'
  });
  
  // Add arrow head at the end
  const arrowHead = createArrowHead(linePoints[linePoints.length - 2], toLatLng, getLineageColor(fromYear), opacity);
  
  // Add to lineage layer
  lineageLayer.addLayer(polyline);
  if (arrowHead) {
    lineageLayer.addLayer(arrowHead);
  }
}

/**
 * Create an arrow head marker at the end of a line
 * @param {L.LatLng} fromPoint - Point before the arrow
 * @param {L.LatLng} toPoint - Arrow tip position
 * @param {string} color - Arrow color
 * @param {number} opacity - Arrow opacity
 * @returns {L.Marker} Arrow head marker
 */
function createArrowHead(fromPoint, toPoint, color, opacity) {
  // Calculate angle from the last segment
  const angle = Math.atan2(
    toPoint.lat - fromPoint.lat,
    toPoint.lng - fromPoint.lng
  ) * (180 / Math.PI);
  
  // Create arrow head using SVG
  const arrowIcon = L.divIcon({
    html: `
      <svg viewBox="0 0 20 20" style="transform: rotate(${angle - 90}deg); opacity: ${opacity};">
        <path d="M10 0 L20 20 L10 15 L0 20 Z" fill="${color}" />
      </svg>
    `,
    className: 'lineage-arrow-head',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
  
  return L.marker(toPoint, { 
    icon: arrowIcon, 
    interactive: false,
    zIndexOffset: -1000 
  });
}

/**
 * Get color for lineage line based on century/era
 * @param {number} year - Start year
 * @returns {string} Hex color code
 */
function getLineageColor(year) {
  // Color gradient from early (gold) to late (deep purple)
  if (year < 800) return '#FFD700';      // Gold - Early period
  if (year < 1000) return '#FFA500';     // Orange
  if (year < 1200) return '#FF6B6B';     // Coral
  if (year < 1400) return '#E066FF';     // Purple
  if (year < 1600) return '#9370DB';     // Medium purple
  if (year < 1800) return '#6B5B95';     // Deep purple
  return '#4A4A6A';                       // Dark slate - Modern
}

/**
 * Update visibility of lineage lines based on clustering state
 * Lines should be hidden when their connected markers are clustered
 */
function updateLineageVisibility() {
  if (!lineageLayer || !clusterGroup) return;
  
  const currentZoom = map.getZoom();
  const disableClusteringZoom = 15;
  
  // If clustering is disabled, show all lines
  if (currentZoom >= disableClusteringZoom) {
    lineageLayer.eachLayer(layer => {
      if (layer.setStyle) {
        layer.setStyle({ opacity: layer.options.opacity || 0.5 });
      } else if (layer._icon) {
        layer._icon.style.display = '';
      }
    });
    return;
  }
  
  // Get all visible (unclustered) markers
  const visibleMarkers = [];
  clusterGroup.eachLayer(layer => {
    if (layer.getLatLng) {
      const latlng = layer.getLatLng();
      visibleMarkers.push({
        lat: latlng.lat,
        lng: latlng.lng
      });
    }
  });
  
  // Check each lineage line and hide if endpoints are clustered
  lineageLayer.eachLayer(layer => {
    if (layer._lineageData) {
      const { fromCoords, toCoords } = layer._lineageData;
      
      // Check if both endpoints are visible (not clustered)
      const fromVisible = isMarkerVisible(fromCoords, visibleMarkers);
      const toVisible = isMarkerVisible(toCoords, visibleMarkers);
      
      // Show line only if both endpoints are visible
      if (fromVisible && toVisible) {
        if (layer.setStyle) {
          layer.setStyle({ opacity: layer.options.opacity || 0.5 });
        }
      } else {
        if (layer.setStyle) {
          layer.setStyle({ opacity: 0 });
        }
      }
    } else if (layer._icon) {
      // This is an arrow head - check parent line visibility
      // For simplicity, we'll check if the arrow's position is visible
      const arrowPos = layer.getLatLng();
      const isVisible = visibleMarkers.some(m => 
        Math.abs(m.lat - arrowPos.lat) < 0.001 && 
        Math.abs(m.lng - arrowPos.lng) < 0.001
      );
      layer._icon.style.display = isVisible ? '' : 'none';
    }
  });
}

/**
 * Check if a marker at given coordinates is visible (not clustered)
 * @param {Array} coords - [lat, lng] coordinates
 * @param {Array} visibleMarkers - Array of visible marker positions
 * @returns {boolean} True if marker is visible
 */
function isMarkerVisible(coords, visibleMarkers) {
  const tolerance = 0.0001; // Small tolerance for floating point comparison
  return visibleMarkers.some(m => 
    Math.abs(m.lat - coords[0]) < tolerance && 
    Math.abs(m.lng - coords[1]) < tolerance
  );
}

/**
 * Toggle lineage network visibility
 */
function toggleLineageNetwork() {
  lineageEnabled = !lineageEnabled;
  
  if (lineageEnabled) {
    updateLineageNetwork();
    showToast('Lineage network enabled', 'info');
  } else {
    if (lineageLayer) {
      lineageLayer.clearLayers();
    }
    showToast('Lineage network disabled', 'info');
  }
  
  // Update button state
  const btnLineage = document.getElementById('btn-lineage');
  if (btnLineage) {
    btnLineage.classList.toggle('active', lineageEnabled);
  }
}
// ========================================
// UI PANEL MANAGEMENT
// ========================================

/**
 * Toggle filters panel visibility
 */
function toggleFiltersPanel() {
  const filtersPanel = document.getElementById('filters-panel');
  if (!filtersPanel) return;
  
  isFiltersVisible = !isFiltersVisible;
  
  if (isFiltersVisible) {
    filtersPanel.classList.remove('hidden');
    updateCurrentFilters();
  } else {
    filtersPanel.classList.add('hidden');
  }
  
  // Update button state
  const btnFilters = document.getElementById('btn-filters');
  if (btnFilters) {
    btnFilters.style.backgroundColor = isFiltersVisible ? 'rgba(255, 255, 255, 0.3)' : '';
  }
}

/**
 * Toggle legend panel collapse state
 */
function toggleLegendPanel() {
  const legendContent = document.querySelector('.legend-content');
  const toggleIcon = document.querySelector('#toggle-legend .material-icons');
  
  if (!legendContent || !toggleIcon) return;
  
  isLegendCollapsed = !isLegendCollapsed;
  
  if (isLegendCollapsed) {
    legendContent.classList.add('collapsed');
    toggleIcon.textContent = 'keyboard_arrow_up';
  } else {
    legendContent.classList.remove('collapsed');
    toggleIcon.textContent = 'keyboard_arrow_down';
  }
  
  localStorage.setItem('legendCollapsed', isLegendCollapsed.toString());
}

/**
 * Update quick filter UI state
 * @param {string} activeType - Currently active place type
 */
function updateQuickFilterUI(activeType) {
  const filterChips = document.querySelectorAll('.filter-chip[data-place-type]');
  filterChips.forEach(chip => {
    const chipType = chip.getAttribute('data-place-type');
    if (chipType === activeType) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

// ========================================
// CONTRIBUTION SYSTEM
// ========================================

/**
 * Open contribution modal
 */
function openContributionModal() {
  const modal = document.getElementById('contribution-modal');
  if (modal) {
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    // Focus first input
    const firstInput = modal.querySelector('input[type="text"]');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }
}

/**
 * Close contribution modal
 */
function closeContributionModal() {
  const modal = document.getElementById('contribution-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
    
    // Reset form
    const form = document.getElementById('contribution-form');
    if (form) {
      form.reset();
    }
  }
}

/**
 * Handle contribution form submission
 * @param {Event} e - Form submit event
 */
async function handleContributionSubmit(e) {
  e.preventDefault();
  
  try {
    showLoadingOverlay('Submitting contribution...');
    
    const formData = new FormData(e.target);
    
    const contributionData = {
      saint: formData.get('saint'),
      tradition: formData.get('tradition'),
      startYear : formData.get('startYear'),
      endYear: formData.get('endYear'),
      period : formData.get('period'),
      traditionType: formData.get('traditionType'),
      gender: formData.get('gender'),
      language: formData.get('language'),
      school: formData.get('school'),
      presidingDeity: formData.get('presidingDeity'),
      sufi: formData.has('sufi'),
      texts: formData.get('texts')?.split(',').map(t => t.trim()).filter(Boolean) || [],
      philosophy: formData.get('philosophy'),
      birthPlace: formData.get("birthPlace") || "",
      deathPlace: formData.get("deathPlace") || "",
      places: {
        birth: processPlaceInput(formData.get('birthPlace')),
        death: processPlaceInput(formData.get('deathPlace')),
      },
      relatedSaints : {
        id : formData.get('RelatedSaintName'),
        type : formData.get('typeOfRelation')
      }
    };
    
    const response = await fetch(`${API_BASE}/contribute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contributionData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    hideLoadingOverlay();
    closeContributionModal();
    
    showToast(result.message || 'Contribution submitted successfully!', 'success');
    
    // Reload data to include new contribution
    await loadInitialData();
    
  } catch (error) {
    console.error('❌ Failed to submit contribution:', error);
    hideLoadingOverlay();
    showToast(error.message || 'Failed to submit contribution', 'error');
  }
}

/**
 * Process single place input
 * @param {string} input - Place input string
 * @returns {Object|null} Processed place object
 */
function processPlaceInput(input) {
  if (!input || !input.trim()) return null;
  
  return {
    name: input.trim(),
    coords: null,
    region: null
  };
}

// ========================================
// PLACE SUGGESTIONS SYSTEM
// ========================================

/**
 * Setup place suggestion functionality
 */
function setupPlaceSuggestions() {
  const suggestionInputs = [
    'birth-place','death-place'
  ];
  
  suggestionInputs.forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      setupSinglePlaceSuggestion(input);
    }
  });
}

/**
 * Setup place suggestion for a single input
 * @param {HTMLElement} input - Input element
 */
function setupSinglePlaceSuggestion(input) {
  const container = input.parentElement;
  const suggestionsId = input.id + '-suggestions';
  let suggestionsList = document.getElementById(suggestionsId);
  
  if (!suggestionsList) {
    suggestionsList = document.createElement('ul');
    suggestionsList.id = suggestionsId;
    suggestionsList.className = 'place-suggestions';
    container.appendChild(suggestionsList);
  }
  
  let currentSelection = -1;
  
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    if (query.length < 3) {
      hideSuggestions(suggestionsList);
      return;
    }
    
    // Clear existing timeout
    if (suggestionTimeouts.has(input.id)) {
      clearTimeout(suggestionTimeouts.get(input.id));
    }
    
    // Set new timeout for debouncing
    const timeout = setTimeout(() => {
      fetchPlaceSuggestions(query, suggestionsList, input);
    }, UI_CONFIG.SEARCH_DEBOUNCE);
    
    suggestionTimeouts.set(input.id, timeout);
  });
  
  input.addEventListener('keydown', (e) => {
    const items = suggestionsList.querySelectorAll('.suggestion-item');
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        currentSelection = Math.min(currentSelection + 1, items.length - 1);
        updateSuggestionSelection(items, currentSelection);
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        currentSelection = Math.max(currentSelection - 1, -1);
        updateSuggestionSelection(items, currentSelection);
        break;
      
      case 'Enter':
        e.preventDefault();
        if (currentSelection >= 0 && items[currentSelection]) {
          selectSuggestion(items[currentSelection], input, suggestionsList);
        }
        break;
      
      case 'Escape':
        hideSuggestions(suggestionsList);
        currentSelection = -1;
        break;
    }
  });
  
  input.addEventListener('blur', () => {
    // Delay hiding to allow clicking on suggestions
    setTimeout(() => {
      hideSuggestions(suggestionsList);
      currentSelection = -1;
    }, 150);
  });
}

/**
 * Fetch place suggestions from API
 * @param {string} query - Search query
 * @param {HTMLElement} suggestionsList - Suggestions list element
 * @param {HTMLElement} input - Input element
 */
async function fetchPlaceSuggestions(query, suggestionsList, input) {
  try {
    const response = await fetch(`${API_BASE}/suggest-places/${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const suggestions = await response.json();
    displaySuggestions(suggestions, suggestionsList, input);
  } catch (error) {
    console.error('❌ Failed to fetch place suggestions:', error);
    hideSuggestions(suggestionsList);
  }
}

/**
 * Display place suggestions
 * @param {Array} suggestions - Array of suggestion objects
 * @param {HTMLElement} suggestionsList - Suggestions list element
 * @param {HTMLElement} input - Input element
 */
function displaySuggestions(suggestions, suggestionsList, input) {
  suggestionsList.innerHTML = '';
  
  if (suggestions.length === 0) {
    hideSuggestions(suggestionsList);
    return;
  }
  
  suggestions.slice(0, 5).forEach((suggestion, index) => {
    const item = document.createElement('li');
    item.className = 'suggestion-item';
    item.textContent = suggestion.fullName || suggestion.name;
    item.dataset.value = suggestion.name;
    
    item.addEventListener('click', () => {
      selectSuggestion(item, input, suggestionsList);
    });
    
    suggestionsList.appendChild(item);
  });
  
  showSuggestions(suggestionsList);
}

/**
 * Select a place suggestion
 * @param {HTMLElement} item - Selected suggestion item
 * @param {HTMLElement} input - Input element
 * @param {HTMLElement} suggestionsList - Suggestions list element
 */
function selectSuggestion(item, input, suggestionsList) {
  input.value = item.dataset.value;
  hideSuggestions(suggestionsList);
  input.focus();
}

/**
 * Update suggestion selection highlighting
 * @param {NodeList} items - Suggestion items
 * @param {number} selectedIndex - Index of selected item
 */
function updateSuggestionSelection(items, selectedIndex) {
  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.classList.add('highlighted');
    } else {
      item.classList.remove('highlighted');
    }
  });
}

/**
 * Show suggestions list
 * @param {HTMLElement} suggestionsList - Suggestions list element
 */
function showSuggestions(suggestionsList) {
  suggestionsList.classList.add('show');
  suggestionsList.style.display = 'block';
}

/**
 * Hide suggestions list
 * @param {HTMLElement} suggestionsList - Suggestions list element
 */
function hideSuggestions(suggestionsList) {
  suggestionsList.classList.remove('show');
  suggestionsList.style.display = 'none';
}

// ========================================
// STATISTICS AND UI UPDATES
// ========================================

/**
 * Update header statistics
 */
function updateStatistics() {
  const totalPlaces = document.getElementById('total-places');
  const totalSaints = document.getElementById('total-saints');
  const totalTraditions = document.getElementById('total-traditions');
  
  if (totalPlaces) {
    totalPlaces.textContent = allTraditions.length;
  }
  
  if (totalSaints) {
    const uniqueSaints = new Set(allTraditions.map(t => t.saint).filter(Boolean));
    totalSaints.textContent = uniqueSaints.size;
  }
  
  if (totalTraditions) {
    const uniqueTraditions = new Set(allTraditions.map(t => t.tradition).filter(Boolean));
    totalTraditions.textContent = uniqueTraditions.size;
  }
}

/**
 * Update legend counts
 */
function updateLegendCounts() {
  // Count places by type
  const counts = {
    birth: 0
  };
  
  filteredTraditions.forEach(tradition => {
    if (tradition.type && counts.hasOwnProperty(tradition.type)) {
      counts[tradition.type]++;
    }
  });
  
  // Update UI
  Object.entries(counts).forEach(([type, count]) => {
    const countElement = document.getElementById(`${type}-count`);
    if (countElement) {
      countElement.textContent = count;
    }
  });
  
  placeTypeCounts = counts;
}

// ========================================
// LOADING OVERLAY
// ========================================

/**
 * Show loading overlay with message
 * @param {string} message - Loading message
 */
function showLoadingOverlay(message = 'Loading...') {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    const messageElement = overlay.querySelector('p');
    if (messageElement) {
      messageElement.textContent = message;
    }
    overlay.classList.remove('hidden');
  }
}

/**
 * Hide loading overlay
 */
function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

// ========================================
// TOAST NOTIFICATIONS
// ========================================

/**
 * Show toast notification
 * @param {string} message - Notification message
 * @param {string} type - Notification type (success, error, warning, info)
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const iconMap = {
    success: 'check_circle',
    error: 'error',
    warning: 'warning',
    info: 'info'
  };
  
  toast.innerHTML = `
    <span class="material-icons">${iconMap[type] || 'info'}</span>
    <span>${message}</span>
    <button class="toast-close">
      <span class="material-icons">close</span>
    </button>
  `;
  
  // Add close functionality
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    toast.remove();
  });
  
  container.appendChild(toast);
  
  // Auto remove after duration
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, UI_CONFIG.TOAST_DURATION);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num) {
  return num.toLocaleString();
}

// ========================================
// ERROR HANDLING
// ========================================

/**
 * Global error handler
 */
window.addEventListener('error', (e) => {
  console.error('💥 Global error:', e.error);
  showToast('An unexpected error occurred', 'error');
});

/**
 * Unhandled promise rejection handler
 */
window.addEventListener('unhandledrejection', (e) => {
  console.error('💥 Unhandled promise rejection:', e.reason);
  showToast('An unexpected error occurred', 'error');
  e.preventDefault();
});

// ========================================
// ACCESSIBILITY ENHANCEMENTS
// ========================================

/**
 * Announce screen reader messages
 * @param {string} message - Message to announce
 */
function announceToScreenReader(message) {
  const announcement = document.createElement('div');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;
  
  document.body.appendChild(announcement);
  
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

// ========================================
// PERFORMANCE MONITORING
// ========================================

if (config.DEBUG) {
  // Monitor performance in development
  let renderCount = 0;
  const originalUpdateMapMarkers = updateMapMarkers;
  
  updateMapMarkers = function() {
    const start = performance.now();
    originalUpdateMapMarkers();
    const end = performance.now();
    renderCount++;
    console.log(`🎯 Map render #${renderCount}: ${(end - start).toFixed(2)}ms`);
  };
}

const t2 = performance.now();

console.log("time to load script = " , t2-t1 ) ;

console.log('✅ Bhakti Tradition Map script loaded successfully');
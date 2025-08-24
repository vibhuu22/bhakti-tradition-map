/**
 * BHAKTI TRADITION MAP - MAIN APPLICATION SCRIPT
 * 
 * This is the main client-side JavaScript file for the Bhakti Tradition Map.
 * It handles map initialization, user interactions, API communication,
 * filtering, heatmaps, and the contribution system.
 * 
 * FEATURES:
 * - Interactive Leaflet map with clustering and heatmaps
 * - Advanced filtering system with real-time updates
 * - Place suggestions with autocomplete functionality
 * - Contribution form with validation and auto-geocoding
 * - Theme switching (light/dark/auto)
 * - Toast notifications for user feedback
 * - Responsive design for mobile devices
 * - Accessibility considerations
 * 
 * DEPENDENCIES:
 * - Leaflet.js: Interactive maps
 * - Leaflet.markercluster: Marker clustering
 * - Leaflet.heat: Heatmap functionality
 * - config.js: API configuration
 */

// ========================================
// CONFIGURATION AND IMPORTS
// ========================================

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
let heatmapLayer = null;
let currentHeatmapType = 'none';

// Data and filtering state
let allTraditions = [];
let filteredTraditions = [];
let currentFilters = {};
let selectedPlaceType = 'all';
let filterOptions = {};

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
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  };
  
  // Remove existing tile layers
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      map.removeLayer(layer);
    }
  });
  
  // Add new tile layer
  // L.tileLayer(tileUrls[theme], {
  //   maxZoom: MAP_CONFIG.MAX_ZOOM,
  //   attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
  // }).addTo(map);

  L.tileLayer('https://tile.openstreetmap.in/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap India contributors'
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
  
  // Heatmap toggle button
  const btnHeatmap = document.getElementById('btn-heatmap');
  if (btnHeatmap) {
    btnHeatmap.addEventListener('click', toggleHeatmap);
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
  
  // Apply filters button
  const applyFilters = document.getElementById('apply-filters');
  if (applyFilters) {
    applyFilters.addEventListener('click', applyCurrentFilters);
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
    search: document.getElementById('search-input')?.value || ''
  };
  
  // Remove empty values
  currentFilters = Object.fromEntries(
    Object.entries(filterInputs).filter(([_, value]) => value !== '')
  );
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
    
    // Fetch filtered data
    const response = await fetch(`${API_BASE}/traditions?${params}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    filteredTraditions = await response.json();
    
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
 */
function updateMapMarkers() {
  // Clear existing markers
  clusterGroup.clearLayers();
  
  // Add new markers
  filteredTraditions.forEach(tradition => {
    const marker = createMarker(tradition);
    if (marker) {
      clusterGroup.addLayer(marker);
    }
  });
  
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
    birth: 'child_care',
    enlightenment: 'wb_sunny',
    samadhi: 'spa',
    temple: 'account_balance',
    influence: 'public'
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
        ${tradition.traditionType ? `
        <div class="popup-field">
          <span class="material-icons">category</span>
          <div>
            <strong>Type:</strong> ${tradition.traditionType}
          </div>
        </div>
        ` : ''}
        ${tradition.period ? `
        <div class="popup-field">
          <span class="material-icons">schedule</span>
          <div>
            <strong>Period:</strong> ${tradition.period}
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
// HEATMAP FUNCTIONALITY
// ========================================

/**
 * Toggle heatmap display
 */
function toggleHeatmap() {
  if (currentHeatmapType === 'none') {
    showHeatmap();
  } else {
    hideHeatmap();
  }
}

/**
 * Show heatmap layer
 */
function showHeatmap() {
  if (!FEATURES.HEATMAP_ENABLED) {
    showToast('Heatmap feature is not enabled', 'warning');
    return;
  }
  
  // Prepare heatmap data
  const heatData = filteredTraditions
    .filter(tradition => tradition.coords && tradition.coords.length === 2)
    .map(tradition => [tradition.coords[0], tradition.coords[1], 1]);
  
  if (heatData.length === 0) {
    showToast('No data available for heatmap', 'warning');
    return;
  }
  
  // Create heatmap layer
  heatmapLayer = L.heatLayer(heatData, {
    radius: 25,
    blur: 15,
    maxZoom: 10,
    gradient: {
      0.0: 'blue',
      0.2: 'cyan', 
      0.4: 'lime',
      0.6: 'yellow',
      0.8: 'orange',
      1.0: 'red'
    }
  });
  
  map.addLayer(heatmapLayer);
  currentHeatmapType = 'density';
  
  // Show heatmap legend
  const heatmapLegend = document.getElementById('heatmap-legend');
  if (heatmapLegend) {
    heatmapLegend.classList.remove('hidden');
  }
  
  // Update button state
  const btnHeatmap = document.getElementById('btn-heatmap');
  if (btnHeatmap) {
    btnHeatmap.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
  }
  
  showToast('Heatmap activated', 'success');
}

/**
 * Hide heatmap layer
 */
function hideHeatmap() {
  if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }
  
  currentHeatmapType = 'none';
  
  // Hide heatmap legend
  const heatmapLegend = document.getElementById('heatmap-legend');
  if (heatmapLegend) {
    heatmapLegend.classList.add('hidden');
  }
  
  // Reset button state
  const btnHeatmap = document.getElementById('btn-heatmap');
  if (btnHeatmap) {
    btnHeatmap.style.backgroundColor = '';
  }
  
  showToast('Heatmap deactivated', 'info');
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
      period: formData.get('period'),
      traditionType: formData.get('traditionType'),
      gender: formData.get('gender'),
      language: formData.get('language'),
      school: formData.get('school'),
      presidingDeity: formData.get('presidingDeity'),
      sufi: formData.has('sufi'),
      texts: formData.get('texts')?.split(',').map(t => t.trim()).filter(Boolean) || [],
      philosophy: formData.get('philosophy'),
      places: {
        birth: processPlaceInput(formData.get('birthPlace')),
        enlightenment: processPlaceInput(formData.get('enlightenmentPlace')),
        samadhi: processPlaceInput(formData.get('samadhiPlace')),
        temple: processPlaceArrayInput(formData.get('templePlaces')),
        influence: processPlaceArrayInput(formData.get('influenceAreas'))
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

/**
 * Process multiple place inputs (comma-separated)
 * @param {string} input - Places input string
 * @returns {Array|null} Array of processed place objects
 */
function processPlaceArrayInput(input) {
  if (!input || !input.trim()) return null;
  
  return input.split(',')
    .map(place => place.trim())
    .filter(Boolean)
    .map(name => ({
      name,
      coords: null,
      region: null
    }));
}

// ========================================
// PLACE SUGGESTIONS SYSTEM
// ========================================

/**
 * Setup place suggestion functionality
 */
function setupPlaceSuggestions() {
  const suggestionInputs = [
    'birth-place',
    'enlightenment-place',
    'samadhi-place',
    'temple-places',
    'influence-areas'
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
    // Check cache first
    if (suggestionCache.has(query)) {
      displaySuggestions(suggestionCache.get(query), suggestionsList, input);
      return;
    }
    
    const response = await fetch(`${API_BASE}/suggest-places/${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const suggestions = await response.json();
    
    // Cache results
    suggestionCache.set(query, suggestions);
    
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
    birth: 0,
    enlightenment: 0,
    samadhi: 0,
    temple: 0,
    influence: 0
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

console.log('✅ Bhakti Tradition Map script loaded successfully');

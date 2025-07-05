

/*
              _                             _               _     __   __
         /\  | |                           | |             (_)    \ \ / /
        /  \ | |_ _ __ ___   ___  ___ _ __ | |__   ___ _ __ _  ___ \ V / 
       / /\ \| __| '_ ` _ \ / _ \/ __| '_ \| '_ \ / _ \ '__| |/ __| > <  
      / ____ \ |_| | | | | | (_) \__ \ |_) | | | |  __/ |  | | (__ / . \ 
     /_/    \_\__|_| |_| |_|\___/|___/ .__/|_| |_|\___|_|  |_|\___/_/ \_\
                                     | |                                 
                                     |_|                                                                                                                
    Written by: k3yomi@GitHub
    Version: v7.0.0                              
*/

/**
  * @class Mapbox
  * @description Handles the creation and management of a Mapbox map, layers, stations, spotter points, and storm reports. 
  * This class integrates with Mapbox's API to render and update geographical data points, polygons, and markers.
  * 
  * The class also manages map-related UI elements and configurations for rendering radar stations, spotters, and alerts.
  */

class Mapbox {
    constructor(library, autoFly, alert_class) {
	this.library = library;
	this.storage = this.library.storage;
	this.auto = autoFly;
	this.alerts = alert_class;
	this.name = `MapboxClass`;

	this.manualFlyLock = false;
	this.manualFlyCooldown = 30000; // Set default value first
	this.lastRadarUpdate = 0;
	this.radarUpdateInterval = 5 * 60 * 1000;

	this.library.createOutput(`${this.name} Initialization`, `Successfully initialized ${this.name} module`);
	this.createMapBoxSession();

	// ✅ Delay cooldown setup until storage is ready
	setTimeout(() => {
		try {
			const duration = this.storage?.configurations?.widget_settings?.alert?.duration;
			if (typeof duration === 'number' && duration > 0) {
				this.manualFlyCooldown = (duration - 0.8) * 1000;
				this.library.createOutput(this.name, `manualFlyCooldown set to ${this.manualFlyCooldown}ms from config`);
			} else {
				this.library.createOutput(this.name, `Alert duration not found — using default manualFlyCooldown of 30000ms`);
			}
		} catch (err) {
			console.error(`[${this.name}] Error setting manualFlyCooldown:`, err);
		}
	}, 800); // Delay allows time for configurations to be loaded

    document.addEventListener('onCacheUpdate', async () => {
        this.alerts.syncAlerts();
        this.displayRadar();

        // Priority: zoom to new alerts
        if (!this.manualFlyLock) {
            this.flyToNewlyIssuedAlert();
        }

        // Fallback: if auto is on and no new alerts
        if (this.auto && !this.manualFlyLock) {
            this.syncToRandomAlert();
        }

        this.updateThread();
    });

}

    /**
      * @function createMapBoxSession
      * @description Creates a new Mapbox session and initializes the map with the given widget settings. 
      * If the map style isn't loaded, it waits for it to load before adding layers.
      * 
      * @async
      */   

    createMapBoxSession = async function() {
        if (!this.storage.mapbox) { 
            this.storage.mapbox = new mapboxgl.Map({
                ...this.storage.configurations.widget_settings.mapbox.settings,
                accessToken: this.storage.configurations.widget_settings.mapbox.api_key
            })
            this.storage.mapbox.on(`load`, async () => { })
        }
    }

    /**
      * @function createPolygonSource
      * @description Creates a polygon source and layer on the Mapbox map.
      * 
      * @param {Array} polygonPlots - An array of polygon objects containing coordinates, color, and description.
      * @param {string} targetedSource - The ID of the source to be created or updated.
      * @param {string} targetedLayer - The ID of the layer to be created or updated.
      */

    createPolygonSource = function(polygonPlots, targetedSource=`mapbox-gl-example-polygon-source`, targetedLayer=`mapbox-gl-example-polygon-layer`) {
        let GeoJSON = [];
        for (let i = 0; i < polygonPlots.length; i++) {
            let polygon = polygonPlots[i];
            GeoJSON.push({
                type: `Feature`,
                geometry: {
                    type: `Polygon`,
                    coordinates: [polygon.coordinates]
                },
                properties: {
                    color: polygon.color,
                    description: polygon.description ? polygon.description : ``,
                }
            });
        }
        let getSource = this.storage.mapbox.getSource(targetedSource)
        if (!getSource) {
            this.storage.mapbox.addSource(targetedSource, {type: `geojson`,data: { type: `FeatureCollection`, features: GeoJSON }});
        } else { 
            getSource.setData({type: `FeatureCollection`,features: GeoJSON});
        }
        if (!this.storage.mapbox.getLayer(targetedLayer)) {
            this.storage.mapbox.addLayer({id: targetedLayer,type: `line`,source: targetedSource,paint: {'line-color': ['get', 'color'],'line-width': 3}});  
        }
        //this.storage.mapbox.on('click', targetedLayer, (e) => {
        //    let coordinates = e.features[0].geometry.coordinates[0][0].slice();
        //    let description = e.features[0].properties.description;
        //    if (description === ``) {description = `No description provided`}
        //    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360}
        //    if (this.currentPopup) {this.currentPopup.remove();}      
        //    this.currentPopup = new mapboxgl.Popup({ className: 'widgets-custom-popup' }).setLngLat(coordinates).setHTML(`<div>${description}</div>`).addTo(this.storage.mapbox);
        //});
        //this.storage.mapbox.on('mouseenter', targetedLayer, () => {
        //    this.storage.mapbox.getCanvas().style.cursor = 'pointer';
        //});
        //this.storage.mapbox.on('mouseleave', targetedLayer, () => {
        //    this.storage.mapbox.getCanvas().style.cursor = '';
        //});
    }


    /**
      * @function createDotSource
      * @description Creates a dot source and layer on the Mapbox map.
      * 
      * @param {Array} dotPlots - An array of dot objects containing latitude, longitude, color, description, and autoZoom.
      * @param {string} targetedSource - The ID of the source to be created or updated.
      * @param {string} targetedLayer - The ID of the layer to be created or updated.
      */

    createDotSource = function(dotPlots, targetedSource=`mapbox-gl-example-dot-source`, targetedLayer=`mapbox-gl-example-dot-layer`) {
        let GeoJSON = [];
        for (let i = 0; i < dotPlots.length; i++) {
            let dot = dotPlots[i];
            GeoJSON.push({
                type: `Feature`,
                geometry: {
                    type: `Point`,
                    coordinates: [dot.longitude, dot.latitude],
                },
                properties: {
                    color: dot.color,
                    description: dot.description ? dot.description : `No description provided`,
                    size: dot.size ? dot.size : 4,
                }
            });
        }
        let getSource = this.storage.mapbox.getSource(targetedSource)
        if (!getSource) {
            this.storage.mapbox.addSource(targetedSource, {type: `geojson`,data: { type: `FeatureCollection`, features: []}});
        } else { 
            getSource.setData({type: `FeatureCollection`,features: GeoJSON});
        }
        if (!this.storage.mapbox.getLayer(targetedLayer)) {
            this.storage.mapbox.addLayer({id: targetedLayer,type: `circle`,source: targetedSource,paint: { 'circle-radius': ['get', 'size'], 'circle-color': ['get', 'color'], 'circle-opacity': 0.8, 'circle-stroke-width': 1, 'circle-stroke-color': `rgb(255, 255, 255)`,},filter: ['!=', ['get', 'description'], ``]});
        }

        //this.storage.mapbox.on('click', targetedLayer, (e) => {
        //    let coordinates = e.features[0].geometry.coordinates.slice();
        //    let description = e.features[0].properties.description;
        //    if (description === ``) {description = `No description provided`}
        //    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360}
        //    if (this.currentPopup) {this.currentPopup.remove();}          
        //    this.currentPopup = new mapboxgl.Popup({ className: 'widgets-custom-popup' }).setLngLat(coordinates).setHTML(`<div>${description}</div>`).addTo(this.storage.mapbox);
        //});
//
        //this.storage.mapbox.on('mouseenter', targetedLayer, () => {
        //    this.storage.mapbox.getCanvas().style.cursor = 'pointer';
        //});
//
        //this.storage.mapbox.on('mouseleave', targetedLayer, () => {
        //    this.storage.mapbox.getCanvas().style.cursor = '';
        //});  
    }  

    /**
      * @function displayReports
      * @description Displays storm reports on the Mapbox map by creating a dot source and layer.
      */

    displayReports = function() {
        let reports = this.storage.reports
        let reportPlots = []
        for (let i = 0; i < reports.length; i++) {
            let report = reports[i]
            reportPlots.push({
                latitude: report.latitude,
                longitude: report.longitude,
                color: `rgb(255, 255, 255)`,
                description: `Event: ${report.event}<br>Description: ${report.description}<br>Sender: ${report.sender}`,
            })
        }
        this.createDotSource(reportPlots, `storm-reports-source`, `storm-reports-layer`)
    }

    /**
      * @function displaySpotters
      * @description Displays spotters on the Mapbox map by creating a dot source and layer.
      */
loadSpotterReports = async function () {
    try {
        const endpoint = this.storage.configurations.widget_settings.spotter_network_reports.endpoint;
        const response = await fetch(endpoint);
        const text = await response.text();

        const lines = text.trim().split('\n');
        const parsedReports = [];

        for (let line of lines) {
            const [latitude, longitude, timestamp, event, description, sender] = line.split('|');
            if (!latitude || !longitude) continue;

            parsedReports.push({
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                timestamp,
                event,
                description,
                sender,
            });
        }

        this.storage.reports = parsedReports;
        console.log(`[SpotterReports] Loaded ${parsedReports.length} reports`);

    } catch (error) {
        console.error('[SpotterReports] Failed to fetch reports:', error);
        this.storage.reports = [];
    }
}

    displaySpotters = function() {
        let spotters = this.storage.spotters
        let spotterPlots = []
        let scheme = this.storage.configurations.widget_settings.mapbox.spotter_network_settings.spotter_scheme
        for (let i = 0; i < spotters.length; i++) {
            let spotter = spotters[i]
            let selectedColor = scheme.default.color
            if (spotter.idle == 1) { selectedColor = scheme.idle.color }
            if (spotter.active == 1) { selectedColor = scheme.active.color }
            if (spotter.streaming == 1) { selectedColor = scheme.streaming.color }
            let description = spotter.description.toString().replace(/\\n/g, '<br>').replace('"', '')
            spotterPlots.push({
                latitude: spotter.lat,
                longitude: spotter.lon,
                color: selectedColor,
                description: `${description}`,
            })
        }
        this.createDotSource(spotterPlots, `spotter-network-source`, `spotter-network-layer`)
    }

    /**
      * @function displayAlerts
      * @description Displays alerts on the Mapbox map by creating a polygon source and layer.
      */

displayAlerts = function () {
    let alerts = this.storage.active;
    let alertPlots = [];
    let scheme = this.storage.configurations.scheme;

    alerts.sort((a, b) => new Date(b.details.issued) - new Date(a.details.issued));

    let now = Date.now();
    let mostRecentAlert = null;
    let mostRecentTime = 0;

    for (let i = 0; i < alerts.length; i++) {
        let alert = alerts[i];
        if (!alert.raw.geometry || !alert.raw.geometry.coordinates?.[0]?.[0]) continue;

        const issuedTimestamp = new Date(alert.details.issued).getTime();
        if (issuedTimestamp > mostRecentTime) {
            mostRecentAlert = alert;
            mostRecentTime = issuedTimestamp;
        }

        let coords = alert.raw.geometry.coordinates[0].map(point => [point[0], point[1]]);
        let eventColor = scheme.find(color => alert.details.name.toLowerCase().includes(color.type.toLowerCase())) || scheme.find(color => color.type === "Default");
        let issued = new Date(alert.details.issued).toLocaleString();
        let expires = new Date(alert.details.expires).toLocaleString();
        let tags = alert.details.tag == undefined ? `No tags found` : alert.details.tag;
        tags = JSON.stringify(tags).replace(/\"/g, ``).replace(/,/g, `, `).replace(/\[/g, ``).replace(/\]/g, ``);

        let description = `<b>${alert.details.name} (${alert.details.type})</b><br>${alert.details.locations}<br><br><b>Sender:</b> ${alert.details.sender}<br><b>Issued:</b> ${issued}<br><b>Expires:</b> ${expires}<br>Tags: ${tags}`;

        alertPlots.push({
            issued: issued,
            coordinates: coords,
            color: eventColor.color.light,
            description: description
        });
    }

    // 🔽 ADD THIS BLOCK HERE
		if (alertPlots.length === 0) {
		// Remove existing polygon layer if it exists
		if (this.storage.mapbox.getLayer('alert-polygons-layer')) {
			this.storage.mapbox.removeLayer('alert-polygons-layer');
		}
		// Remove existing polygon source if it exists
		if (this.storage.mapbox.getSource('alert-polygons-source')) {
			this.storage.mapbox.removeSource('alert-polygons-source');
		}

		// Zoom back to default location
		const defaultSettings = this.storage.configurations.widget_settings.mapbox.settings;
		this.storage.mapbox.flyTo({
			center: defaultSettings.center,
			zoom: defaultSettings.zoom,
			speed: 0.6,
			pitch: 55
		});

		return;
	}


    const isNewAlert = mostRecentAlert && (now - new Date(mostRecentAlert.details.issued).getTime() < this.manualFlyCooldown);

    if (isNewAlert && !this.manualFlyLock) {
        this.manualFlyLock = true;
        const newCoords = mostRecentAlert.raw.geometry.coordinates[0][0];

        this.storage.mapbox.flyTo({
            center: newCoords,
            zoom: 8,
            speed: 1.4,
            pitch: 55
        });

        setTimeout(() => {
            this.manualFlyLock = false;
            if (this.auto) this.syncToRandomAlert();
        }, this.manualFlyCooldown);
    }

    if (!isNewAlert && this.auto && !this.manualFlyLock && this.storage.random?.raw?.geometry?.coordinates?.[0]?.[0] && this.storage.realtime.length === 0) {
        const randomCoords = this.storage.random.raw.geometry.coordinates[0][0];
        this.storage.mapbox.flyTo({
            center: randomCoords,
            zoom: 8,
            speed: 1.4,
            pitch: 55
        });
    }

    this.createPolygonSource(alertPlots, `alert-polygons-source`, `alert-polygons-layer`);
};

    /**
      * @function realTimeIRL
      * @description Displays the user's current location on the Mapbox map by creating a dot source and layer.
      */
 
    realTimeIRL = async function() {
        if (Object.keys(this.storage.realtime).length > 0) {
            let latitude = this.storage.realtime.lat
            let longitude = this.storage.realtime.lon
            let location = this.storage.realtime.county + `, ` + this.storage.realtime.state
            let color = `rgb(255, 0, 191)`
            let description = `You are here!`
            let dotPlots = [{ latitude: latitude, longitude: longitude, color: color, description: location, size: 10}]
            this.storage.mapbox.flyTo({center: [longitude, latitude], zoom: 9, speed: 0.8, pitch: 1});
            this.createDotSource(dotPlots, `realtimeirl-source`, `realtimeirl-layer`)
        }
    }

displayRadar = async function () {
    const now = Date.now();
    if (!this.lastRadarUpdate) this.lastRadarUpdate = 0;
    if (!this.radarUpdateInterval) this.radarUpdateInterval = 5 * 60 * 1000; // 5 minutes

    if (now - this.lastRadarUpdate < this.radarUpdateInterval) {
        return; // Skip update if cooldown hasn't expired
    
      displayRadar = async function () {
        try {
            let response = await this.library.createHttpRequest('https://api.rainviewer.com/public/weather-maps.json');
            let data = await response.json();
            let latestRadar = data.radar.past.at(-1);
            if (!latestRadar || !latestRadar.time) return;
            let radarSourceId = 'radar-source';
            let radarLayerId = 'radar-layer';
            let radarTiles = [`https://tilecache.rainviewer.com/v2/radar/${latestRadar.time}/512/{z}/{x}/{y}/6/0_0.png`];
            if (this.storage.mapbox.getSource(radarSourceId)) {
                this.storage.mapbox.getSource(radarSourceId).setTiles(radarTiles);
            } else {
                this.storage.mapbox.addSource(radarSourceId, {
                    type: 'raster',
                    tiles: radarTiles,
                    tileSize: 256
                });
            }
            if (!this.storage.mapbox.getLayer(radarLayerId)) {
                this.storage.mapbox.addLayer({
                    id: radarLayerId,
                    type: 'raster',
                    source: radarSourceId,
                    paint: { 'raster-opacity': 0.5 }
                });
            }
        } catch (err) {}

    }

    this.lastRadarUpdate = now;

    try {
        const response = await this.library.createHttpRequest('https://api.rainviewer.com/public/weather-maps.json');
        const data = await response.json();
        const latestRadar = data.radar.past.at(-1);
        if (!latestRadar || !latestRadar.time) return;

        const radarUrl = `https://tilecache.rainviewer.com/v2/radar/${latestRadar.time}/512/{z}/{x}/{y}/6/0_0.png`;

        if (!this.storage.mapbox.getSource('radar-source')) {
            this.storage.mapbox.addSource('radar-source', {
                type: 'raster',
                tiles: [radarUrl],
                tileSize: 256
            });
        } else {
            this.storage.mapbox.getSource('radar-source').setTiles([radarUrl]);
        }

        if (!this.storage.mapbox.getLayer('radar-layer')) {
            this.storage.mapbox.addLayer({
                id: 'radar-layer',
                type: 'raster',
                source: 'radar-source',
                paint: { 'raster-opacity': 0.5 }
            }, 'settlement-subdivision-label');
        }

    } catch (err) {
        console.error('Radar fetch failed:', err);
    }
}


	syncToRandomAlert = function () {
		if (!this.auto) return;
		if (!this.storage.random || !this.storage.random.raw || !this.storage.random.raw.geometry) return;

		const coords = this.storage.random.raw.geometry.coordinates?.[0]?.[0];
		if (!coords || coords.length !== 2) return;

		this.storage.mapbox.flyTo({
			center: coords,
			zoom: 8,
			speed: 1.5,
			pitch: 55
		});
}

flyToNewlyIssuedAlert = function () {
    let alerts = this.storage.active;
    if (!alerts || alerts.length === 0) return;

    alerts.sort((a, b) => new Date(b.details.issued) - new Date(a.details.issued));
    const newest = alerts[0];
    const issuedTimestamp = new Date(newest.details.issued).getTime();
    const now = Date.now();
    const isNew = (now - issuedTimestamp) < this.manualFlyCooldown;

    if (
        isNew &&
        newest.raw?.geometry?.coordinates?.[0]?.[0] &&
        !this.manualFlyLock
    ) {
        const [lng, lat] = newest.raw.geometry.coordinates[0][0];
        this.manualFlyLock = true;

        this.storage.mapbox.flyTo({
            center: [lng, lat],
            zoom: 8,
            speed: 1.4,
            pitch: 55,
        });

        setTimeout(() => {
            this.manualFlyLock = false;
        }, this.manualFlyCooldown);
    }
};


    updateThread = function() {
        if (!this.storage.mapbox.isStyleLoaded()) { setTimeout(() => { this.updateThread() }, 1000); return; }
        this.displayReports()
        this.displaySpotters()
        this.displayAlerts()
        this.realTimeIRL()
        this.displayRadar()
    }
}

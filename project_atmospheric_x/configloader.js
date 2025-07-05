const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../configurations.json');

function loadConfig() {
    try {
        const configRaw = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configRaw);
    } catch (err) {
        console.error('[ConfigLoader] Failed to load configurations:', err.message);
        return null;
    }
}

module.exports = { loadConfig };

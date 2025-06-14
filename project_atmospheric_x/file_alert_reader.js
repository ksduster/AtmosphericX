const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class FileAlertReader extends EventEmitter {
    constructor(alertFolder, loader) {
        super();
        this.alertFolder = alertFolder;
        this.loader = loader;

        console.log(`[FileReader] Watching for new .txt files in: ${this.alertFolder}`);

        // Watch for new .txt files added to the folder
        fs.watch(this.alertFolder, (eventType, filename) => {
            if (eventType === "rename" && filename.endsWith(".txt")) {
                console.log(`[FileReader] Detected new file: ${filename}`);
                this.readFile(filename);
            }
        });
    }

    readFile(filename) {
        const fullPath = path.join(this.alertFolder, filename);
        fs.readFile(fullPath, 'utf8', (err, data) => {
            if (err) {
                console.error(`[FileReader] Failed to read ${filename}:`, err.message);
                return;
            }

            console.log(`[FileReader] Processing alert file: ${filename}`);

            // Fake stanza object to simulate an incoming NWWS-OI message
            const fakeStanza = {
                getChild: () => null,
                getText: () => data,
                attrs: { from: "localfile@alerts" },
                is: () => true
            };

            try {
                const metadata = this.loader.modules.product.compileMessage(fakeStanza);

                // Log metadata or type of alert (optional debug)
                if (metadata && !metadata.ignore) {
                    console.log(`[FileReader] Alert metadata parsed: ${metadata.event || 'Unknown Event'}`);
                    this.emit("message", { message: data });
                } else {
                    console.log(`[FileReader] Alert ignored or invalid`);
                }
            } catch (err) {
                console.error(`[FileReader] Error compiling message from ${filename}:`, err.message);
            }
        });
    }
}

module.exports = FileAlertReader;

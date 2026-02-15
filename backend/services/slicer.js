// backend/services/slicer.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function sliceImage(filePath, outputDir, fileId) {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    // We want a 3x3 grid
    const columns = 3;
    const rows = 3;
    const tileWidth = Math.floor(metadata.width / columns);
    const tileHeight = Math.floor(metadata.height / rows);

    let tiles = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
            const outputName = `${fileId}_tile_${r}_${c}.jpg`;
            const outputPath = path.join(outputDir, outputName);

            await image
                .extract({ 
                    left: c * tileWidth, 
                    top: r * tileHeight, 
                    width: tileWidth, 
                    height: tileHeight 
                })
                .toFile(outputPath);

            tiles.push({
                row: r,
                col: c,
                url: `/api/tiles/${outputName}` // We will sign this URL later
            });
        }
    }
    return { width: metadata.width, height: metadata.height, tiles };
}

module.exports = { sliceImage };

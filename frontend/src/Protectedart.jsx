// frontend/src/components/ProtectedArt.jsx
import React, { useEffect, useRef } from 'react';

const ProtectedArt = ({ artData }) => {
    // artData contains: { width, height, tiles: [{ url, row, col }] }
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        // 1. Set Canvas to full image size
        canvas.width = artData.width;
        canvas.height = artData.height;

        // 2. Load and stitch tiles back together
        artData.tiles.forEach((tile) => {
            const img = new Image();
            // Assuming 3x3 grid, calculate tile size
            const tileW = artData.width / 3;
            const tileH = artData.height / 3;

            img.src = tile.url; // This is the SIGNED url
            img.onload = () => {
                ctx.drawImage(
                    img, 
                    tile.col * tileW, 
                    tile.row * tileH, 
                    tileW, 
                    tileH
                );
            };
        });
    }, [artData]);

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            
            {/* LAYER 1: The Canvas (Visuals) */}
            {/* We disable context menu to annoy basic users */}
            <canvas 
                ref={canvasRef} 
                onContextMenu={(e) => e.preventDefault()}
                style={{ pointerEvents: 'none' }} // Prevents interaction directly with canvas
            />

            {/* LAYER 2: The Invisible Trap (The Spike Strip) */}
            {/* This sits ON TOP of the canvas. If they try to drag or save, they grab this. */}
            <div 
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 10,
                    backgroundImage: 'url(/empty-pixel.png)', // Transparent 1x1 pixel
                    cursor: 'default'
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    alert("This artwork is protected by Loom protocols.");
                }}
            />
            
        </div>
    );
};

export default ProtectedArt;
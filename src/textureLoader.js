import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();

export function loadTexture(path) {
    const texture = textureLoader.load(path);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

// Load all textures
export function loadArenaTextures() {
    // Load the concrete texture once
    const concreteTexture = loadTexture('./textures/concrete356.png');
    
    // Create copies for each surface
    const groundTexture = concreteTexture.clone();
    const wallTexture = concreteTexture.clone();
    const ceilingTexture = concreteTexture.clone();

    // Set texture repeat for proper scaling
    groundTexture.repeat.set(4, 4);
    wallTexture.repeat.set(2, 1);
    ceilingTexture.repeat.set(4, 4);

    return {
        ground: groundTexture,
        wall: wallTexture,
        ceiling: ceilingTexture
    };
}

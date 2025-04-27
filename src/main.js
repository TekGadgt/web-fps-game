import * as THREE from 'three';
import { loadArenaTextures } from './textureLoader.js';

// WebSocket Configuration
console.log('Using WebSocket URL:', import.meta.env.WS_URL);

// Local Storage Keys
const STORAGE_KEY = 'fps_game_player_id';
const COLOR_KEY = 'fps_game_player_color';

// Debug Overlay Management
let coordsDisplay;
let playerCountDisplay;
let playerListDisplay;

// Player ID Modal Management
let playerIdModal;
let playerIdInput;
let playerIdSubmit;
let playerColorInput;

// Store chosen color in memory for use in model/projectile creation
let playerColor = '#2244aa'; // Default color

document.addEventListener('DOMContentLoaded', () => {
    // Initialize debug overlay elements
    coordsDisplay = document.getElementById('coords');
    playerCountDisplay = document.getElementById('player-count');
    playerListDisplay = document.getElementById('player-list');

    // Initialize player ID modal elements
    playerIdModal = document.getElementById('player-id-modal');
    playerIdInput = document.getElementById('player-id-input');
    playerIdSubmit = document.getElementById('player-id-submit');

    // Add color picker if not present
    if (!document.getElementById('player-color-input')) {
        const colorLabel = document.createElement('label');
        colorLabel.textContent = 'Choose Color:';
        colorLabel.style.display = 'block';
        colorLabel.style.marginTop = '10px';
        playerColorInput = document.createElement('input');
        playerColorInput.type = 'color';
        playerColorInput.id = 'player-color-input';
        playerColorInput.style.margin = '10px auto';
        playerColorInput.style.display = 'block';
        // Default color or stored color
        const storedColor = localStorage.getItem(COLOR_KEY) || '#2244aa';
        playerColorInput.value = storedColor;
        colorLabel.appendChild(playerColorInput);
        playerIdModal.querySelector('.modal-content').appendChild(colorLabel);
    } else {
        playerColorInput = document.getElementById('player-color-input');
    }

    // Load stored color
    const storedColor = localStorage.getItem(COLOR_KEY);
    if (storedColor) {
        playerColor = storedColor;
        playerColorInput.value = storedColor;
    }

    // Show/hide modal helpers that also unset pointer lock
    function showPlayerIdModal() {
        playerIdModal.style.display = 'block';
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
    function hidePlayerIdModal() {
        playerIdModal.style.display = 'none';
    }

    // Check for stored player ID
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (storedId) {
        playerIdInput.value = storedId;
        playerColor = playerColorInput.value;
        connectToServerWithId(storedId, playerColor);
        hidePlayerIdModal();
    } else {
        // Generate a random ID suggestion
        const suggestedId = 'player-' + Math.random().toString(36).substr(2, 5);
        playerIdInput.value = suggestedId;
        showPlayerIdModal();
    }

    // Handle player ID submission
    playerIdSubmit.addEventListener('click', () => {
        const requestedId = playerIdInput.value.trim();
        const chosenColor = playerColorInput.value;
        if (requestedId) {
            console.log('Setting player ID to:', requestedId);
            localStorage.setItem(STORAGE_KEY, requestedId);
            localStorage.setItem(COLOR_KEY, chosenColor);
            playerColor = chosenColor;
            connectToServerWithId(requestedId, chosenColor);
            hidePlayerIdModal();
        } else {
            alert('Please enter a valid player ID');
        }
    });

    // Also handle Enter key
    playerIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            playerIdSubmit.click();
        }
    });

    // Update color in memory and localStorage on change
    playerColorInput.addEventListener('input', (e) => {
        playerColor = e.target.value;
        localStorage.setItem(COLOR_KEY, playerColor);
    });

    // Add logout button functionality
    const logoutButton = document.createElement('button');
    logoutButton.textContent = 'Change Player ID';
    logoutButton.style.position = 'absolute';
    logoutButton.style.bottom = '20px';
    logoutButton.style.left = '20px';
    logoutButton.style.padding = '10px';
    logoutButton.style.backgroundColor = '#444';
    logoutButton.style.color = 'white';
    logoutButton.style.border = 'none';
    logoutButton.style.borderRadius = '5px';
    logoutButton.style.cursor = 'pointer';
    logoutButton.addEventListener('click', () => {
        logout();
        showPlayerIdModal();
    });
    document.body.appendChild(logoutButton);

    // Prevent pointer lock when clicking inside the modal (including color picker)
    playerIdModal.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
});

// Prevent default behavior for Ctrl+W, Ctrl+D, Ctrl+S, and Ctrl+A to avoid unintended actions
window.addEventListener('keydown', (event) => {
    if (event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === 'w' || key === 'd' || key === 's' || key === 'a') {
            event.preventDefault();
            console.log(`Ctrl+${key.toUpperCase()} pressed: Default behavior prevented.`);
        }
    }
});

function updateDebugOverlay() {
    // Update coordinates
    if (coordsDisplay && camera) {
        const pos = camera.position;
        coordsDisplay.textContent = `Position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`;
    }

    // Update player count
    if (playerCountDisplay) {
        const totalPlayers = otherPlayers.size + 1; // Add 1 for local player
        playerCountDisplay.textContent = `Players: ${totalPlayers}`;
    }

    // Update player list with scores
    if (playerListDisplay) {
        let playerList = 'Players Online:\n';
        
        // Create array of all players including local player
        const allPlayers = [...otherPlayers.entries()].map(([id, player]) => ({
            id,
            score: player.score,
            isLocal: false
        }));
        allPlayers.push({
            id: playerId,
            score: score,
            isLocal: true
        });
        
        // Sort by score (high to low)
        allPlayers.sort((a, b) => b.score - a.score);
        
        // Generate sorted list
        allPlayers.forEach(player => {
            playerList += player.isLocal ? 
                `- You (${player.id}): ${player.score} points\n` :
                `- ${player.id}: ${player.score} points\n`;
        });
        
        playerListDisplay.innerHTML = playerList.replace(/\n/g, '<br>');
    }
}

// Networking
let ws;
let playerId;
let otherPlayers = new Map();

// Track reconnection attempts
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Helper to convert #RRGGBB to 0xRRGGBB
function hexColorToInt(hexOrInt) {
    if (typeof hexOrInt === 'number') return hexOrInt;
    if (typeof hexOrInt === 'string') {
        if (hexOrInt.startsWith('#')) {
            return parseInt(hexOrInt.replace('#', '0x'));
        } else if (hexOrInt.startsWith('0x')) {
            return parseInt(hexOrInt);
        }
    }
    return 0xff0000; // fallback
}

// Modified connect function to handle custom IDs and color
function connectToServerWithId(requestedId, color) {
    if (ws) {
        ws.close();
        ws = null;
    }
    
    console.log('Connecting to WebSocket server at:', WS_URL);
    const colorToSend = color || playerColor;
    
    try {
        ws = new WebSocket(WS_URL);
        
        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
            if (ws.readyState !== 1) { // If not OPEN
                console.warn('WebSocket connection timeout');
                ws.close();
            }
        }, 10000);
        
        ws.onopen = () => {
            console.log('Connected to server, registering with ID:', requestedId);
            clearTimeout(connectionTimeout);
            reconnectAttempts = 0;
            
            // Register with the server
            ws.send(JSON.stringify({
                type: 'register',
                playerId: requestedId,
                color: colorToSend
            }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received message:', data.type);
                
                if (data.type === 'error') {
                    if (data.message.includes('already taken')) {
                        // Clear stored ID if it's no longer valid
                        localStorage.removeItem(STORAGE_KEY);
                    }
                    alert(data.message);
                    showPlayerIdModal();
                    return;
                }
                
                handleServerMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        ws.onclose = (event) => {
            console.log(`Disconnected from server: ${event.code} ${event.reason}`);
            clearTimeout(connectionTimeout);
            otherPlayers.clear();
            
            // Only attempt reconnect if we still have a valid stored ID
            const storedId = localStorage.getItem(STORAGE_KEY);
            if (storedId && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) with stored ID:`, storedId);
                
                // Exponential backoff for reconnection attempts
                const backoffDelay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000);
                
                console.log(`Reconnecting in ${backoffDelay/1000} seconds...`);
                setTimeout(() => connectToServerWithId(storedId, colorToSend), backoffDelay);
            } else {
                if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.error('Maximum reconnection attempts reached');
                }
                showPlayerIdModal();
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    } catch (e) {
        console.error('Failed to create WebSocket connection:', e);
        showPlayerIdModal();
    }
}

// Add a logout function (optional)
function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(COLOR_KEY);
    if (ws) {
        ws.close();
    }
}

// Ensure hits are ignored during respawn cooldown
function handleServerMessage(data) {
    switch(data.type) {
        case 'init':
            playerId = data.id;
            data.players.forEach(player => {
                if (player.id !== playerId) {
                    addOtherPlayer(player);
                }
            });
            break;

        case 'playerJoined':
            if (data.player.id !== playerId) {
                addOtherPlayer(data.player);
            }
            break;

        case 'playerLeft':
            removeOtherPlayer(data.id);
            break;

        case 'playerMoved':
            updateOtherPlayer(data);
            break;

        case 'playerShot':
            if (data.id !== playerId) {
                handleOtherPlayerShot(data);
            }
            break;

        case 'scoreUpdate':
            if (data.id === playerId && isRespawning) {
                console.log('Ignoring score update during respawn cooldown.');
                return; // Ignore score updates during respawn cooldown
            }
            updatePlayerScore(data);
            break;
    }
}

// Utility: Create a name label as a THREE.Sprite
function createNameLabel(name) {
    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = size / 4;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, size, size / 4);
    ctx.fillStyle = '#fff';
    ctx.fillText(name, size / 2, size / 8);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.5, 0.6, 1); // Adjust width/height as needed
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 999;
    return sprite;
}

function addOtherPlayer(playerData) {
    const color = playerData.color ? hexColorToInt(playerData.color) : 0xff4444;
    const playerModel = createCharacterModel(true, color);
    const playerGun = createGunModel();
    playerGun.scale.set(0.8, 0.8, 0.8);
    playerGun.position.set(0.45, -0.3, 0.3);
    playerGun.rotation.set(0, -Math.PI/2, 0);
    playerModel.add(playerGun);
    
    // Ensure position is a Vector3
    const position = Array.isArray(playerData.position) 
        ? new THREE.Vector3(...playerData.position)
        : new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
    
    playerModel.position.copy(position);
    scene.add(playerModel);
    
    // Initial visibility check
    const myArenaIndex = getCurrentArenaIndex();
    const theirArenaIndex = playerData.currentArenaIndex || 0;
    playerModel.visible = myArenaIndex === theirArenaIndex;
    
    // Debug logging
    console.log(`Adding new player ${playerData.id}:`, {
        position: position.toArray(),
        visible: playerModel.visible,
        myArena: myArenaIndex,
        theirArena: theirArenaIndex
    });

    // Add name label above head
    const nameLabel = createNameLabel(playerData.id);
    nameLabel.position.set(0, 1.2, 0); // Above head
    playerModel.add(nameLabel);
    playerModel.nameLabel = nameLabel;
    
    otherPlayers.set(playerData.id, {
        model: playerModel,
        score: playerData.score,
        lastUpdate: Date.now(),
        color: playerData.color || '#ff4444'
    });
}

function removeOtherPlayer(id) {
    const player = otherPlayers.get(id);
    if (player) {
        scene.remove(player.model);
        otherPlayers.delete(id);
    }
}

function updateOtherPlayer(data) {
    const player = otherPlayers.get(data.id);
    if (player) {
        // Store the last known position and timestamp for interpolation
        player.lastPosition = player.model.position.clone();
        // Handle both array and object formats for position
        if (Array.isArray(data.position)) {
            player.targetPosition = new THREE.Vector3(...data.position);
        } else if (typeof data.position === 'object' && data.position !== null) {
            player.targetPosition = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        }
        player.lastUpdateTime = Date.now();
        // Handle both array and object formats for rotation if needed
        if (Array.isArray(data.rotation)) {
            player.targetRotation = new THREE.Euler(...data.rotation);
        } else if (typeof data.rotation === 'object' && data.rotation !== null) {
            player.targetRotation = new THREE.Euler(data.rotation.x, data.rotation.y, data.rotation.z);
        }
        // Check if we're in the same arena
        const myArenaIndex = getCurrentArenaIndex();
        const theirArenaIndex = data.currentArenaIndex;
        player.isVisible = myArenaIndex === theirArenaIndex;
    }
}

function interpolateOtherPlayers(delta) {
    const now = Date.now();
    otherPlayers.forEach((player) => {
        if (!player.lastPosition || !player.targetPosition || !player.lastUpdateTime) return;

        // Calculate interpolation factor based on time elapsed
        const elapsed = now - player.lastUpdateTime;
        const interpolationFactor = Math.min(elapsed / 100, 1); // Interpolate over 100ms

        // Interpolate position and rotation
        player.model.position.lerpVectors(player.lastPosition, player.targetPosition, interpolationFactor);
        player.model.rotation.copy(player.targetRotation);

        // Update visibility
        player.model.visible = player.isVisible;

        // Make name label always face the camera
        if (player.model.nameLabel) {
            player.model.nameLabel.lookAt(camera.position);
        }
    });
}

function handleOtherPlayerShot(data) {
    const position = new THREE.Vector3().fromArray(data.position);
    const direction = new THREE.Vector3().fromArray(data.direction);
    createProjectile(position, direction, data.id, false, data.color); // Pass color as-is
}

function respawnPlayer() {
    // Pick random arena
    const randomArena = Math.floor(Math.random() * NUM_ARENAS);
    const arenaPosition = arenas[randomArena].position;
    
    // Random position within the chosen arena bounds (away from edges)
    const x = arenaPosition.x + (Math.random() - 0.5) * (ARENA_SIZE.width - 20);
    const z = arenaPosition.z + (Math.random() - 0.5) * (ARENA_SIZE.depth - 20);
    
    // Teleport player
    camera.position.set(x, player.height, z);
    
    // Reset vertical velocity to prevent falling after respawn
    player.verticalVelocity = 0;
    player.isGrounded = true;
    
    console.log(`Player respawned in arena ${randomArena} at position:`, camera.position.toArray());
    
    // Broadcast respawn position immediately to ensure other players see us
    sendPosition(true);
}

// Add a respawn cooldown to prevent multiple hits before teleport
let isRespawning = false;

function updatePlayerScore(data) {
    if (data.id === playerId) {
        if (data.respawn) {
            // Always teleport on respawn message
            respawnPlayer();
            if (!isRespawning) {
                console.log('Player hit! Starting respawn cooldown...');
                isRespawning = true;
                setTimeout(() => {
                    isRespawning = false;
                    console.log('Respawn cooldown ended.');
                }, 2000); // 2-second cooldown
            } else {
                console.log('Already respawning, but teleporting again to ensure player is moved.');
            }
        } else if (isRespawning) {
            console.log('Ignoring hit during respawn cooldown.');
            return; // Ignore additional hits during respawn cooldown
        }

        score = data.score;
        if (scoreDisplay) {
            scoreDisplay.textContent = `Score: ${score}`;
        }
    } else {
        const player = otherPlayers.get(data.id);
        if (player) {
            player.score = data.score;
            console.log(`Updated score for player ${data.id}: ${player.score}`);
        }
    }

    // Update the player list display
    updateDebugOverlay();
}

// Throttle position updates to 60fps
const POSITION_UPDATE_INTERVAL = 1000 / 60;
let lastPositionUpdate = 0;

function sendPosition(force = false) {
    const now = Date.now();
    // WebSocket.OPEN = 1
    if (ws && ws.readyState === 1 && playerId && (force || now - lastPositionUpdate >= POSITION_UPDATE_INTERVAL)) {
        ws.send(JSON.stringify({
            type: 'position',
            id: playerId,
            position: camera.position.toArray(),
            rotation: player.euler.toArray(), // Send euler angles instead of quaternion
            currentArenaIndex: getCurrentArenaIndex()
        }));
        lastPositionUpdate = now;
    }
}

function getCurrentArenaIndex() {
    for (let i = 0; i < arenas.length; i++) {
        const arena = arenas[i];
        const relativePos = camera.position.clone().sub(arena.position);
        if (Math.abs(relativePos.x) <= ARENA_SIZE.width/2 && 
            Math.abs(relativePos.z) <= ARENA_SIZE.depth/2) {
            return i;
        }
    }
    return 0; // Default to first arena if not found
}

// Set up the scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// Enable shadows
renderer.shadowMap.enabled = true;

// Set a background color for the scene
scene.background = new THREE.Color(0x87ceeb); // Sky blue color

// Ensure the camera's near and far clipping planes are appropriate
camera.near = 0.1;
camera.far = 1000;
camera.updateProjectionMatrix();

// Teleport prompt management
let teleportPrompt;
document.addEventListener('DOMContentLoaded', () => {
  teleportPrompt = document.getElementById('teleport-prompt');
});

function showTeleportPrompt() {
  if (teleportPrompt) {
    teleportPrompt.classList.add('visible');
  }
}

function hideTeleportPrompt() {
  if (teleportPrompt) {
    teleportPrompt.classList.remove('visible');
  }
}

// Load textures for the arena
const arenaTextures = loadArenaTextures();

// Arena color hues to match portal colors
const ARENA_COLORS = [0xff0000, 0x00ff00, 0x0000ff, 0xff00ff]; // Red, Green, Blue, Magenta

// Adjust color brightness utility
function adjustColorBrightness(hex, factor) {
  // hex: 0xRRGGBB, factor: 0-1 (darker), >1 (lighter)
  let r = ((hex >> 16) & 0xff) * factor;
  let g = ((hex >> 8) & 0xff) * factor;
  let b = (hex & 0xff) * factor;
  r = Math.min(255, Math.max(0, Math.round(r)));
  g = Math.min(255, Math.max(0, Math.round(g)));
  b = Math.min(255, Math.max(0, Math.round(b)));
  return (r << 16) | (g << 8) | b;
}

// Create a unified arena (ground + walls + ceiling)
function createArena(width, height, depth, color) {
  const w = width / 2;
  const h = height;
  const d = depth / 2;

  // Tint: floor darkest, walls medium, ceiling lightest
  const floorColor = color !== undefined ? adjustColorBrightness(color, 0.5) : 0x333333;
  const wallColor = color !== undefined ? adjustColorBrightness(color, 0.8) : 0x888888;
  const ceilingColor = color !== undefined ? adjustColorBrightness(color, 1.2) : 0xdddddd;

  const groundMaterial = new THREE.MeshStandardMaterial({
    map: arenaTextures.ground,
    color: floorColor,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0.1
  });

  const wallMaterial = new THREE.MeshStandardMaterial({
    map: arenaTextures.wall,
    color: wallColor,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0.1
  });

  const ceilingMaterial = new THREE.MeshStandardMaterial({
    map: arenaTextures.ceiling,
    color: ceilingColor,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0.1
  });

  // Create multiple meshes for ground, walls, and ceiling
  const groundGeometry = new THREE.BufferGeometry();
  const wallsGeometry = new THREE.BufferGeometry();
  const ceilingGeometry = new THREE.BufferGeometry();

  // Separate vertices for ground, walls, and ceiling
  const groundVertices = new Float32Array([
    // Ground (bottom face)
    -w, 0, -d,    // 0
     w, 0, -d,    // 1
     w, 0,  d,    // 2
    -w, 0,  d,    // 3
  ]);

  const wallVertices = new Float32Array([
    // Front wall
    -w,  0, -d,   // 0
     w,  0, -d,   // 1
     w,  h, -d,   // 2
    -w,  h, -d,   // 3

    // Back wall
    -w,  0,  d,   // 4
     w,  0,  d,   // 5
     w,  h,  d,   // 6
    -w,  h,  d,   // 7

    // Left wall
    -w,  0, -d,   // 8
    -w,  h, -d,   // 9
    -w,  h,  d,   // 10
    -w,  0,  d,   // 11

    // Right wall
     w,  0, -d,   // 12
     w,  h, -d,   // 13
     w,  h,  d,   // 14
     w,  0,  d    // 15
  ]);

  const ceilingVertices = new Float32Array([
    // Ceiling (top face)
    -w, h, -d,    // 0
     w, h, -d,    // 1
     w, h,  d,    // 2
    -w, h,  d,    // 3
  ]);

  // Separate indices for ground, walls, and ceiling
  const groundIndices = new Uint16Array([
    // Ground
    0, 1, 2,    0, 2, 3
  ]);

  const wallIndices = new Uint16Array([
    // Front wall
    0, 1, 2,    0, 2, 3,
    // Back wall
    4, 5, 6,    4, 6, 7,
    // Left wall
    8, 9, 10,   8, 10, 11,
    // Right wall
    12, 13, 14, 12, 14, 15
  ]);

  const ceilingIndices = new Uint16Array([
    // Ceiling
    0, 1, 2,    0, 2, 3
  ]);

  // Separate normals for ground, walls, and ceiling
  const groundNormals = new Float32Array([
    // Ground normals (up)
    0, 1, 0,    0, 1, 0,    0, 1, 0,    0, 1, 0
  ]);

  const wallNormals = new Float32Array([
    // Front wall normals
    0, 0, -1,   0, 0, -1,   0, 0, -1,   0, 0, -1,
    // Back wall normals
    0, 0, 1,    0, 0, 1,    0, 0, 1,    0, 0, 1,
    // Left wall normals
    -1, 0, 0,   -1, 0, 0,   -1, 0, 0,   -1, 0, 0,
    // Right wall normals
    1, 0, 0,    1, 0, 0,    1, 0, 0,    1, 0, 0
  ]);

  const ceilingNormals = new Float32Array([
    // Ceiling normals (down)
    0, -1, 0,    0, -1, 0,    0, -1, 0,    0, -1, 0
  ]);

  // Add UV coordinates for textures
  const groundUVs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ]);

  const wallUVs = new Float32Array([
    // Front wall
    0, 0,    1, 0,    1, 1,    0, 1,
    // Back wall
    0, 0,    1, 0,    1, 1,    0, 1,
    // Left wall
    0, 0,    0, 1,    1, 1,    1, 0,  // Corrected UV mapping for side walls
    // Right wall
    0, 0,    0, 1,    1, 1,    1, 0   // Corrected UV mapping for side walls
  ]);

  const ceilingUVs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ]);

  // Set up geometries
  groundGeometry.setAttribute('position', new THREE.BufferAttribute(groundVertices, 3));
  groundGeometry.setAttribute('normal', new THREE.BufferAttribute(groundNormals, 3));
  groundGeometry.setIndex(new THREE.BufferAttribute(groundIndices, 1));
  groundGeometry.setAttribute('uv', new THREE.BufferAttribute(groundUVs, 2));

  wallsGeometry.setAttribute('position', new THREE.BufferAttribute(wallVertices, 3));
  wallsGeometry.setAttribute('normal', new THREE.BufferAttribute(wallNormals, 3));
  wallsGeometry.setIndex(new THREE.BufferAttribute(wallIndices, 1));
  wallsGeometry.setAttribute('uv', new THREE.BufferAttribute(wallUVs, 2));

  ceilingGeometry.setAttribute('position', new THREE.BufferAttribute(ceilingVertices, 3));
  ceilingGeometry.setAttribute('normal', new THREE.BufferAttribute(ceilingNormals, 3));
  ceilingGeometry.setIndex(new THREE.BufferAttribute(ceilingIndices, 1));
  ceilingGeometry.setAttribute('uv', new THREE.BufferAttribute(ceilingUVs, 2));

  // Create meshes
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  const wallsMesh = new THREE.Mesh(wallsGeometry, wallMaterial);
  const ceilingMesh = new THREE.Mesh(ceilingGeometry, ceilingMaterial);

  // Create a group to hold all meshes
  const arena = new THREE.Group();
  arena.add(groundMesh);
  arena.add(wallsMesh);
  arena.add(ceilingMesh);

  // Set shadows
  groundMesh.receiveShadow = true;
  wallsMesh.receiveShadow = true;
  wallsMesh.castShadow = true;
  ceilingMesh.receiveShadow = true;
  ceilingMesh.castShadow = true;

  return arena;
}

// Arena management
const arenas = [];
const ARENA_SPACING = 200; // Space between arenas
const NUM_ARENAS = 4;

// Create teleport pad
function createTeleportPad(color, position, targetArenaIndex) {
  const geometry = new THREE.BoxGeometry(5, 0.1, 5);
  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.8
  });
  const pad = new THREE.Mesh(geometry, material);
  pad.position.copy(position);
  pad.position.y = 0.05; // Slightly above ground
  pad.targetArenaIndex = targetArenaIndex;
  pad.receiveShadow = true;
  return pad;
}

// Reset all pad emissive intensities
function resetPadEmissive() {
  arenas.forEach(arena => {
    arena.children.forEach(child => {
      if (child.targetArenaIndex !== undefined) {
        child.material.emissiveIntensity = 0.5;
      }
    });
  });
}

// Highlight active pad
function highlightPad(pad) {
  resetPadEmissive();
  if (pad) {
    pad.material.emissiveIntensity = 1.0;
  }
}

// Create arena with teleport pads
function createArenaWithPads(position, index) {
  const arenaGroup = new THREE.Group();
  
  // Create base arena
  const baseArena = createArena(100, 10, 100, ARENA_COLORS[index]);
  arenaGroup.add(baseArena);
  
  // Add teleport pads for this arena
  const padColors = [0xff0000, 0x00ff00, 0x0000ff, 0xff00ff];
  const padPositions = [
    new THREE.Vector3(-40, 0, -40),
    new THREE.Vector3(40, 0, -40),
    new THREE.Vector3(-40, 0, 40),
    new THREE.Vector3(40, 0, 40)
  ];
  
  // Create pads that lead to other arenas
  for (let i = 0; i < NUM_ARENAS; i++) {
    if (i !== index) { // Don't create pad to current arena
      const pad = createTeleportPad(
        padColors[i],
        padPositions[i],
        i
      );
      arenaGroup.add(pad);
    }
  }
  
  // Position the entire arena
  arenaGroup.position.copy(position);
  return arenaGroup;
}

// Create multiple arenas
for (let i = 0; i < NUM_ARENAS; i++) {
  const position = new THREE.Vector3(
    (i % 2) * ARENA_SPACING,
    0,
    Math.floor(i / 2) * ARENA_SPACING
  );
  const arenaWithPads = createArenaWithPads(position, i);
  scene.add(arenaWithPads);
  arenas.push(arenaWithPads);
}

// Add lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3); // Reduced ambient light
scene.add(ambientLight); // Add ambient light to scene

// Add point lights inside the arena
const pointLight1 = new THREE.PointLight(0xffffff, 0.7, 100);
pointLight1.position.set(0, 8, 0);
pointLight1.castShadow = true;
scene.add(pointLight1);

// Score tracking
let score = 0;
let scoreDisplay;

// Initialize score display when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  scoreDisplay = document.getElementById('score-container');
  updatePlayerScore({ id: playerId, score: 0 }); // Initial score display
});

// Add some smaller lights in the corners
const cornerLights = [
  { pos: [-40, 8, -40], intensity: 0.5 },
  { pos: [40, 8, -40], intensity: 0.5 },
  { pos: [-40, 8, 40], intensity: 0.5 },
  { pos: [40, 8, 40], intensity: 0.5 }
].map(({ pos, intensity }) => {
  const light = new THREE.PointLight(0xffffff, intensity, 50);
  light.position.set(...pos);
  light.castShadow = true;
  scene.add(light);
  return light;
});

// Debugging: Log objects in the scene
console.log('Scene children:', scene.children);

// Adjust camera position
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

// Adjust light intensities
ambientLight.intensity = 0.4;
pointLight1.intensity = 1;
cornerLights.forEach(light => light.intensity = 0.6);

// Player controls
const player = {
  velocity: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  speed: 15,
  sprintMultiplier: 2,
  height: 2,
  crouchHeight: 1,
  isCrouching: false,
  euler: new THREE.Euler(0, 0, 0, 'YXZ'),
  bobTimer: 0,
  bobFrequency: 10, // How fast the bobbing occurs
  bobMagnitude: 0.05, // How much the camera bobs
  sprintBobMultiplier: 1.5, // Increase bob magnitude while sprinting
  // Add jumping properties
  jumpForce: 8,
  gravity: 20,
  isGrounded: true,
  verticalVelocity: 0
};

const keys = new Set(); // Change to Set for better key state management

// Update key handling to be more precise
window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase()); // Convert to lowercase for consistency
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

// Add blur event listener to clear keys when window loses focus
window.addEventListener('blur', () => {
  keys.clear(); // Clear all keys when window loses focus
});

// Update movement check function
function isMovementKey(key) {
  return ['w', 'a', 's', 'd'].includes(key.toLowerCase());
}

// Mouse lock state
let isMouseLocked = false;

// Setup pointer lock and fullscreen
document.addEventListener('click', (event) => {
  // Only request pointer lock if modal is not visible
  if (!isMouseLocked && playerIdModal.style.display !== 'block') {
    renderer.domElement.requestPointerLock();
    
    // Request fullscreen
    const element = document.documentElement;
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    }
  }
});

// Handle pointer lock state changes
document.addEventListener('pointerlockchange', () => {
  isMouseLocked = document.pointerLockElement === renderer.domElement;
});

// Handle fullscreen change
document.addEventListener('fullscreenchange', () => {
  const isFullscreen = document.fullscreenElement !== null;
  if (!isFullscreen && isMouseLocked) {
    document.exitPointerLock();
  }
});

// Handle different browser prefixes for fullscreen change
document.addEventListener('webkitfullscreenchange', () => {
  const isFullscreen = document.webkitFullscreenElement !== null;
  if (!isFullscreen && isMouseLocked) {
    document.exitPointerLock();
  }
});

// Handle ESC key to properly exit both fullscreen and pointer lock
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  }
});

// Mouse look
window.addEventListener('mousemove', (event) => {
  if (!isMouseLocked) return; // Only handle mouse movement when locked
  
  // Update both pitch (x) and yaw (y)
  player.euler.x -= event.movementY * 0.002;
  player.euler.y -= event.movementX * 0.002;
  
  // Clamp the pitch rotation to prevent over-rotation
  player.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.euler.x));
  
  // Apply rotation to camera
  camera.quaternion.setFromEuler(player.euler);
});

// Collision detection
const PLAYER_RADIUS = 2.5;
const ARENA_SIZE = { width: 100, height: 10, depth: 100 };

function checkArenaCollision(position) {
  const correction = new THREE.Vector3();
  let hasCollision = false;

  // Find which arena the player is in
  let currentArena = null;
  let localPosition = position.clone();
  
  for (const arena of arenas) {
    const arenaPos = arena.position;
    const relativePos = position.clone().sub(arenaPos);
    if (Math.abs(relativePos.x) <= ARENA_SIZE.width/2 && 
        Math.abs(relativePos.z) <= ARENA_SIZE.depth/2) {
      currentArena = arena;
      localPosition = relativePos;
      break;
    }
  }

  if (!currentArena) return null;

  const halfWidth = ARENA_SIZE.width / 2;
  const halfDepth = ARENA_SIZE.depth / 2;

  // Check X bounds (left/right walls) relative to current arena
  if (Math.abs(localPosition.x) > halfWidth - PLAYER_RADIUS) {
    const overflowX = Math.abs(localPosition.x) - (halfWidth - PLAYER_RADIUS);
    correction.x = overflowX * (localPosition.x > 0 ? -1 : 1);
    hasCollision = true;
  }

  // Check Z bounds (front/back walls) relative to current arena
  if (Math.abs(localPosition.z) > halfDepth - PLAYER_RADIUS) {
    const overflowZ = Math.abs(localPosition.z) - (halfDepth - PLAYER_RADIUS);
    correction.z = overflowZ * (localPosition.z > 0 ? -1 : 1);
    hasCollision = true;
  }

  return hasCollision ? correction : null;
}

// Check for teleport pad collision
function checkTeleportPadCollision(position) {
  for (const arena of arenas) {
    for (const child of arena.children) {
      if (child.targetArenaIndex !== undefined) { // Is it a teleport pad?
        const padPosition = new THREE.Vector3();
        child.getWorldPosition(padPosition);
        
        // Check if player is standing on pad
        if (Math.abs(position.x - padPosition.x) < 2.5 &&
            Math.abs(position.z - padPosition.z) < 2.5 &&
            Math.abs(position.y - padPosition.y) < 1) {
          
          // Calculate relative position in current arena
          const currentOffset = position.clone().sub(arena.position);
          
          // Get corresponding position in target arena
          const targetArena = arenas[child.targetArenaIndex];
          const targetPad = targetArena.children.find(p => 
            p.targetArenaIndex === arenas.indexOf(arena));
          
          if (targetPad) {
            const targetPadPosition = new THREE.Vector3();
            targetPad.getWorldPosition(targetPadPosition);
            
            // Teleport to corresponding position relative to target pad
            const newPosition = targetPadPosition.clone();
            camera.position.copy(newPosition);
            return true;
          }
        }
      }
    }
  }
  return false;
}

// Create character model
function createCharacterModel(isNPC = false, colorInt) {
  const group = new THREE.Group();
  const color = colorInt !== undefined ? colorInt : (isNPC ? 0xff4444 : hexColorToInt(playerColor));

  // Create head
  const headGeometry = new THREE.SphereGeometry(0.25, 8, 8);
  const headMaterial = new THREE.MeshStandardMaterial({ color });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 0;
  head.castShadow = true;
  group.add(head);

  // Create body
  const bodyGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.8, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = -0.5;
  body.castShadow = true;
  group.add(body);

  // Create arms
  const armGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8);
  const armMaterial = new THREE.MeshStandardMaterial({ color });
  
  // Left arm
  const leftArm = new THREE.Mesh(armGeometry, armMaterial);
  leftArm.position.set(-0.35, -0.3, 0);
  leftArm.rotation.set(0, 0, -0.2);
  leftArm.castShadow = true;
  group.add(leftArm);

  // Right arm (positioned for holding gun if NPC)
  const rightArm = new THREE.Mesh(armGeometry, armMaterial);
  if (isNPC) {
    rightArm.position.set(0.35, -0.3, 0.2);
    rightArm.rotation.set(-0.3, 0, 0.2);
  } else {
    rightArm.position.set(0.35, -0.3, 0);
    rightArm.rotation.set(0, 0, 0.2);
  }
  rightArm.castShadow = true;
  group.add(rightArm);

  // Create legs
  const legGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8);
  const legMaterial = new THREE.MeshStandardMaterial({ color });

  // Left leg
  const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
  leftLeg.position.set(-0.15, -1.1, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  // Right leg
  const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
  rightLeg.position.set(0.15, -1.1, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // Position the entire group
  group.position.z = -0.3;
  
  return group;
}

// Create gun model
function createGunModel() {
  const group = new THREE.Group();

  // Create gun barrel
  const barrelGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.5);
  const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
  barrel.position.set(0.3, -0.3, -0.5);
  group.add(barrel);

  // Create gun body
  const bodyGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.3);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.set(0.3, -0.35, -0.3);
  group.add(body);

  return group;
}

// Projectile management
const projectiles = [];
const PROJECTILE_SPEED = 50;
const PROJECTILE_LIFETIME = 2000; // milliseconds

function createProjectile(position, direction, ownerId, isPlayer, colorHexOrInt) {
  const color = hexColorToInt(colorHexOrInt !== undefined ? colorHexOrInt : (isPlayer ? playerColor : 0xff0000));
  const geometry = new THREE.SphereGeometry(0.1);
  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.5
  });
  const projectile = new THREE.Mesh(geometry, material);

  projectile.position.copy(position);
  projectile.velocity = direction.normalize().multiplyScalar(PROJECTILE_SPEED);
  projectile.spawnTime = Date.now();
  projectile.ownerId = ownerId; // Track the owner of the projectile
  projectile.castShadow = true;

  scene.add(projectile);
  projectiles.push(projectile);

  // Debug log
  console.log('Projectile created:', {
    position: projectile.position.toArray(),
    velocity: projectile.velocity.toArray(),
    ownerId,
    isPlayer
  });

  return projectile;
}

function updateProjectiles(delta) {
    const now = Date.now();
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const projectile = projectiles[i];

        // Defensive: Ensure projectile position and velocity are valid before updating
        if (!projectile.position || !projectile.velocity ||
            [projectile.position.x, projectile.position.y, projectile.position.z].some(v => typeof v !== 'number' || isNaN(v)) ||
            [projectile.velocity.x, projectile.velocity.y, projectile.velocity.z].some(v => typeof v !== 'number' || isNaN(v))) {
            console.error('Invalid projectile state detected, removing projectile:', {
                projectile: JSON.parse(JSON.stringify(projectile)),
                index: i
            });
            scene.remove(projectile);
            projectiles.splice(i, 1);
            continue;
        }

        // Update position
        projectile.position.addScaledVector(projectile.velocity, delta);

        // Check collisions with other players
        let hit = false;
        otherPlayers.forEach((player, id) => {
            if (hit) return;
            if (!player.model.visible) return; // Skip if player not in same arena

            // Defensive: ensure both positions are valid
            const px = projectile.position.x, py = projectile.position.y, pz = projectile.position.z;
            const tx = player.model.position.x, ty = player.model.position.y, tz = player.model.position.z;
            if ([px, py, pz, tx, ty, tz].some(v => typeof v !== 'number' || isNaN(v))) {
                console.warn('Invalid position for hit detection:', {
                    projectile: { x: px, y: py, z: pz },
                    target: { x: tx, y: ty, z: tz },
                    id,
                    fullProjectile: JSON.parse(JSON.stringify(projectile)),
                    fullPlayer: JSON.parse(JSON.stringify(player))
                });
                return;
            }

            // Defensive: check for NaN before distance calculation
            if ([px, py, pz, tx, ty, tz].some(v => isNaN(v))) {
                console.error('NaN detected in position before distance calculation:', {
                    px, py, pz, tx, ty, tz,
                    projectile, player
                });
                return;
            }

            const dist = Math.sqrt(
                Math.pow(px - tx, 2) +
                Math.pow(py - ty, 2) +
                Math.pow(pz - tz, 2)
            );
            if (isNaN(dist)) {
                console.error('Distance calculation resulted in NaN:', {
                    px, py, pz, tx, ty, tz,
                    projectile, player
                });
                return;
            }
            if (
                dist < 1.5 &&
                projectile.ownerId !== id &&
                id // target id must be valid
            ) {
                if (ws && ws.readyState === 1 && playerId) { // 1 = OPEN
                    ws.send(JSON.stringify({
                        type: 'hit',
                        id: projectile.ownerId, // Shooter's ID
                        targetId: id,
                        position: { x: px, y: py, z: pz }
                    }));
                }
                scene.remove(projectile);
                projectiles.splice(i, 1);
                hit = true;
            }
        });
        if (hit) continue;

        // Check lifetime
        if (now - projectile.spawnTime > PROJECTILE_LIFETIME) {
            scene.remove(projectile);
            projectiles.splice(i, 1);
            // Debug log
            console.log('Projectile expired and removed:', {
                position: projectile.position.toArray(),
                ownerId: projectile.ownerId
            });
            continue;
        }

        // Check arena bounds
        let inArena = false;
        for (const arena of arenas) {
            const relativePos = projectile.position.clone().sub(arena.position);
            if (Math.abs(relativePos.x) <= ARENA_SIZE.width / 2 &&
                Math.abs(relativePos.z) <= ARENA_SIZE.depth / 2) {
                inArena = true;

                // Check wall collisions
                if (Math.abs(relativePos.x) > ARENA_SIZE.width / 2 - 0.1 ||
                    Math.abs(relativePos.z) > ARENA_SIZE.depth / 2 - 0.1 ||
                    projectile.position.y < 0 ||
                    projectile.position.y > ARENA_SIZE.height) {
                    scene.remove(projectile);
                    projectiles.splice(i, 1);
                    // Debug log
                    console.log('Projectile hit wall or out of bounds and removed:', {
                        position: projectile.position.toArray(),
                        ownerId: projectile.ownerId
                    });
                    break;
                }
            }
        }

        if (!inArena) {
            scene.remove(projectile);
            projectiles.splice(i, 1);
            // Debug log
            console.log('Projectile left arena and removed:', {
                position: projectile.position.toArray(),
                ownerId: projectile.ownerId
            });
        }
    }
}

// No visible player model - just the gun
scene.add(camera); // Add camera to scene to make it work as a group

// Create and add gun model
const gunModel = createGunModel();
camera.add(gunModel);

// Mouse click handling for shooting
document.addEventListener('mousedown', (event) => {
  if (!isMouseLocked || !playerId) return;

  if (event.button === 0) { // Left click
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);

    // Create projectile starting from gun position
    const gunOffset = new THREE.Vector3(0.3, -0.3, -1);
    gunOffset.applyQuaternion(camera.quaternion);
    const projectileStart = camera.position.clone().add(gunOffset);

    createProjectile(projectileStart, direction, playerId, true, playerColor); // Pass playerColor (hex string)

    // Broadcast shot
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'shoot',
        id: playerId,
        position: projectileStart.toArray(),
        direction: direction.toArray(),
        color: playerColor // Always send as hex string
      }));
    }
  }
});

// Handle window resizing
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

window.addEventListener('resize', onWindowResize);

// Also handle resize when entering/exiting fullscreen
document.addEventListener('fullscreenchange', onWindowResize);
document.addEventListener('webkitfullscreenchange', onWindowResize);

// Update loop
function update(delta) {
    if (isNaN(delta) || delta <= 0) return;

    // Get movement direction based on keys
    const moveDirection = new THREE.Vector3();
    if (keys.has('w')) moveDirection.z -= 1;
    if (keys.has('s')) moveDirection.z += 1;
    if (keys.has('a')) moveDirection.x -= 1;
    if (keys.has('d')) moveDirection.x += 1;

    // Handle jumping
    if (keys.has(' ') && player.isGrounded) {
        player.verticalVelocity = player.jumpForce;
        player.isGrounded = false;
    }

    // Apply gravity
    player.verticalVelocity -= player.gravity * delta;

    // Handle crouching
    player.isCrouching = keys.has('control');

    const isMoving = moveDirection.lengthSq() > 0;
    const isSprinting = keys.has('shift');

    // Calculate target height including bobbing
    let targetHeight = player.isCrouching ? player.crouchHeight : player.height;

    // Only apply bobbing when grounded and moving
    if (isMoving && !player.isCrouching && player.isGrounded) {
        player.bobTimer += delta * player.bobFrequency * (isSprinting ? 1.5 : 1);
        const bobMagnitude = player.bobMagnitude * (isSprinting ? player.sprintBobMultiplier : 1);
        targetHeight += Math.sin(player.bobTimer) * bobMagnitude;
    } else {
        player.bobTimer *= 0.95;
    }

    // Update vertical position
    const newY = camera.position.y + player.verticalVelocity * delta;

    if (newY <= targetHeight) {
        camera.position.y = targetHeight;
        player.verticalVelocity = 0;
        player.isGrounded = true;
    } else {
        camera.position.y = newY;
        targetHeight = camera.position.y;
    }

    // Handle horizontal movement
    if (isMoving) {
        moveDirection.normalize();
        moveDirection.applyQuaternion(camera.quaternion);
        moveDirection.y = 0;

        const currentSpeed = isSprinting ? player.speed * player.sprintMultiplier : player.speed;
        const newPosition = camera.position.clone().addScaledVector(moveDirection, currentSpeed * delta);

        // Find current arena
        let currentArena = null;
        for (const arena of arenas) {
            const relativePos = newPosition.clone().sub(arena.position);
            if (Math.abs(relativePos.x) <= ARENA_SIZE.width / 2 &&
                Math.abs(relativePos.z) <= ARENA_SIZE.depth / 2) {
                currentArena = arena;
                break;
            }
        }

        if (currentArena) {
            // Check for teleport pads
            let activePad = null;
            for (const child of currentArena.children) {
                if (child.targetArenaIndex !== undefined) {
                    const padPosition = new THREE.Vector3();
                    child.getWorldPosition(padPosition);

                    // Check from player's feet position (2 units below camera)
                    const feetPosition = newPosition.clone();
                    feetPosition.y = 0; // Check at ground level

                    if (Math.abs(feetPosition.x - padPosition.x) < 2.5 &&
                        Math.abs(feetPosition.z - padPosition.z) < 2.5) {
                        activePad = child;
                        break;
                    }
                }
            }

            // Show/hide teleport prompt and handle teleportation
            if (activePad) {
                showTeleportPrompt();

                if (keys.has('e')) {
                    const targetArena = arenas[activePad.targetArenaIndex];
                    // Get world position of source pad
                    const sourcePadPos = new THREE.Vector3();
                    activePad.getWorldPosition(sourcePadPos);

                    // Calculate player's offset from the source pad
                    const playerOffset = new THREE.Vector3();
                    playerOffset.subVectors(newPosition, sourcePadPos);

                    // Find corresponding pad in target arena
                    const targetPad = targetArena.children.find(child =>
                        child.targetArenaIndex === arenas.indexOf(currentArena));

                    if (targetPad) {
                        // Get target pad world position
                        const targetPos = new THREE.Vector3();
                        targetPad.getWorldPosition(targetPos);

                        // Apply offset to maintain relative position
                        targetPos.add(playerOffset);
                        targetPos.y = camera.position.y; // Maintain current height

                        // Perform teleport
                        camera.position.copy(targetPos);
                        keys.delete('e'); // Prevent multiple teleports
                        hideTeleportPrompt(); // Hide prompt after teleporting
                        return;
                    }
                }
            } else {
                hideTeleportPrompt();
            }

            // Highlight active pad
            highlightPad(activePad);

            // Apply movement if no teleport occurred
            const relativePos = newPosition.clone().sub(currentArena.position);
            const correction = checkArenaCollision(relativePos);
            if (correction) {
                newPosition.add(correction);
            }

            const currentY = camera.position.y;
            camera.position.copy(newPosition);
            camera.position.y = currentY;
        }
    }

    // Add gun bobbing effect
    if (gunModel) {
        const bobOffsetY = Math.sin(player.bobTimer) * player.bobMagnitude * (isSprinting ? player.sprintBobMultiplier : 1);
        const bobOffsetX = Math.cos(player.bobTimer) * player.bobMagnitude * 0.5; // Smaller horizontal bob
        gunModel.position.set(0.3, -0.3 + bobOffsetY, -0.5);
        gunModel.position.x = 0.3 + bobOffsetX;
    }

    // Interpolate other players' positions
    interpolateOtherPlayers(delta);

    // Update debug overlay
    updateDebugOverlay();
}

// Animation loop
let lastTime = 0;
function animate(time) {
  const delta = (time - lastTime) / 1000;
  lastTime = time;

  update(delta);
  updateProjectiles(delta);
  
  // Send position update to server
  sendPosition();
  
  // Update debug overlay
  updateDebugOverlay();
  
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

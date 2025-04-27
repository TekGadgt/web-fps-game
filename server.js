import { WebSocketServer } from 'ws';

// Create WebSocket server with proper configuration
const wss = new WebSocketServer({ 
  port: process.env.PORT || 8080,
  // Allow connections from localtunnel
  verifyClient: (info) => {
    const origin = info.req.headers.origin || '';
    console.log('Connection attempt from:', origin);
    // Accept all connections - we'll handle authentication with player IDs
    return true;
  }
});

// Log when server starts
console.log('WebSocket server starting on port 8080');

// Store connected players
const players = new Map();
const pendingConnections = new Map();

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Cleanup function for disconnected players
function removePlayer(ws, playerId) {
    if (playerId && players.has(playerId)) {
        console.log(`Player ${playerId} disconnected`);
        players.delete(playerId);
        broadcast({
            type: 'playerLeft',
            id: playerId
        });
    }
    pendingConnections.delete(ws);
}

// Optimize broadcast by sending updates only to relevant clients
function broadcast(data, except) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client !== except && client.readyState === 1) { // WebSocket.OPEN = 1
            try {
                client.send(message);
            } catch (e) {
                console.error('Error broadcasting to client:', e);
            }
        }
    });
}

// Throttle position updates to reduce server load
const POSITION_UPDATE_INTERVAL = 100; // 100ms interval
let lastPositionUpdate = Date.now();

wss.on('connection', (ws) => {
    // Store ws reference in player data for cleanup
    let currentPlayerId = null;
    
    const tempId = generateId();
    pendingConnections.set(ws, tempId);
    
    // Send immediate acknowledgment of connection
    ws.send(JSON.stringify({ type: 'connected' }));
    console.log('New connection pending registration');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'register') {
                const requestedId = data.playerId;
                const requestedColor = data.color || '#2244aa'; // Default if not provided
                console.log('Registration request for ID:', requestedId, 'with color:', requestedColor);

                // Quick validation
                if (!requestedId || players.has(requestedId)) {
                    console.log('ID already taken:', requestedId);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Player ID already taken'
                    }));
                    return;
                }

                // Initialize player with color
                currentPlayerId = requestedId;
                const playerData = {
                    id: requestedId,
                    position: { x: 0, y: 2, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    score: 0,
                    color: requestedColor,
                    ws,
                    invulnerableUntil: 0 // Add invulnerability property
                };

                pendingConnections.delete(ws);
                players.set(requestedId, playerData);
                console.log(`Player ${requestedId} registered successfully`);

                // Send immediate confirmation, include color for all players
                ws.send(JSON.stringify({
                    type: 'init',
                    id: requestedId,
                    players: Array.from(players.values()).map(p => ({
                        id: p.id,
                        position: p.position,
                        rotation: p.rotation,
                        score: p.score,
                        color: p.color || '#2244aa'
                    }))
                }));

                // Broadcast new player to others, include color
                broadcast({
                    type: 'playerJoined',
                    player: {
                        id: playerData.id,
                        position: playerData.position,
                        rotation: playerData.rotation,
                        score: playerData.score,
                        color: playerData.color
                    }
                }, ws);

                return;
            }

            // Only handle game messages if player is registered
            if (!players.has(data.id)) {
                console.log('Ignoring message from unregistered player');
                return;
            }

            switch(data.type) {
                case 'position':
                    // Always update player position and broadcast immediately
                    const player = players.get(data.id);
                    if (player) {
                        // Normalize position to {x, y, z} object
                        let pos = data.position;
                        if (Array.isArray(pos) && pos.length === 3) {
                            pos = { x: pos[0], y: pos[1], z: pos[2] };
                        }
                        player.position = pos;
                        player.rotation = data.rotation;
                        player.currentArenaIndex = data.currentArenaIndex;
                        broadcast({
                            type: 'playerMoved',
                            id: data.id,
                            position: pos,
                            rotation: data.rotation,
                            currentArenaIndex: data.currentArenaIndex
                        }, ws);
                    }
                    break;

                case 'shoot':
                    // Broadcast shot, include color
                    const shooterPlayer = players.get(data.id);
                    broadcast({
                        type: 'playerShot',
                        id: data.id,
                        position: data.position,
                        direction: data.direction,
                        color: shooterPlayer && shooterPlayer.color ? shooterPlayer.color : '#ff0000'
                    }, ws);
                    break;

                case 'hit':
                    const hitPlayer = players.get(data.targetId);
                    const shooter = players.get(data.id);
                    const nowHit = Date.now();
                    if (hitPlayer && shooter) {
                        // Server-side respawn protection: ignore hits if invulnerable
                        if (hitPlayer.invulnerableUntil && nowHit < hitPlayer.invulnerableUntil) {
                            console.log(`Ignoring hit: ${data.targetId} is invulnerable until ${hitPlayer.invulnerableUntil}, now=${nowHit}`);
                            return;
                        }
                        // Validate data.position and hitPlayer.position
                        if (!data.position ||
                            typeof data.position.x !== 'number' || isNaN(data.position.x) ||
                            typeof data.position.y !== 'number' || isNaN(data.position.y) ||
                            typeof data.position.z !== 'number' || isNaN(data.position.z) ||
                            !hitPlayer.position ||
                            typeof hitPlayer.position.x !== 'number' || isNaN(hitPlayer.position.x) ||
                            typeof hitPlayer.position.y !== 'number' || isNaN(hitPlayer.position.y) ||
                            typeof hitPlayer.position.z !== 'number' || isNaN(hitPlayer.position.z)) {
                            console.warn(`Malformed hit message or player position:`, {
                                dataPosition: data.position,
                                hitPlayerPosition: hitPlayer.position,
                                shooterId: data.id,
                                targetId: data.targetId
                            });
                            return;
                        }
                        // Ensure the hit is valid by checking distance between projectile and player
                        const distance = Math.sqrt(
                            Math.pow(hitPlayer.position.x - data.position.x, 2) +
                            Math.pow(hitPlayer.position.y - data.position.y, 2) +
                            Math.pow(hitPlayer.position.z - data.position.z, 2)
                        );
                        console.log('Hit check:', {
                            shooterId: data.id,
                            targetId: data.targetId,
                            hitPlayerPosition: hitPlayer.position,
                            projectilePosition: data.position,
                            distance
                        });
                        if (isNaN(distance)) {
                            console.warn('Distance calculation resulted in NaN:', {
                                dataPosition: data.position,
                                hitPlayerPosition: hitPlayer.position,
                                shooterId: data.id,
                                targetId: data.targetId
                            });
                            return;
                        }
                        if (distance < 4.0) { // Looser hitbox to account for network lag
                            // Set invulnerability for 2 seconds BEFORE broadcasting
                            hitPlayer.invulnerableUntil = nowHit + 2000;
                            console.log(`Setting invulnerableUntil for ${data.targetId} to ${hitPlayer.invulnerableUntil}`);
                            hitPlayer.score--;
                            shooter.score++;
                            // Broadcast score update for hit player with respawn
                            broadcast({
                                type: 'scoreUpdate',
                                id: data.targetId,
                                score: hitPlayer.score,
                                respawn: true
                            });
                            // Broadcast score update for shooter
                            broadcast({
                                type: 'scoreUpdate',
                                id: data.id,
                                score: shooter.score,
                                respawn: false
                            });
                            console.log(`Player ${data.targetId} was hit by ${data.id}`);
                        } else {
                            console.log(`Invalid hit detected: distance ${distance}`);
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => removePlayer(ws, currentPlayerId));
    ws.on('error', () => removePlayer(ws, currentPlayerId));
});

// Cleanup on server shutdown
wss.on('close', () => {
    // Any cleanup if needed
});

console.log('WebSocket server running on port 8080');

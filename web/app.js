import * as THREE from 'three';

// =====================================================
// SCENA ONIRICA AVANZATA (METEO SENSORIALE + RPG CLIMATE)
// =====================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020208);
const fogEffect = new THREE.FogExp2(0x020208, 0.015);
scene.fog = fogEffect;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2.5, 7.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

// =====================================================
// LUCI CINETICHE
// =====================================================
const ambientLight = new THREE.AmbientLight(0x0a0518, 0.6);
scene.add(ambientLight);

const keyLight = new THREE.PointLight(0xffffff, 2, 40);
keyLight.position.set(5, 8, 5);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x00ffff, 1.5, 25);
fillLight.position.set(-5, 2, -2);
scene.add(fillLight);

const floorLight = new THREE.DirectionalLight(0x4411aa, 0.5);
floorLight.position.set(0, -1, 0).normalize();
scene.add(floorLight);

// =====================================================
// STATO GLOBALE UNIFICATO (INTEGRATO CON ENGINE RPG)
// =====================================================
let state = {
    soul: { mood: "neutra", lifeIndex: 50 },
    progression: { level: 1, xp: 0, xpNextLevel: 1000, activeClass: "Neutro", unlockedAssets: ["base_grid"] },
    people: [],
    plants: [],
    lights: [],
    sensors: [], 
    metrics: {}, 
    rooms: [],
    vision: { rooms: [], people: [], events: [], emotions: {} },
    events: [],  
    thought: "",
    lastMemory: ""
};

// Buffer locali per monitorare transizioni ed eventi di gioco
let lastThought = "";
let lastLevel = 1;
let lastClass = "Neutro";

// =====================================================
// ASSET GRAFICI RPG SBLOCCABILI DINAMICAMENTE
// =====================================================
const rpgAssetsGroup = new THREE.Group();
scene.add(rpgAssetsGroup);

const rpgAssets = {
    // Sblocco Livello 1: Griglia Digitale di Base
    base_grid: new THREE.GridHelper(20, 40, 0x00ffcc, 0x112233),
    
    // Sblocco Livello Avanzato: Particelle cosmiche fluttuanti di sottofondo
    ambient_particles_low: (() => {
        const pGeo = new THREE.BufferGeometry();
        const pCount = 500;
        const pos = new Float32Array(pCount * 3);
        for(let i=0; i<pCount*3; i++) pos[i] = (Math.random() - 0.5) * 15;
        pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const pMat = new THREE.PointsMaterial({ size: 0.03, color: 0x94b3fd, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending });
        return new THREE.Points(pGeo, pMat);
    })(),

    // Core supplementare difensivo (Sblocco Guerriero / Livelli alti)
    shield_dome: (() => {
        const sGeo = new THREE.SphereGeometry(1.2, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const sMat = new THREE.MeshBasicMaterial({ color: 0xff3333, wireframe: true, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(sGeo, sMat);
        mesh.position.y = -0.1;
        return mesh;
    })()
};

// Inizializza e aggiunge tutti gli asset RPG alla scena come invisibili
Object.keys(rpgAssets).forEach(key => {
    rpgAssets[key].visible = false;
    rpgAssetsGroup.add(rpgAssets[key]);
});

// =====================================================
// NUCLEO: CUORE E SONAR DEI PENSIERI
// =====================================================
const heartGroup = new THREE.Group();
scene.add(heartGroup);

const heartGeo = new THREE.TorusKnotGeometry(0.55, 0.12, 120, 16, 3, 4);
const heartMat = new THREE.MeshStandardMaterial({
    color: 0x8888aa,
    emissive: 0x112244,
    emissiveIntensity: 1.0,
    roughness: 0.1,
    metalness: 0.9
});
const heart = new THREE.Mesh(heartGeo, heartMat);
heartGroup.add(heart);

const sonarGeo = new THREE.SphereGeometry(0.6, 32, 32);
const sonarMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    wireframe: true,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending
});
const sonarWave = new THREE.Mesh(sonarGeo, sonarMat);
heartGroup.add(sonarWave);
let sonarScale = 1.0;
let sonarActive = false;

// Sciame di particelle del Cuore
const heartParticlesCount = 800;
const heartParticlesGeo = new THREE.BufferGeometry();
const heartParticlesPos = new Float32Array(heartParticlesCount * 3);
const heartParticlesSpeed = new Float32Array(heartParticlesCount);
for (let i = 0; i < heartParticlesCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 1.1 + Math.random() * 0.5;
    heartParticlesPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
    heartParticlesPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    heartParticlesPos[i*3+2] = r * Math.cos(phi);
    heartParticlesSpeed[i] = 0.5 + Math.random() * 1.5;
}
heartParticlesGeo.setAttribute('position', new THREE.BufferAttribute(heartParticlesPos, 3));
const heartParticlesMat = new THREE.PointsMaterial({ size: 0.025, color: 0x88ccff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8 });
const heartParticles = new THREE.Points(heartParticlesGeo, heartParticlesMat);
heartGroup.add(heartParticles);

// =====================================================
// NASTRI DI ENERGIA (GIRANO IN BASE AL CONSUMO ELETTRO)
// =====================================================
const ribbonsGroup = new THREE.Group();
scene.add(ribbonsGroup);
const ribbonCount = 6;
const ribbons = [];
for (let i = 0; i < ribbonCount; i++) {
    const points = [];
    const radius = 2.2 + i * 0.4;
    for (let j = 0; j <= 80; j++) {
        const angle = (j / 80) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, 120, 0.015, 8, true);
    const tubeMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.5 + i * 0.06, 1, 0.5),
        emissive: new THREE.Color().setHSL(0.5 + i * 0.06, 1, 0.3),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        wireframe: true
    });
    const ribbon = new THREE.Mesh(tubeGeo, tubeMat);
    ribbon.userData = { index: i, radius: radius };
    ribbonsGroup.add(ribbon);
    ribbons.push(ribbon);
}

// =====================================================
// METEO AMBIENTALE GLOBALE (STRUTTURA DATI DINAMICA)
// =====================================================
let envWeather = {
    windSpeed: 1.0,       
    targetFogDensity: 0.015, 
    ambientHue: 0.6,      
    energyVelocity: 1.0   
};

// =====================================================
// MAPPE DI MEMORIA MESH
// =====================================================
const plantBlades = new Map();
const lightGems = new Map();
const shadowFigures = new Map();
const roomMarkers = new Map();
const yoloObjects = new Map();

// Particelle per i Gesti di MediaPipe
let gestureParticles;
const gestureParticleCount = 300;
const gestureGeometry = new THREE.BufferGeometry();
const gesturePositions = new Float32Array(gestureParticleCount * 3);
const gestureColors = new Float32Array(gestureParticleCount * 3);
const gestureData = [];
for(let i=0; i<gestureParticleCount; i++) { gestureData.push({ active: false, age: 0, life: 0, velocity: new THREE.Vector3() }); }
gestureGeometry.setAttribute('position', new THREE.BufferAttribute(gesturePositions, 3));
gestureGeometry.setAttribute('color', new THREE.BufferAttribute(gestureColors, 3));
const gestureMaterial = new THREE.PointsMaterial({ size: 0.06, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9 });
gestureParticles = new THREE.Points(gestureGeometry, gestureMaterial);
scene.add(gestureParticles);

function triggerGestureBurst(position, colorHex) {
    const pArray = gestureParticles.geometry.attributes.position.array;
    const cArray = gestureParticles.geometry.attributes.color.array;
    const col = new THREE.Color(colorHex);
    let count = 0;
    for(let i=0; i<gestureParticleCount; i++) {
        if(!gestureData[i].active && count < 40) {
            gestureData[i].active = true; gestureData[i].age = 0; gestureData[i].life = 30 + Math.random() * 30;
            pArray[i*3] = position.x; pArray[i*3+1] = position.y + 0.5; pArray[i*3+2] = position.z;
            cArray[i*3] = col.r; cArray[i*3+1] = col.g; cArray[i*3+2] = col.b;
            gestureData[i].velocity.set((Math.random() - 0.5) * 0.08, (Math.random() * 0.08) + 0.02, (Math.random() - 0.5) * 0.08);
            count++;
        }
    }
    gestureParticles.geometry.attributes.position.needsUpdate = true;
    gestureParticles.geometry.attributes.color.needsUpdate = true;
}

// =====================================================
// PARSING DEI SENSORI PER IL METEO 3D
// =====================================================
function parseSensorsAndMetrics() {
    const sensors = state.sensors || [];
    const metrics = state.metrics || {};
    
    let localTemp = 21; 
    let localHum = 45;
    let localCo2 = 400;

    sensors.forEach(s => {
        const id = s.id?.toLowerCase() || "";
        const type = s.type?.toLowerCase() || "";
        
        if (type === 'temperature' || id.includes('temp')) localTemp = s.temperature || s.value || localTemp;
        if (type === 'humidity' || id.includes('hum') || id.includes('umidita')) localHum = s.humidity || s.value || localHum;
        if (type === 'co2' || id.includes('co2') || id.includes('quality')) localCo2 = s.value || localCo2;
    });

    envWeather.ambientHue = THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(localTemp, 15, 30), 15, 30, 0.62, 0.78);
    envWeather.targetFogDensity = THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(localHum, 20, 80), 20, 80, 0.008, 0.035);
    envWeather.windSpeed = THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(localCo2, 350, 1200), 350, 1200, 0.8, 3.5);

    if (metrics.power_consumption || metrics.activeLightsCount) {
        const baseline = metrics.power_consumption || (metrics.activeLightsCount * 15);
        envWeather.energyVelocity = THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(baseline, 0, 3000), 0, 3000, 0.5, 4.0);
    } else {
        envWeather.energyVelocity = 1.0;
    }
}

// =====================================================
// RECONCILIATION DEGLI ASSET RPG SBLOCCATI
// =====================================================
function syncUnlockedAssets() {
    const unlocked = state.progression?.unlockedAssets || ["base_grid"];
    Object.keys(rpgAssets).forEach(key => {
        if (rpgAssets[key]) {
            rpgAssets[key].visible = unlocked.includes(key);
        }
    });
}

// ANIMA FLASH DI LUCE SPECIALE AL LIVELLAMENTO (Level Up)
function triggerLevelUpVFX() {
    keyLight.intensity = 8.0; 
    sonarActive = true;
    sonarScale = 1.0;
    sonarMat.color.setHex(0xffd700); // Onda dorata regale
}

// =====================================================
// PIPELINE SINCRO DELLE MESH (LOGICA DATI)
// =====================================================
function updateGarden() {
    const plants = state.plants || [];
    const aliveIds = new Set();
    plants.forEach((p, i) => {
        const id = p.id; aliveIds.add(id);
        if (!plantBlades.has(id)) {
            const group = new THREE.Group();
            const bladeCount = 10;
            for (let j = 0; j < bladeCount; j++) {
                const height = 0.4 + Math.random() * 0.4;
                const bladeGeo = new THREE.ConeGeometry(0.02, height, 5);
                bladeGeo.translate(0, height/2, 0);
                const bladeMat = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.1 });
                const blade = new THREE.Mesh(bladeGeo, bladeMat);
                blade.position.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2);
                blade.rotation.z = (Math.random() - 0.5) * 0.2;
                group.add(blade);
            }
            scene.add(group); plantBlades.set(id, group);
        }
        const group = plantBlades.get(id);
        const moisture = p.moisture || 50;
        const health = p.health || (moisture / 100);
        group.userData.targetColor = new THREE.Color().setHSL(0.28 + health * 0.12, 0.9, 0.2 + health * 0.3);
        group.userData.targetScaleY = 0.5 + health * 1.0;
        const angle = (i / Math.max(1, plants.length)) * Math.PI * 2;
        group.position.set(Math.cos(angle) * 3.4, 0, Math.sin(angle) * 3.4);
    });
    for (const [id, group] of plantBlades) {
        if (!aliveIds.has(id)) { scene.remove(group); group.children.forEach(b => { b.geometry.dispose(); b.material.dispose(); }); plantBlades.delete(id); }
    }
}

function updateLightGems() {
    const lights = state.lights || [];
    const aliveIds = new Set();
    lights.forEach((l, i) => {
        const id = l.id; aliveIds.add(id);
        if (!lightGems.has(id)) {
            const gemGeo = new THREE.IcosahedronGeometry(0.14, 0);
            const gemMat = new THREE.MeshStandardMaterial({ roughness: 0.05, metalness: 0.95 });
            const gem = new THREE.Mesh(gemGeo, gemMat);
            gem.userData = { floatPhase: Math.random() * Math.PI * 2, targetColor: new THREE.Color(), targetScale: 1 };
            scene.add(gem); lightGems.set(id, gem);
        }
        const gem = lightGems.get(id);
        const intensity = (l.brightness || 0) / 100;
        gem.userData.targetColor.set(l.color || '#ffffff');
        gem.userData.targetScale = 0.6 + intensity * 0.9;
        gem.userData.emissiveIntensity = intensity * 2.0;
        const angle = (i / Math.max(1, lights.length)) * Math.PI * 2;
        gem.position.set(Math.cos(angle) * 2.6, 0, Math.sin(angle) * 2.6);
    });
    for (const [id, gem] of lightGems) {
        if (!aliveIds.has(id)) { scene.remove(gem); gem.geometry.dispose(); gem.material.dispose(); lightGems.delete(id); }
    }
}

function updateShadows() {
    const people = state.people || [];
    const aliveIds = new Set();
    people.forEach((p, idx) => {
        const id = p.realId || p.id || `${p.name}_${p.room || idx}`; aliveIds.add(id);
        if (!shadowFigures.has(id)) {
            const group = new THREE.Group();
            const bodyGeo = new THREE.CylinderGeometry(0.02, 0.14, 0.7, 5);
            bodyGeo.translate(0, 0.35, 0);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x050515, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.85 });
            const body = new THREE.Mesh(bodyGeo, bodyMat); group.add(body);
            
            const headGeo = new THREE.OctahedronGeometry(0.1, 0);
            const head = new THREE.Mesh(headGeo, bodyMat); head.position.y = 0.8; group.add(head);
            
            const auraGeo = new THREE.RingGeometry(0.18, 0.3, 5, 1);
            const auraMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, wireframe: true });
            const aura = new THREE.Mesh(auraGeo, auraMat); aura.rotation.x = -Math.PI / 2; group.add(aura);

            const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
            const texture = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
            const labelSprite = new THREE.Sprite(spriteMat); labelSprite.position.y = 1.1; labelSprite.scale.set(1.2, 0.3, 1); group.add(labelSprite);
            
            group.userData = { aura, body, head, labelSprite, currentName: "", angle: Math.random() * Math.PI * 2, targetColor: new THREE.Color(0x8888cc), floatSpeed: 1.0, jitter: 0, lastGesture: 'none' };
            scene.add(group); shadowFigures.set(id, group);
        }

        const group = shadowFigures.get(id);
        if (group.userData.currentName !== p.name) {
            const canvas = group.userData.labelSprite.material.map.image; const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const isAnon = p.name.startsWith("YOLO_Anon");
            ctx.font = 'Bold 24px monospace'; ctx.fillStyle = isAnon ? '#6666aa' : '#00ffcc'; ctx.textAlign = 'center';
            ctx.shadowColor = 'black'; ctx.shadowBlur = 4; ctx.fillText(p.name, 128, 40);
            group.userData.labelSprite.material.map.needsUpdate = true; group.userData.currentName = p.name;
        }

        const emotion = p.emotion || 'neutral';
        const emotionConfigs = {
            happy: { color: 0x33ff88, speed: 2.5, jitter: 0.0 },
            sad: { color: 0x2266ff, speed: 0.4, jitter: 0.0 },
            angry: { color: 0xff3333, speed: 4.0, jitter: 0.04 },
            surprised: { color: 0xffcc33, speed: 2.0, jitter: 0.01 },
            neutral: { color: 0x666699, speed: 1.0, jitter: 0.0 }
        };
        const config = emotionConfigs[emotion] || emotionConfigs.neutral;
        group.userData.targetColor.setHex(config.color);
        group.userData.floatSpeed = config.speed;
        group.userData.jitter = config.jitter;

        const currentGesture = p.gesture || 'none';
        if(currentGesture !== 'none' && currentGesture !== group.userData.lastGesture) {
            triggerGestureBurst(group.position, config.color);
        }
        group.userData.lastGesture = currentGesture;
        const roomMarker = roomMarkers.get(p.room);
        if (roomMarker) {
            group.userData.orbitCenterX = roomMarker.position.x;
            group.userData.orbitCenterZ = roomMarker.position.z;
            group.userData.targetRadius = 1.0 + (p.affinity || 0) * 0.02;
        } else {
            group.userData.orbitCenterX = 0;
            group.userData.orbitCenterZ = 0;
            group.userData.targetRadius = 4.0 + (p.affinity || 0) * 0.04;
        }
    });

    for (const [id, group] of shadowFigures) {
        if (!aliveIds.has(id)) { scene.remove(group); group.children.forEach(c => { c.geometry.dispose(); if(c.material) c.material.dispose(); }); shadowFigures.delete(id); }
    }
}

// ── Layout stanze dalla PIANTINA REALE (brain.roomGraph via WS) ──────────────
// La casa intera diventa la mappa del mondo RPG: BFS dal nodo più connesso
// (il salotto/hub), anelli radiali per profondità. Cache per versione grafo.
let _roomLayoutCache = null, _roomLayoutV = null;
function computeRoomLayout(graph) {
    if (!graph) return null;
    if (_roomLayoutCache && _roomLayoutV === graph._v) return _roomLayoutCache;
    const nodes = Object.keys(graph).filter(k => k !== '_v');
    if (!nodes.length) return null;
    let hub = nodes[0], best = -1;
    nodes.forEach(n => { const d = (graph[n] || []).length; if (d > best) { best = d; hub = n; } });
    const pos = { [hub]: { x: 0, z: 0 } };
    const visited = new Set([hub]);
    let frontier = [hub], depth = 0;
    while (frontier.length && depth < 6) {
        depth += 1;
        const next = [];
        frontier.forEach(parent => {
            const kids = (graph[parent] || []).filter(k => !visited.has(k) && graph[k]);
            kids.forEach((k, idx) => {
                visited.add(k); next.push(k);
                const pAng = Math.atan2(pos[parent].z, pos[parent].x) || 0;
                const ang = depth === 1
                    ? idx * (Math.PI * 2 / kids.length) - Math.PI / 2
                    : pAng + (idx - (kids.length - 1) / 2) * 0.55;
                const r = depth * 2.7;
                pos[k] = { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
            });
        });
        frontier = next;
    }
    _roomLayoutCache = pos; _roomLayoutV = graph._v;
    return pos;
}

function _makeRoomLabel(name) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 48;
    const cx = cv.getContext('2d');
    cx.font = '600 26px Segoe UI, sans-serif';
    cx.textAlign = 'center';
    cx.fillStyle = 'rgba(160,190,220,0.85)';
    cx.fillText(name.toUpperCase(), 128, 32);
    const tex = new THREE.CanvasTexture(cv);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }));
    sprite.scale.set(1.6, 0.3, 1);
    return sprite;
}

function updateRoomMarkers() {
    const layout = computeRoomLayout(state.roomGraph);
    const liveRooms = new Map(((state.vision && state.vision.rooms) || []).map(r => [r.id, r]));
    // tutte le stanze note dal grafo + eventuali stanze live fuori grafo
    const ids = new Set([...(layout ? Object.keys(layout) : []), ...liveRooms.keys()]);
    let i = 0;
    ids.forEach(id => {
        let marker = roomMarkers.get(id);
        if (!marker) {
            const ringGeo = new THREE.RingGeometry(0.4, 0.44, 6);
            const ringMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.4, wireframe: true });
            marker = new THREE.Mesh(ringGeo, ringMat); marker.rotation.x = -Math.PI / 2;
            const lbl = _makeRoomLabel(id);
            lbl.position.set(0, 0.55, 0);
            marker.add(lbl);
            scene.add(marker); roomMarkers.set(id, marker);
        }
        const p = layout && layout[id];
        if (p) marker.position.set(p.x, 0.01, p.z);
        else if (marker.position.lengthSq() === 0) marker.position.set(Math.cos(i * 1.6) * 3.2, 0.01, Math.sin(i * 1.6) * 3.2);

        const room = liveRooms.get(id);
        const colors = { working: 0x0077ff, resting: 0x00ff77, sitting: 0xffaa00, empty: 0x111122, idle: 0x111122, active: 0x0077ff };
        if (room) {
            marker.material.opacity = 0.45;
            marker.material.color.setHex(colors[room.activity] || colors[room.current_activity] || 0x111122);
            marker.userData.targetScale = room.persons_count > 0 ? 1.2 : 0.8;
            // chi parla: la stanza pulsa color accento
            if (room.speaking) {
                marker.material.color.setHex(0x00ffcc);
                marker.userData.targetScale = 1.5;
            }
        } else {
            // stanza nota dal grafo ma senza sensori: presenza spettrale
            marker.material.opacity = 0.12;
            marker.material.color.setHex(0x223344);
            marker.userData.targetScale = 0.6;
        }
        i += 1;
    });
}

function updateYOLOObjects() {
    const visionData = state.vision; if (!visionData || !visionData.rooms) return;
    const activeIds = new Set();
    visionData.rooms.forEach((room) => {
        const objects = room.objects || {};
        Object.entries(objects).forEach(([objName, count]) => {
            if (count === 0) return;
            const id = `${room.id}_${objName}`; activeIds.add(id);
            if (!yoloObjects.has(id)) {
                let geo;
                if(['chair', 'couch'].includes(objName)) geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
                else if(objName === 'bed') geo = new THREE.BoxGeometry(0.4, 0.1, 0.25);
                else if(['laptop', 'computer'].includes(objName)) geo = new THREE.BoxGeometry(0.15, 0.03, 0.1);
                else geo = new THREE.SphereGeometry(0.08, 4, 4);
                const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, transparent: true, opacity: 0.6, wireframe: true });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.userData = { offsetX: (Math.random() - 0.5) * 0.6, offsetZ: (Math.random() - 0.5) * 0.6, targetColor: new THREE.Color() };
                scene.add(mesh); yoloObjects.set(id, mesh);
            }
            const mesh = yoloObjects.get(id); const roomPos = roomMarkers.get(room.id);
            if (roomPos) mesh.position.set(roomPos.position.x + mesh.userData.offsetX, 0.15, roomPos.position.z + mesh.userData.offsetZ);
            const colors = { working: 0x4488ff, resting: 0x44ff88, sitting: 0xffaa44, empty: 0x333333, idle: 0x333333, active: 0x4488ff };
            mesh.userData.targetColor.setHex(colors[room.activity] || colors[room.current_activity] || 0x333333);
        });
    });
    for (const [id, mesh] of yoloObjects) {
        if (!activeIds.has(id)) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); yoloObjects.delete(id); }
    }
}

// =====================================================
// HUD OVERLAY CYBERPUNK (AGGIORNATO CON RIGHE STATS RPG)
// =====================================================
const hudCanvas = document.createElement('canvas');
hudCanvas.width = window.innerWidth; hudCanvas.height = 140; // Alzato leggermente per fare spazio alle barre RPG
hudCanvas.style.position = 'absolute'; hudCanvas.style.top = '0'; hudCanvas.style.left = '0'; hudCanvas.style.pointerEvents = 'none';
document.body.appendChild(hudCanvas);
const hudCtx = hudCanvas.getContext('2d');

function updateHUD() {
    hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    const gradient = hudCtx.createLinearGradient(0, 0, 0, 120);
    gradient.addColorStop(0, 'rgba(3, 3, 12, 0.85)'); gradient.addColorStop(1, 'rgba(3, 3, 12, 0.0)');
    hudCtx.fillStyle = gradient; hudCtx.fillRect(0, 0, hudCanvas.width, 120);

    hudCtx.font = 'Bold 11px monospace'; hudCtx.fillStyle = '#00ffcc';
    hudCtx.fillText('// GAIA QUANTUM RPG ENGINE v9.0', 25, 25);

    // Dati Anima Classici
    hudCtx.font = '13px monospace'; hudCtx.fillStyle = '#ffffff';
    const soul = state.soul || {};
    hudCtx.fillText(`[NUCLEO ANIMA]: ${soul.mood?.toUpperCase() || 'NEUTRA'}  |  [VITA]: ${Math.round(soul.lifeIndex || 50)}%`, 25, 48);
    
    // NUOVO: Dati Progression / Livelli / Classi RPG
    const prog = state.progression || { level: 1, xp: 0, xpNextLevel: 1000, activeClass: "Neutro" };
    hudCtx.fillStyle = '#ffd700';
    hudCtx.fillText(`[LIVELLO]: ${prog.level}  |  [ARCHETIPO]: ${prog.activeClass.toUpperCase()}`, 25, 68);

    // NUOVO: Disegno della barra dell'esperienza (XP Bar)
    const xpPct = THREE.MathUtils.clamp(prog.xp / (prog.xpNextLevel || 1000), 0, 1);
    hudCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    hudCtx.fillRect(25, 76, 200, 4); // Sfondo barra
    hudCtx.fillStyle = '#ffd700';
    hudCtx.fillRect(25, 76, 200 * xpPct, 4); // Riempimento oro
    hudCtx.font = '9px monospace'; hudCtx.fillStyle = '#8888aa';
    hudCtx.fillText(`${prog.xp}/${prog.xpNextLevel} XP`, 235, 81);

    // Stanze e sensori ambientali
    const activeP = (state.people || []).filter(p => p.present).length;
    const activeRooms = (state.rooms || []).filter(r => r.persons_count > 0).length;
    const realSensors = (state.sensors || []).filter(s => s.temperature !== null || s.ambient_light !== null).length;
    hudCtx.fillStyle = '#8888aa'; hudCtx.font = '11px monospace';
    hudCtx.fillText(`STANZE: ${activeRooms}  |  PRESENTI: ${activeP}  |  LUCI: ${(state.lights || []).length}  |  SENSORI: ${realSensors}`, 25, 100);
    
    if (state.thought) {
        hudCtx.fillStyle = '#94b3fd'; 
        hudCtx.font = 'Italic 13px Georgia';
        hudCtx.fillText(`Pensiero corrente: "${state.thought}"`, 25, 118);
    }
}
// =====================================================
// WEBSOCKET ADAPTER — RECONNECT AUTOMATICO
// =====================================================
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

function connectWebSocket() {
    const ws = new WebSocket(`${wsProtocol}//${location.hostname}:1880/gaia`);

    ws.onmessage = (event) => {
        try {
            const rawData = JSON.parse(event.data);

            // ThreeViewEngineGAME invia sempre il payload completo
            state = rawData;

            // Level up / cambio archetipo RPG
            if (state.progression) {
                if (state.progression.level > lastLevel) {
                    triggerLevelUpVFX();
                    lastLevel = state.progression.level;
                }
                if (state.progression.activeClass !== lastClass) {
                    lastClass = state.progression.activeClass;
                    keyLight.intensity = 5.0;
                }
                syncUnlockedAssets();
            }

            // Onda sonar su nuovo pensiero
            if (state.thought && state.thought !== lastThought) {
                sonarActive = true;
                sonarScale = 1.0;
                if (state.progression?.activeClass === "Mago")   sonarMat.color.setHex(0x00ffff);
                else if (state.progression?.activeClass === "Druido") sonarMat.color.setHex(0x33ff88);
                else sonarMat.color.setHex(0x94b3fd);
                lastThought = state.thought;
            }

            // Lampo su eventi istantanei
            if (state.events && state.events.length > 0) {
                keyLight.intensity = 4.5;
            }

            // Normalizza rooms come array
            let roomsList = [];
            if (state.vision?.rooms) {
                roomsList = Array.isArray(state.vision.rooms) ? state.vision.rooms : Object.values(state.vision.rooms);
                state.vision.rooms = roomsList;
            } else if (state.rooms) {
                roomsList = Array.isArray(state.rooms) ? state.rooms : Object.values(state.rooms);
            }

            // Fallback: costruisci people da rooms YOLO se il brain non ha ancora persone nominate
            if (!state.people || state.people.length === 0) {
                state.people = [];
                roomsList.forEach(room => {
                    const count = room.persons_count || 0;
                    for (let i = 0; i < count; i++) {
                        const knownName = room.people?.[i];
                        const name = knownName || `unknown_${room.id}_${i + 1}`;
                        state.people.push({
                            id: `shadow_${room.id}_${i + 1}`,
                            room: room.id,
                            name,
                            present: true,
                            emotion: room.dominant_emotion || 'neutral',
                            gesture: 'none',
                            affinity: knownName ? 75 : 20
                        });
                    }
                });
            }

            parseSensorsAndMetrics();
            updateGarden();
            updateLightGems();
            updateShadows();
            updateRoomMarkers();
            updateYOLOObjects();
            updateHUD();

        } catch (e) { console.warn("WS parse error:", e); }
    };

    ws.onclose = () => {
        setTimeout(connectWebSocket, 3000);
    };
}

connectWebSocket();

// =====================================================
// CICLO DI ANIMAZIONE REATTIVO INTEGRALE (60FPS LERP)
// =====================================================
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();
    const lFactor = 0.08; 

    const currentClass = state.progression?.activeClass || "Neutro";

    // 0. AGGIORNAMENTO DINAMICO AMBIENTE (Meteo Sensoriale + Archetipo RPG)
    // Se GAIA è un "Druido" forziamo lo sfondo verso tonalità biologiche foresta, se è "Mago" verso il blu profondo cyber
    let classBaseColor = new THREE.Color().setHSL(envWeather.ambientHue, 0.4, 0.02);
    if (currentClass === "Druido") classBaseColor.lerp(new THREE.Color(0x011a08), 0.4);
    else if (currentClass === "Mago") classBaseColor.lerp(new THREE.Color(0x00061a), 0.4);
    else if (currentClass === "Guerriero") classBaseColor.lerp(new THREE.Color(0x1a0202), 0.4);

    scene.background.lerp(classBaseColor, lFactor);
    fogEffect.color.copy(scene.background);
    fogEffect.density = THREE.MathUtils.lerp(fogEffect.density, envWeather.targetFogDensity, lFactor);
    
    keyLight.intensity = THREE.MathUtils.lerp(keyLight.intensity, 2.0, 0.05);

    // 1. Cuore Organico Centrale (Modificato in base all'Archetipo RPG attivo)
    const life = state.soul?.lifeIndex || 50;
    const mood = state.soul?.mood || 'neutra';
    const palette = { viva: 0x00ffcc, serena: 0x33ff88, stabile: 0x4477ff, instabile: 0xff9900, sofferente: 0xff3333, neutra: 0x555566 };
    
    let targetHeartColor = new THREE.Color(palette[mood] || palette.neutra);
    
    // Sovrascrittura cromatiche basate sulla classe RPG attiva sul Core
    if (currentClass === "Druido") targetHeartColor.lerp(new THREE.Color(0x22ff66), 0.5);
    else if (currentClass === "Mago") targetHeartColor.lerp(new THREE.Color(0x00ffff), 0.5);
    else if (currentClass === "Guerriero") targetHeartColor.lerp(new THREE.Color(0xff2222), 0.5);
    else if (currentClass === "Bardo") targetHeartColor.lerp(new THREE.Color(0xff00ff), 0.5);

    heartMat.color.lerp(targetHeartColor, lFactor);
    heartMat.emissive.lerp(targetHeartColor.clone().multiplyScalar(0.3), lFactor);
    heartMat.emissiveIntensity = THREE.MathUtils.lerp(heartMat.emissiveIntensity, 0.3 + life / 80, lFactor);
    
    // Il Guerriero fa pulsare il cuore molto più rapidamente / violentemente
    const speedMult = currentClass === "Guerriero" ? 2.5 : 1.0;
    const pulseScale = 0.85 + (life / 220) + Math.sin(elapsedTime * (1.5 + life*0.04) * speedMult) * 0.06;
    heart.scale.setScalar(pulseScale);
    
    // Il Mago fa ruotare il Core geometrico a velocità doppia (Calcolo computazionale)
    const rotSpeed = currentClass === "Mago" ? 2.0 : 1.0;
    heart.rotation.x += 0.004 * rotSpeed; heart.rotation.y += 0.006 * rotSpeed;

    // Rotazione dell'asset sbloccato Scudo se visibile
    if (rpgAssets.shield_dome.visible) {
        rpgAssets.shield_dome.rotation.y -= 0.005;
        rpgAssets.shield_dome.material.opacity = 0.05 + Math.sin(elapsedTime * 2.0) * 0.03;
    }

    // ONDA SONAR DEL PENSIERO AI
    if (sonarActive) {
        sonarScale += 0.15;
        sonarMat.opacity = THREE.MathUtils.mapLinear(sonarScale, 1.0, 6.0, 0.6, 0.0);
        sonarWave.scale.setScalar(sonarScale);
        if (sonarScale >= 6.0) {
            sonarActive = false;
            sonarMat.opacity = 0;
        }
    }

    // Particelle del cuore
    const pPositions = heartParticles.geometry.attributes.position.array;
    for (let i = 0; i < heartParticlesCount; i++) {
        const idx = i * 3;
        const speed = heartParticlesSpeed[i] * (0.002 + (life * 0.0001));
        const x = pPositions[idx]; const z = pPositions[idx+2];
        pPositions[idx] = x * Math.cos(speed) - z * Math.sin(speed);
        pPositions[idx+2] = x * Math.sin(speed) + z * Math.cos(speed);
    }
    heartParticles.geometry.attributes.position.needsUpdate = true;
    heartParticles.material.color.lerp(targetHeartColor, lFactor);

    // 2. Nastri Aurora (Regolati dal consumo di Watt reali e alterati dal Bardo)
    const classEnergyVelocity = currentClass === "Bardo" ? envWeather.energyVelocity * 1.8 : envWeather.energyVelocity;
    ribbons.forEach((ribbon) => {
        ribbon.material.opacity = THREE.MathUtils.lerp(ribbon.material.opacity, 0.15 + life / 180, lFactor);
        ribbon.rotation.y += (0.001 + ribbon.userData.index * 0.0006) * classEnergyVelocity;
        ribbon.position.y = Math.sin(elapsedTime * 0.5 + ribbon.userData.index) * 0.12;
    });

    // 3. Giardino/Piante (Il Druido raddoppia l'altezza e la responsività alla vita delle piante)
    const plantScaleMultiplier = currentClass === "Druido" ? 1.6 : 1.0;
    for (const group of plantBlades.values()) {
        group.children.forEach(blade => {
            if(group.userData.targetColor) blade.material.color.lerp(group.userData.targetColor, lFactor);
            if(group.userData.targetColor) blade.material.emissive.lerp(group.userData.targetColor.clone().multiplyScalar(0.2), lFactor);
            blade.scale.y = THREE.MathUtils.lerp(blade.scale.y, (group.userData.targetScaleY || 1) * plantScaleMultiplier, lFactor);
            blade.rotation.x = Math.sin(elapsedTime * 1.2 * envWeather.windSpeed + blade.position.x) * 0.08;
        });
    }

    // 4. Gemme di Luce
    for (const gem of lightGems.values()) {
        if(gem.userData.targetColor) gem.material.color.lerp(gem.userData.targetColor, lFactor);
        if(gem.userData.targetColor) gem.material.emissive.lerp(gem.userData.targetColor, lFactor);
        gem.material.emissiveIntensity = THREE.MathUtils.lerp(gem.material.emissiveIntensity, gem.userData.emissiveIntensity || 1, lFactor);
        const s = THREE.MathUtils.lerp(gem.scale.x, gem.userData.targetScale || 1, lFactor); gem.scale.setScalar(s);
        gem.position.y = Math.sin(elapsedTime * 1.5 + gem.userData.floatPhase) * 0.22 + 0.1;
        gem.rotation.x += 0.015; gem.rotation.y += 0.02;
    }

    // 5. Ombre Umane e MediaPipe Confix (Il Bardo espande l'Aura energetica delle persone)
    const auraScaleMultiplier = currentClass === "Bardo" ? 2.0 : 1.0;
    for (const group of shadowFigures.values()) {
        const ud = group.userData;
        group.userData.body.material.color.lerp(ud.targetColor, lFactor);
        group.userData.aura.material.color.lerp(ud.targetColor, lFactor);
        ud.angle += 0.004 * ud.floatSpeed;
        const cx = ud.orbitCenterX || 0; const cz = ud.orbitCenterZ || 0;
        const distFromCenter = Math.sqrt((group.position.x - cx) ** 2 + (group.position.z - cz) ** 2);
        const radius = THREE.MathUtils.lerp(distFromCenter, ud.targetRadius || 4, lFactor);
        const targetX = cx + Math.cos(ud.angle) * radius; const targetZ = cz + Math.sin(ud.angle) * radius;
        let targetY = Math.sin(elapsedTime * 1.8 * ud.floatSpeed) * 0.15;
        if(ud.jitter > 0) targetY += (Math.random() - 0.5) * ud.jitter;
        group.position.set(THREE.MathUtils.lerp(group.position.x, targetX, lFactor), THREE.MathUtils.lerp(group.position.y, targetY, lFactor), THREE.MathUtils.lerp(group.position.z, targetZ, lFactor));
        ud.aura.rotation.z += 0.01; ud.aura.scale.setScalar((1.0 + Math.sin(elapsedTime * 3.0 * ud.floatSpeed) * 0.12) * auraScaleMultiplier);
        ud.labelSprite.lookAt(camera.position);
    }

    // 6. Stanze e YOLO
    for (const marker of roomMarkers.values()) {
        const ts = THREE.MathUtils.lerp(marker.scale.x, marker.userData.targetScale || 1, lFactor);
        marker.scale.set(ts, ts, 1); marker.rotation.z += 0.002;
    }
    for (const mesh of yoloObjects.values()) { if(mesh.userData.targetColor) mesh.material.color.lerp(mesh.userData.targetColor, lFactor); mesh.rotation.y += 0.01; }

    // 7. Particelle Gestuali MediaPipe
    const gPositions = gestureParticles.geometry.attributes.position.array;
    for(let i=0; i<gestureParticleCount; i++) {
        if(gestureData[i].active) {
            gestureData[i].age++; gPositions[i*3] += gestureData[i].velocity.x; gPositions[i*3+1] += gestureData[i].velocity.y; gPositions[i*3+2] += gestureData[i].velocity.z;
            gestureData[i].velocity.y -= 0.001; 
            if(gestureData[i].age >= gestureData[i].life) { gestureData[i].active = false; gPositions[i*3] = 9999; gPositions[i*3+1] = 9999; gPositions[i*3+2] = 9999; }
        }
    }
    gestureParticles.geometry.attributes.position.needsUpdate = true;

    // 8. Regia Automatica Cinematica
    camera.position.x = Math.sin(elapsedTime * 0.06) * 1.8;
    camera.position.z = 7.0 + Math.cos(elapsedTime * 0.04) * 0.8;
    camera.lookAt(0, 0.6, 0);

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); hudCanvas.width = window.innerWidth; updateHUD();
});

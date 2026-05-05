import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as Tone from 'tone';

const LEVELS = [
  { name: 'Pradera Encantada', timeLimit: 80, cats: 4, sky: '#b7e8ff', fog: '#dff7ff', ground: '#b9f2a1', difficulty: 1 },
  { name: 'Bosque Místico', timeLimit: 75, cats: 5, sky: '#9ed9c2', fog: '#c8f0df', ground: '#7fcf97', difficulty: 1.2 },
  { name: 'Atardecer Mágico', timeLimit: 70, cats: 6, sky: '#ffb7a0', fog: '#ffd4b5', ground: '#e8b47f', difficulty: 1.4 },
  { name: 'Noche Estrellada', timeLimit: 65, cats: 7, sky: '#2b2d7f', fog: '#4f529c', ground: '#47537f', difficulty: 1.7 }
];

const CAT_NAMES = ['Luna', 'Mochi', 'Nube', 'Pelusa', 'Estrella', 'Miel', 'Kiki', 'Pompón', 'Sushi', 'Cosmo'];
const PLAYER_SPEED = 0.2;
const CATCH_DISTANCE = 4.0;
const MOBILE_LOOK_SENSITIVITY = 0.004;
const safeRead = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

// Camera looks toward -Z when yaw = 0, so forward is -cos on Z.
function getMovementVector(playerYaw, forwardInput, rightInput) {
  const forwardX = -Math.sin(playerYaw);
  const forwardZ = -Math.cos(playerYaw);
  const rightX = Math.cos(playerYaw);
  const rightZ = -Math.sin(playerYaw);
  return { x: forwardInput * forwardX + rightInput * rightX, z: forwardInput * forwardZ + rightInput * rightZ };
}

export default function CatHunt3D() {
  const [screen, setScreen] = useState('menu');
  const [levelIndex, setLevelIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => safeRead('cat-hunt-best-score', 0));
  const [mute, setMute] = useState(() => safeRead('cat-hunt-mute', false));
  const [discoveredCats, setDiscoveredCats] = useState(() => safeRead('cat-hunt-discovered-cats', []));
  const [timeLeft, setTimeLeft] = useState(LEVELS[0].timeLimit);
  const [found, setFound] = useState(0);
  const [hint, setHint] = useState('Busca gatitos mágicos...');
  const [toast, setToast] = useState('');
  const [paused, setPaused] = useState(false);
  const mountRef = useRef(null);
  const gameRef = useRef(null);
  const timerRef = useRef(null);
  const touchState = useRef({ joy: { active: false, pointerId: null, x: 0, y: 0 }, look: { active: false, pointerId: null, lastX: 0, lastY: 0, dx: 0, dy: 0 } });
  const audioRef = useRef({ started: false, meow: null, success: null });

  const isMobile = useMemo(() => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent), []);
  useEffect(() => { localStorage.setItem('cat-hunt-best-score', JSON.stringify(bestScore)); }, [bestScore]);
  useEffect(() => { localStorage.setItem('cat-hunt-mute', JSON.stringify(mute)); Tone.Destination.mute = mute; }, [mute]);
  useEffect(() => { localStorage.setItem('cat-hunt-discovered-cats', JSON.stringify(discoveredCats)); }, [discoveredCats]);

  const initAudio = useCallback(async () => {
    if (audioRef.current.started) return;
    try {
      await Tone.start();
      audioRef.current.meow = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.01, release: 0.2 } }).toDestination();
      audioRef.current.success = new Tone.PolySynth(Tone.Synth).toDestination();
      audioRef.current.started = true;
    } catch {}
  }, []);

  const stopGame = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const g = gameRef.current;
    if (!g) return;
    g.running = false;
    if (g.rafId) cancelAnimationFrame(g.rafId);
    window.removeEventListener('resize', g.onResize);
    window.removeEventListener('keydown', g.onKeyDown);
    window.removeEventListener('keyup', g.onKeyUp);
    window.removeEventListener('mousemove', g.onMouseMove);
    window.removeEventListener('click', g.onClick);
    window.removeEventListener('pointerlockchange', g.onPointerLockChange);
    g.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) Array.isArray(obj.material) ? obj.material.forEach((m) => m.dispose()) : obj.material.dispose();
    });
    g.renderer.dispose();
    g.renderer.domElement?.remove();
    gameRef.current = null;
    setPaused(false);
  }, []);

  const setupLevel = useCallback((idx) => {
    const mount = mountRef.current; if (!mount) return;
    stopGame(); mount.innerHTML = '';
    const level = LEVELS[idx];
    setTimeLeft(level.timeLimit); setFound(0); setHint('Busca a los michi perdidos...'); setPaused(false);

    const scene = new THREE.Scene(); scene.background = new THREE.Color(level.sky); scene.fog = new THREE.Fog(level.fog, 8, 75);
    const camera = new THREE.PerspectiveCamera(72, mount.clientWidth / mount.clientHeight, 0.1, 200); camera.position.set(0, 1.7, 5);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(mount.clientWidth, mount.clientHeight); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35)); mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8866aa, 1.25)); const sun = new THREE.DirectionalLight(0xfff3e0, 0.62); sun.position.set(8, 12, 5); scene.add(sun);
    const toonGroundMat = new THREE.MeshToonMaterial({ color: level.ground });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(55, 24), toonGroundMat); floor.rotation.x = -Math.PI / 2; scene.add(floor);

    const obstacles = [];
    const place = (mesh) => { scene.add(mesh); obstacles.push(mesh.position.clone()); };
    for (let i = 0; i < 24; i += 1) { const t = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6), new THREE.MeshLambertMaterial({ color: '#8d5a3b' })); trunk.position.y = 0.75; const top = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), new THREE.MeshLambertMaterial({ color: i % 2 ? '#78c67c' : '#65b06c' })); top.position.y = 1.9; t.add(trunk, top); t.position.set((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80); place(t); }
    for (let i = 0; i < 18; i += 1) { const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45 + Math.random() * 0.5), new THREE.MeshToonMaterial({ color: '#9aa2b8' })); rock.position.set((Math.random() - 0.5) * 85, 0.3, (Math.random() - 0.5) * 85); place(rock); }
    const flowerColors = ["#ff84c6","#ffdf6f","#94f7a8","#8ed8ff","#c2a3ff"];
    for (let i = 0; i < 80; i += 1) { const f = new THREE.Group(); const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.02,0.25,5), new THREE.MeshToonMaterial({ color: "#6fcf76" })); stem.position.y = 0.12; const petal = new THREE.Mesh(new THREE.SphereGeometry(0.06,6,6), new THREE.MeshToonMaterial({ color: flowerColors[i % flowerColors.length] })); petal.position.y = 0.28; f.add(stem, petal); f.position.set((Math.random()-0.5)*92,0,(Math.random()-0.5)*92); scene.add(f); }
    for (let i = 0; i < 24; i += 1) { const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45 + Math.random()*0.35,8,8), new THREE.MeshToonMaterial({ color: i % 2 ? "#72c07f" : "#89d49a" })); bush.position.set((Math.random()-0.5)*84,0.35,(Math.random()-0.5)*84); scene.add(bush); obstacles.push(bush.position.clone()); }
    if (idx === 3) { const moon = new THREE.Mesh(new THREE.SphereGeometry(2.2,16,16), new THREE.MeshBasicMaterial({ color: "#fff3c4" })); moon.position.set(-20,24,-30); scene.add(moon); for (let i=0;i<120;i+=1){ const star = new THREE.Mesh(new THREE.SphereGeometry(0.12,4,4), new THREE.MeshBasicMaterial({ color: i%2?"#ffffff":"#ffd6ff" })); star.position.set((Math.random()-0.5)*80,12+Math.random()*28,(Math.random()-0.5)*80); scene.add(star);} }


    const makeCat = (id, name) => {
      const g = new THREE.Group();
      const catPalette = ['#ffc4dc','#ffe9bf','#ffe58c','#d9ccff','#bde5ff','#bdf4d8','#ffd4bf','#fffdfd','#cfae93','#d9dce5'];
      const m = new THREE.MeshToonMaterial({ color: catPalette[(id + idx) % catPalette.length] });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.55, 4, 8), m); body.rotation.z = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), m); head.position.set(0.45, 0.15, 0);
      g.add(body, head);
      [0.15, -0.15].forEach((z) => { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 6), m); ear.position.set(0.35, 0.45, z); g.add(ear); });
      const eyeM = new THREE.MeshBasicMaterial({ color: '#222' });
      const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeM); eye1.position.set(0.62, 0.18, 0.11);
      const eye2 = eye1.clone(); eye2.position.z = -0.11;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color: '#ff6b9d' })); nose.position.set(0.7, 0.11, 0);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.45, 6), m); tail.position.set(-0.45, 0.2, 0); tail.rotation.z = 0.8;
      const eyeShine1 = new THREE.Mesh(new THREE.SphereGeometry(0.012,6,6), new THREE.MeshBasicMaterial({ color: "#fff" })); eyeShine1.position.set(0.635,0.195,0.12);
      const eyeShine2 = eyeShine1.clone(); eyeShine2.position.z = -0.12;
      const blushMat = new THREE.MeshBasicMaterial({ color: "#ffb2c9" });
      const blush1 = new THREE.Mesh(new THREE.SphereGeometry(0.04,7,7), blushMat); blush1.position.set(0.64,0.1,0.2);
      const blush2 = blush1.clone(); blush2.position.z = -0.2;
      const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035,0.008,6,10,Math.PI), new THREE.MeshBasicMaterial({ color: "#8a4d64" })); mouth.position.set(0.71,0.065,0); mouth.rotation.z = Math.PI; mouth.rotation.y = Math.PI/2;
      const whiskerMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
      [-0.05,0,0.05].forEach((wy)=>{const w1=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.005,0.005), whiskerMat); w1.position.set(0.67,0.1+wy,0.2); const w2=w1.clone(); w2.position.z=-0.2; g.add(w1,w2);});
      g.add(eye1, eye2, eyeShine1, eyeShine2, nose, mouth, blush1, blush2, tail);
      if ((id + idx) % 3 === 0) { const bow = new THREE.Mesh(new THREE.SphereGeometry(0.07,8,8), new THREE.MeshBasicMaterial({ color: "#ff74b8" })); bow.position.set(0.5,0.42,0.18); g.add(bow); }
      for (let i = 0; i < 4; i += 1) { const paw = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 6), m); paw.position.set(i < 2 ? 0.2 : -0.2, -0.18, i % 2 ? 0.14 : -0.14); g.add(paw); }
      g.userData = { ...g.userData, id, name, found: false, float: Math.random() * Math.PI * 2 };
      return g;
    };

    const isFar = (x, z) => obstacles.every((p) => Math.hypot(p.x - x, p.z - z) > 2.2);
    const cats = Array.from({ length: level.cats }, (_, i) => {
      let x = 0; let z = 0;
      for (let t = 0; t < 40; t += 1) { x = (Math.random() - 0.5) * 70; z = (Math.random() - 0.5) * 70; if (isFar(x, z)) break; }
      const cat = makeCat(i, CAT_NAMES[(idx * 3 + i) % CAT_NAMES.length]);
      cat.position.set(x, 0.4, z); cat.rotation.y = Math.random() * Math.PI * 2; scene.add(cat);
      return cat;
    });

    const keys = {}; const state = { yaw: 0, pitch: 0, pointerLocked: false };
    const collides = (x, z) => obstacles.some((p) => Math.hypot(p.x - x, p.z - z) < 1.2);

    const tryCatchCat = () => {
      if (paused) return;
      let best = null; let bestDist = Infinity;
      cats.forEach((cat) => {
          const rb = cat.userData.rainbow;
          if (rb?.mesh) { const t = (performance.now() - rb.born) / 850; rb.mesh.scale.setScalar(1 + t * 2.2); rb.mesh.position.y += 0.01; rb.mesh.children.forEach((ch, i) => { ch.material.opacity = Math.max(0, 0.9 - t - i * 0.05); }); if (t > 1) { scene.remove(rb.mesh); rb.mesh.traverse((o)=>{ if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); cat.userData.rainbow = null; } } if (cat.userData.found) return; const d = camera.position.distanceTo(cat.position); if (d < bestDist) { bestDist = d; best = cat; } });
      if (best && bestDist < CATCH_DISTANCE) {
        best.userData.found = true;
        setDiscoveredCats((prev) => (prev.includes(best.userData.name) ? prev : [...prev, best.userData.name]));
        setScore((s) => s + Math.max(60, Math.floor(170 - bestDist * 20)));
        setFound((f) => f + 1);
        setToast(`¡Atrapaste a ${best.userData.name}!`);
        const ringGroup = new THREE.Group();
        const rainbow = ["#ff4d79","#ffa84d","#ffe066","#7ee081","#66d4ff","#9a8bff"];
        rainbow.forEach((c, i) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2 + i * 0.07, 0.015, 6, 20), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })); ring.rotation.x = Math.PI / 2; ringGroup.add(ring); });
        ringGroup.position.copy(best.position);
        scene.add(ringGroup);
        best.userData.rainbow = { mesh: ringGroup, born: performance.now() };
        if (audioRef.current.success && !mute) audioRef.current.success.triggerAttackRelease(['C5', 'E5', 'G5'], '8n');
      }
    };

    const onKeyDown = (e) => { keys[e.key.toLowerCase()] = true; if (e.code === 'Space') { e.preventDefault(); tryCatchCat(); } };
    const onKeyUp = (e) => { keys[e.key.toLowerCase()] = false; };
    const onMouseMove = (e) => {
      if (!state.pointerLocked || isMobile || paused) return;
      state.yaw -= e.movementX * 0.0023;
      state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - e.movementY * 0.0023));
    };
    const onClick = (e) => {
      if (paused) return;
      if (!isMobile && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
      else if (!isMobile && state.pointerLocked) { e?.preventDefault?.(); tryCatchCat(); }
    };
    const onPointerLockChange = () => { state.pointerLocked = document.pointerLockElement === renderer.domElement; };
    const onResize = () => { if (!mountRef.current) return; camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight); };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('mousemove', onMouseMove); window.addEventListener('click', onClick); window.addEventListener('pointerlockchange', onPointerLockChange); window.addEventListener('resize', onResize);
    gameRef.current = { scene, camera, renderer, onResize, onKeyDown, onKeyUp, onMouseMove, onClick, onPointerLockChange, running: true, rafId: 0, tryCatchCat, state };

    const animate = () => {
      if (!gameRef.current?.running) return;
      if (!paused) {
        const joy = touchState.current.joy;
        const look = touchState.current.look;
        state.yaw -= look.dx * MOBILE_LOOK_SENSITIVITY;
        state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - look.dy * MOBILE_LOOK_SENSITIVITY));
        look.dx = 0; look.dy = 0;

        const keyboardForward = (keys.w || keys.arrowup ? 1 : 0) + (keys.s || keys.arrowdown ? -1 : 0);
        const keyboardRight = (keys.d || keys.arrowright ? 1 : 0) + (keys.a || keys.arrowleft ? -1 : 0);
        const forwardInputRaw = keyboardForward + joy.y;
        const rightInputRaw = keyboardRight + joy.x;
        const inputLen = Math.hypot(forwardInputRaw, rightInputRaw);
        const forwardInput = inputLen > 1 ? forwardInputRaw / inputLen : forwardInputRaw;
        const rightInput = inputLen > 1 ? rightInputRaw / inputLen : rightInputRaw;

        const move = getMovementVector(state.yaw, forwardInput, rightInput);
        const mobileFactor = isMobile ? 0.96 : 1;
        const stepX = move.x * PLAYER_SPEED * level.difficulty * mobileFactor;
        const stepZ = move.z * PLAYER_SPEED * level.difficulty * mobileFactor;
        const nextX = camera.position.x + stepX;
        const nextZ = camera.position.z + stepZ;
        if (!collides(nextX, camera.position.z)) camera.position.x = nextX;
        if (!collides(camera.position.x, nextZ)) camera.position.z = nextZ;

        camera.position.y = 1.7;
        camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');

        let minDist = Infinity;
        cats.forEach((cat) => {
          const rb = cat.userData.rainbow;
          if (rb?.mesh) { const t = (performance.now() - rb.born) / 850; rb.mesh.scale.setScalar(1 + t * 2.2); rb.mesh.position.y += 0.01; rb.mesh.children.forEach((ch, i) => { ch.material.opacity = Math.max(0, 0.9 - t - i * 0.05); }); if (t > 1) { scene.remove(rb.mesh); rb.mesh.traverse((o)=>{ if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); cat.userData.rainbow = null; } }
          if (!cat.userData.found) {
            cat.position.y = 0.4 + Math.sin(performance.now() * 0.003 + cat.userData.float) * 0.06;
            minDist = Math.min(minDist, camera.position.distanceTo(cat.position));
          } else if (cat.visible) {
            cat.position.y += 0.05;
            cat.scale.multiplyScalar(0.97);
            if (cat.scale.x < 0.1) cat.visible = false;
          }
        });
        if (minDist < 2.2) setHint('¡Aquí mismo!'); else if (minDist < 5.5) setHint('Muy cerca...'); else if (minDist < 10) setHint('Escucho un maullido...'); else setHint('Explora la zona');
        if (minDist < 7 && audioRef.current.meow && !mute && Math.random() < 0.014) audioRef.current.meow.triggerAttackRelease('A4', '16n');
      }
      renderer.render(scene, camera);
      gameRef.current.rafId = requestAnimationFrame(animate);
    };
    animate();

    timerRef.current = setInterval(() => setTimeLeft((t) => (!paused && screen === 'playing' ? Math.max(t - 1, 0) : t)), 1000);
  }, [isMobile, mute, paused, screen, stopGame]);

  useEffect(() => { if (timeLeft === 0 && screen === 'playing') { setScreen('gameover'); stopGame(); } }, [timeLeft, screen, stopGame]);
  useEffect(() => { if (screen === 'playing' && found >= LEVELS[levelIndex].cats) { const total = score + timeLeft * 10; setScore(total); setBestScore((b) => Math.max(b, total)); stopGame(); setScreen(levelIndex === LEVELS.length - 1 ? 'complete' : 'levelComplete'); } }, [found, levelIndex, score, screen, stopGame, timeLeft]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 1300); return () => clearTimeout(t); }, [toast]);
  useEffect(() => () => stopGame(), [stopGame]);

  const startLevel = async (idx, reset = false) => { await initAudio(); setLevelIndex(idx); if (reset) setScore(0); setScreen('playing'); setTimeout(() => setupLevel(idx), 0); };
  const tryCatchFromUi = () => gameRef.current?.tryCatchCat?.();

  return <div style={{ minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif', background: 'linear-gradient(135deg,#ffd9ee,#d7c4ff,#bde5ff)', color: '#43204f', padding: 'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))' }}>
    {(screen === 'menu' || screen === 'complete' || screen === 'gameover' || screen === 'levelComplete') && <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><div style={cardStyle}><h1 style={{ fontSize: 'clamp(2rem,5vw,3.1rem)' }}>🌈 Sarita y los michi perdidos ✨</h1><p style={{ marginTop: -8, opacity: .9 }}>Una aventura mágica para encontrar a los michi perdidos</p><p><b>Creado por Bernard y Sarita</b></p><p>Mejor puntuación: <b>{bestScore}</b></p>{screen === 'menu' && <button onClick={() => startLevel(0, true)}>Comenzar aventura</button>}{screen === 'gameover' && <><h2>Game Over</h2><button onClick={() => startLevel(levelIndex)}>Reintentar nivel</button><button onClick={() => { setScreen('menu'); stopGame(); }}>Volver al menú</button></>}{screen === 'levelComplete' && <><h2>¡Nivel completado!</h2><button onClick={() => startLevel(levelIndex + 1)}>Siguiente nivel</button></>}{screen === 'complete' && <><h2>Misión completa ✨</h2><p>Puntuación final: {score}</p><button onClick={() => startLevel(0, true)}>Jugar de nuevo</button></>}<section style={{ marginTop: 14 }}><h3>Galería de gatitos</h3><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{discoveredCats.length ? discoveredCats.map((n) => <span key={n} style={tagStyle}>🐱 {n}</span>) : <span style={{ opacity: .7 }}>Aún no has descubierto gatitos.</span>}</div></section></div></div>}

    {screen === 'playing' && <>
      <div ref={mountRef} style={{ position: 'fixed', inset: 0 }} />
      <div style={{ position: 'fixed', top: 12, left: 12, right: 12, display: 'flex', gap: 8, flexWrap: 'wrap', zIndex: 20 }}><div style={pill}>Nivel: {LEVELS[levelIndex].name}</div><div style={pill}>Gatos: {found}/{LEVELS[levelIndex].cats}</div><div style={pill}>Tiempo: {timeLeft}s</div><div style={pill}>Score: {score}</div><button style={pillBtn} onClick={() => setMute((m) => !m)}>{mute ? '🔇' : '🔊'}</button><button style={pillBtn} onClick={() => setPaused((p) => !p)}>{paused ? '▶️' : '⏸️'}</button><button style={pillBtn} onClick={() => { setScreen('menu'); stopGame(); }}>🏠</button></div>
      {!isMobile && !gameRef.current?.state?.pointerLocked && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 22, background: 'rgba(0,0,0,.5)', color: '#fff', borderRadius: 999, padding: '8px 14px' }}>Click para activar cámara · Espacio para atrapar</div>}
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', fontSize: 28, color: 'white', textShadow: '0 1px 5px #000' }}>+</div>
      <div style={{ position: 'fixed', bottom: 18, left: 0, right: 0, textAlign: 'center', color: 'white', fontWeight: 700, textShadow: '0 2px 6px #000', zIndex: 18 }}>{hint}</div>
      {toast && <div style={{ position: 'fixed', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', color: '#fff', background: 'rgba(255,86,152,.86)', padding: '10px 14px', borderRadius: 999, zIndex: 22 }}>{toast}</div>}
      {paused && <div style={{ position: 'fixed', inset: 0, background: 'rgba(25,16,45,.58)', display: 'grid', placeItems: 'center', zIndex: 30 }}><div style={{ ...cardStyle, width: 'min(500px,92vw)' }}><h2>Juego en pausa</h2><button onClick={() => setPaused(false)}>Continuar</button><button onClick={() => startLevel(levelIndex)}>Reiniciar nivel</button><button onClick={() => { setScreen('menu'); stopGame(); }}>Menú</button></div></div>}
      {isMobile && !paused && <MobileControls touchState={touchState} onCatch={tryCatchFromUi} />}
      {!isMobile && !paused && <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); tryCatchFromUi(); }} style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 25 }}>Atrapar 🐱</button>}
    </>}

    <style>{`button{border:0;background:linear-gradient(135deg,#ff6b9d,#b66dff);color:#fff;padding:12px 18px;border-radius:999px;font-weight:700;cursor:pointer;margin:6px 8px 0 0;-webkit-tap-highlight-color:transparent} button:focus{outline:none} canvas{display:block;background:transparent} .clean-ui{background:transparent}`}</style>
  </div>;
}

const cardStyle = { width: 'min(700px,95vw)', borderRadius: 24, padding: 28, backdropFilter: 'blur(10px)', background: 'rgba(255,255,255,.55)', boxShadow: '0 12px 30px rgba(84,47,98,.2)' };
const pill = { background: 'rgba(255,255,255,.72)', borderRadius: 999, padding: '8px 12px', backdropFilter: 'blur(6px)', fontWeight: 700 };
const pillBtn = { ...pill, border: 0 };
const tagStyle = { background: 'rgba(255,255,255,.75)', padding: '6px 10px', borderRadius: 999, fontWeight: 600 };

function MobileControls({ touchState, onCatch }) {
  const joyRef = useRef(null);
  const lookRef = useRef(null);

  const joyDown = (event) => {
    event.preventDefault(); event.stopPropagation();
    joyRef.current?.setPointerCapture?.(event.pointerId);
    touchState.current.joy.active = true;
    touchState.current.joy.pointerId = event.pointerId;
  };
  const joyMove = (event) => {
    const joy = touchState.current.joy;
    if (!joy.active || joy.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const rect = joyRef.current.getBoundingClientRect();
    const dx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const dy = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    const length = Math.hypot(dx, dy) || 1;
    const nx = length > 1 ? dx / length : dx;
    const ny = length > 1 ? dy / length : dy;
    joy.x = nx;
    joy.y = -ny; // up on screen => positive forward input
  };
  const joyUp = (event) => {
    event.preventDefault(); event.stopPropagation();
    const joy = touchState.current.joy;
    if (joy.pointerId !== event.pointerId) return;
    joyRef.current?.releasePointerCapture?.(event.pointerId);
    joy.active = false;
    joy.pointerId = null;
    joy.x = 0;
    joy.y = 0;
  };

  const lookDown = (event) => {
    event.preventDefault(); event.stopPropagation();
    lookRef.current?.setPointerCapture?.(event.pointerId);
    const look = touchState.current.look;
    look.active = true; look.pointerId = event.pointerId; look.lastX = event.clientX; look.lastY = event.clientY;
  };
  const lookMove = (event) => {
    const look = touchState.current.look;
    if (!look.active || look.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    look.dx += event.clientX - look.lastX;
    look.dy += event.clientY - look.lastY;
    look.lastX = event.clientX; look.lastY = event.clientY;
  };
  const lookUp = (event) => {
    event.preventDefault(); event.stopPropagation();
    const look = touchState.current.look;
    if (look.pointerId !== event.pointerId) return;
    lookRef.current?.releasePointerCapture?.(event.pointerId);
    look.active = false; look.pointerId = null; look.dx = 0; look.dy = 0;
  };

  return <>
    <div
      ref={joyRef}
      onPointerDown={joyDown}
      onPointerMove={joyMove}
      onPointerUp={joyUp}
      onPointerCancel={joyUp}
      style={{ position: 'fixed', left: 16, bottom: 16, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,.25)', border: '2px solid rgba(255,255,255,.8)', zIndex: 40, touchAction: 'none' }}
    />
    <div
      ref={lookRef}
      onPointerDown={lookDown}
      onPointerMove={lookMove}
      onPointerUp={lookUp}
      onPointerCancel={lookUp}
      style={{ position: 'fixed', right: 16, top: 88, width: '50vw', height: '50vh', borderRadius: 16, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.35)', zIndex: 12, touchAction: 'none' }}
    />
    <button
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onCatch(); }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onCatch(); }}
      style={{ position: 'fixed', right: 30, bottom: 30, width: 74, height: 74, borderRadius: '50%', zIndex: 50 }}
    >🐱</button>
  </>;
}

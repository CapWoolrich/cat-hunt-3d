import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as Tone from 'tone';

const GAME_TITLE = 'Sarita y los michi perdidos';
const SUBTITLE = 'Una aventura mágica para rescatar gatitos perdidos';
const LEVEL_STORY = [
  'Los primeros michis se escondieron en la pradera encantada.',
  'El bosque místico guarda sonidos suaves entre los árboles.',
  'El atardecer mágico ilumina las huellas de los michis.',
  'Bajo la noche estrellada, los últimos michis esperan ser encontrados.'
];
const LEVELS = [
  { name: 'Pradera Encantada', timeLimit: 80, cats: 4, sky: '#b7e8ff', fog: '#dff7ff', ground: '#b9f2a1', difficulty: 1 },
  { name: 'Bosque Místico', timeLimit: 75, cats: 5, sky: '#9ed9c2', fog: '#c8f0df', ground: '#7fcf97', difficulty: 1.2 },
  { name: 'Atardecer Mágico', timeLimit: 70, cats: 6, sky: '#ffb7a0', fog: '#ffd4b5', ground: '#e8b47f', difficulty: 1.4 },
  { name: 'Noche Estrellada', timeLimit: 65, cats: 7, sky: '#2b2d7f', fog: '#4f529c', ground: '#47537f', difficulty: 1.7 }
];
const MICHI_PROFILES = [
  { id: 'mochi', name: 'Mochi', color: '#ff8fa3', personality: 'Dulce y dormilón', phrase: 'Ama las flores mágicas', level: 1 },
  { id: 'luna', name: 'Luna', color: '#b8ccff', personality: 'Curiosa y brillante', phrase: 'Persigue destellos de luna', level: 1 },
  { id: 'kiki', name: 'Kiki', color: '#ffd36e', personality: 'Juguetona y feliz', phrase: 'Salta entre honguitos', level: 2 },
  { id: 'yuki', name: 'Yuki', color: '#ffffff', personality: 'Suave y tranquila', phrase: 'Le encanta la neblina', level: 2 },
  { id: 'sakura', name: 'Sakura', color: '#ffb8dc', personality: 'Cariñosa y elegante', phrase: 'Colecciona pétalos', level: 3 },
  { id: 'niko', name: 'Niko', color: '#bdf4d8', personality: 'Valiente y veloz', phrase: 'Explora senderos secretos', level: 3 },
  { id: 'tofu', name: 'Tofu', color: '#d9dce5', personality: 'Calmado y tierno', phrase: 'Duerme bajo las estrellas', level: 4 },
  { id: 'chispa', name: 'Chispa', color: '#ffa46b', personality: 'Traviesa y luminosa', phrase: 'Deja huellas brillantes', level: 4 }
];
const PLAYER_SPEED = 0.2;
const CATCH_DISTANCE = 4;
const safeRead = (k, f) => { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } };
const getMovementVector = (yaw, fwd, right) => ({ x: fwd * -Math.sin(yaw) + right * Math.cos(yaw), z: fwd * -Math.cos(yaw) + right * -Math.sin(yaw) });

export default function CatHunt3D() {
  const [screen, setScreen] = useState('menu');
  const [levelIndex, setLevelIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => safeRead('bestScore', 0));
  const [mute, setMute] = useState(() => safeRead('mute', false));
  const [rescuedMichis, setRescuedMichis] = useState(() => safeRead('rescuedMichis', []));
  const [maxUnlockedLevel, setMaxUnlockedLevel] = useState(() => safeRead('maxUnlockedLevel', 0));
  const [completedLevels, setCompletedLevels] = useState(() => safeRead('completedLevels', []));
  const [achievements, setAchievements] = useState(() => safeRead('achievements', []));
  const [achievementToast, setAchievementToast] = useState('');
  const [timeLeft, setTimeLeft] = useState(LEVELS[0].timeLimit);
  const [found, setFound] = useState(0);
  const [hint, setHint] = useState('Busca a los michi perdidos...');
  const [toast, setToast] = useState('');
  const [paused, setPaused] = useState(false);
  const [lastFoundProfiles, setLastFoundProfiles] = useState([]);
  const [settings, setSettings] = useState(() => safeRead('settings', { look: 'media', quality: 'normal' }));
  const mountRef = useRef(null); const gameRef = useRef(null); const timerRef = useRef(null);
  const touchState = useRef({ joy: { active: false, pointerId: null, x: 0, y: 0 }, look: { active: false, pointerId: null, lastX: 0, lastY: 0, dx: 0, dy: 0 } });
  const audioRef = useRef({ started: false, meow: null, success: null });
  const isMobile = useMemo(() => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent), []);

  useEffect(() => localStorage.setItem('bestScore', JSON.stringify(bestScore)), [bestScore]);
  useEffect(() => { localStorage.setItem('mute', JSON.stringify(mute)); Tone.Destination.mute = mute; }, [mute]);
  useEffect(() => localStorage.setItem('rescuedMichis', JSON.stringify(rescuedMichis)), [rescuedMichis]);
  useEffect(() => localStorage.setItem('maxUnlockedLevel', JSON.stringify(maxUnlockedLevel)), [maxUnlockedLevel]);
  useEffect(() => localStorage.setItem('completedLevels', JSON.stringify(completedLevels)), [completedLevels]);
  useEffect(() => localStorage.setItem('achievements', JSON.stringify(achievements)), [achievements]);
  useEffect(() => localStorage.setItem('settings', JSON.stringify(settings)), [settings]);

  const unlockAchievement = (id, title) => { if (!achievements.includes(id)) { setAchievements((a) => [...a, id]); setAchievementToast(`🏆 Logro desbloqueado: ${title}`); } };
  useEffect(() => { if (!achievementToast) return; const t = setTimeout(() => setAchievementToast(''), 2200); return () => clearTimeout(t); }, [achievementToast]);

  const stopGame = useCallback(() => { if (timerRef.current) clearInterval(timerRef.current); const g = gameRef.current; if (!g) return; g.running = false; if (g.rafId) cancelAnimationFrame(g.rafId); window.removeEventListener('resize', g.onResize); window.removeEventListener('keydown', g.onKeyDown); window.removeEventListener('keyup', g.onKeyUp); window.removeEventListener('mousemove', g.onMouseMove); window.removeEventListener('click', g.onClick); window.removeEventListener('pointerlockchange', g.onPointerLockChange); g.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) Array.isArray(o.material) ? o.material.forEach((m) => m.dispose()) : o.material.dispose(); }); g.renderer.dispose(); g.renderer.domElement?.remove(); gameRef.current = null; }, []);
  useEffect(() => () => stopGame(), [stopGame]);

  const initAudio = useCallback(async () => { if (audioRef.current.started) return; try { await Tone.start(); audioRef.current.meow = new Tone.Synth().toDestination(); audioRef.current.success = new Tone.PolySynth(Tone.Synth).toDestination(); audioRef.current.started = true; } catch {} }, []);

  const setupLevel = useCallback((idx) => {
    const mount = mountRef.current; if (!mount) return; stopGame(); mount.innerHTML = '';
    const level = LEVELS[idx]; setTimeLeft(level.timeLimit); setFound(0); setLastFoundProfiles([]);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(level.sky); scene.fog = new THREE.Fog(level.fog, 8, 75);
    const camera = new THREE.PerspectiveCamera(72, mount.clientWidth / mount.clientHeight, 0.1, 200); camera.position.set(0, 1.7, 5);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const px = settings.quality === 'suave' ? 1 : settings.quality === 'bonita' ? 1.35 : 1.2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, px)); renderer.setSize(mount.clientWidth, mount.clientHeight); mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8866aa, 1.2)); const sun = new THREE.DirectionalLight(0xfff3e0, 0.6); sun.position.set(8, 12, 5); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(55, 24), new THREE.MeshToonMaterial({ color: level.ground })); floor.rotation.x = -Math.PI / 2; scene.add(floor);

    const decorCount = settings.quality === 'suave' ? 45 : settings.quality === 'bonita' ? 120 : 80;
    const obstacles = []; const place = (m) => { scene.add(m); obstacles.push(m.position.clone()); };
    for (let i = 0; i < decorCount / 3; i += 1) { const t = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6), new THREE.MeshToonMaterial({ color: '#8d5a3b' })); trunk.position.y = .75; const top = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), new THREE.MeshToonMaterial({ color: i % 2 ? '#78c67c' : '#65b06c' })); top.position.y = 1.9; t.add(trunk, top); t.position.set((Math.random() - .5) * 80, 0, (Math.random() - .5) * 80); place(t); }
    for (let i = 0; i < decorCount / 4; i += 1) { const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45 + Math.random() * .3, 8, 8), new THREE.MeshToonMaterial({ color: i % 2 ? '#72c07f' : '#89d49a' })); bush.position.set((Math.random() - .5) * 84, .35, (Math.random() - .5) * 84); place(bush); }

    const cats = Array.from({ length: level.cats }, (_, i) => {
      const profile = MICHI_PROFILES[(idx * 2 + i) % MICHI_PROFILES.length];
      const g = new THREE.Group(); const m = new THREE.MeshToonMaterial({ color: profile.color });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.35, .55, 4, 8), m); body.rotation.z = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(.33, 12, 12), m); head.position.set(.45, .15, 0);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.04, 8, 8), new THREE.MeshBasicMaterial({ color: '#222' })); eye.position.set(.63, .19, .11); const eye2 = eye.clone(); eye2.position.z = -.11;
      const shine = new THREE.Mesh(new THREE.SphereGeometry(.014, 6, 6), new THREE.MeshBasicMaterial({ color: '#fff' })); shine.position.set(.645, .205, .12); const shine2 = shine.clone(); shine2.position.z = -.12;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(.03, 6, 6), new THREE.MeshBasicMaterial({ color: '#ff6b9d' })); nose.position.set(.71, .1, 0);
      g.add(body, head, eye, eye2, shine, shine2, nose); g.userData = { ...g.userData, profile, found: false, float: Math.random() * 10 };
      let x=0,z=0; for(let t=0;t<30;t+=1){x=(Math.random()-.5)*70;z=(Math.random()-.5)*70; if(obstacles.every((o)=>Math.hypot(o.x-x,o.z-z)>2.2)) break;} g.position.set(x,.4,z); scene.add(g); return g;
    });

    const keys = {}; const state = { yaw: 0, pitch: 0, pointerLocked: false };
    const collides = (x, z) => obstacles.some((p) => Math.hypot(p.x - x, p.z - z) < 1.2);
    const tryCatchCat = () => {
      let best=null, bestDist=Infinity; cats.forEach((c)=>{ if(c.userData.found) return; const d=camera.position.distanceTo(c.position); if(d<bestDist){bestDist=d; best=c;}});
      if (best && bestDist < CATCH_DISTANCE) {
        best.userData.found = true; const p = best.userData.profile; setRescuedMichis((r) => (r.includes(p.id) ? r : [...r, p.id])); setLastFoundProfiles((lf) => [...lf, p]);
        setToast(`¡Rescataste a ${p.name}! · ${p.personality} 🌸`); setFound((f) => f + 1); setScore((s) => s + 120);
        unlockAchievement('first', 'Primer rescate'); if ((rescuedMichis.length + 1) >= 5) unlockAchievement('five', 'Amiga de los michis');
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.35,.03,8,24), new THREE.MeshBasicMaterial({ color:'#ff6b9d', transparent:true, opacity:.9 })); ring.position.copy(best.position); ring.rotation.x=Math.PI/2; scene.add(ring); best.userData.ring=ring; best.userData.ringBorn=performance.now();
        if (audioRef.current.success && !mute) audioRef.current.success.triggerAttackRelease(['C5', 'E5', 'G5'], '8n');
      }
    };

    const onKeyDown = (e) => { keys[e.key.toLowerCase()] = true; if (e.code === 'Space') { e.preventDefault(); tryCatchCat(); } };
    const onKeyUp = (e) => { keys[e.key.toLowerCase()] = false; };
    const onMouseMove = (e) => { if (!state.pointerLocked || isMobile || paused) return; state.yaw -= e.movementX * 0.0023; state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - e.movementY * 0.0023)); };
    const onClick = () => { if (!isMobile && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock(); else if (state.pointerLocked) tryCatchCat(); };
    const onPointerLockChange = () => { state.pointerLocked = document.pointerLockElement === renderer.domElement; };
    const onResize = () => { if (!mountRef.current) return; camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight); };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('mousemove', onMouseMove); window.addEventListener('click', onClick); window.addEventListener('pointerlockchange', onPointerLockChange); window.addEventListener('resize', onResize);
    gameRef.current = { scene, camera, renderer, running: true, tryCatchCat, state, onResize, onKeyDown, onKeyUp, onMouseMove, onClick, onPointerLockChange };

    const animate = () => { if (!gameRef.current?.running) return; if (!paused) {
      const lookScale = settings.look === 'baja' ? 0.0028 : settings.look === 'alta' ? 0.0052 : 0.004;
      const joy = touchState.current.joy; const look = touchState.current.look;
      state.yaw -= look.dx * lookScale; state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - look.dy * lookScale)); look.dx = 0; look.dy = 0;
      const forwardRaw = (keys.w || keys.arrowup ? 1 : 0) + (keys.s || keys.arrowdown ? -1 : 0) + joy.y;
      const rightRaw = (keys.d || keys.arrowright ? 1 : 0) + (keys.a || keys.arrowleft ? -1 : 0) + joy.x;
      const len = Math.hypot(forwardRaw, rightRaw) || 1; const move = getMovementVector(state.yaw, forwardRaw / Math.max(1,len), rightRaw / Math.max(1,len));
      const nx = camera.position.x + move.x * PLAYER_SPEED * (isMobile ? 0.96 : 1); const nz = camera.position.z + move.z * PLAYER_SPEED * (isMobile ? 0.96 : 1);
      if (!collides(nx, camera.position.z)) camera.position.x = nx; if (!collides(camera.position.x, nz)) camera.position.z = nz; camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ'); camera.position.y = 1.7;
      let min=999; cats.forEach((c)=>{ if (!c.userData.found) { c.position.y = .4 + Math.sin(performance.now()*0.003+c.userData.float)*.06; min=Math.min(min, camera.position.distanceTo(c.position)); }
        if (c.userData.ring){const t=(performance.now()-c.userData.ringBorn)/900; c.userData.ring.scale.setScalar(1+t*2.4); c.userData.ring.material.opacity=Math.max(0,.9-t); if(t>1){scene.remove(c.userData.ring); c.userData.ring.geometry.dispose(); c.userData.ring.material.dispose(); c.userData.ring=null;}}
        if (c.userData.found && c.visible){ c.position.y += .04; c.scale.multiplyScalar(.975); if(c.scale.x<.1)c.visible=false; }
      });
      setHint(min < 2.2 ? '¡Aquí mismo!' : min < 5.5 ? 'Muy cerca...' : min < 10 ? 'Escucho un maullido...' : 'Explora la zona');
      if (min < 7 && audioRef.current.meow && !mute && Math.random() < 0.014) audioRef.current.meow.triggerAttackRelease('A4', '16n');
    } renderer.render(scene, camera); gameRef.current.rafId = requestAnimationFrame(animate); };
    animate();
    timerRef.current = setInterval(() => setTimeLeft((t) => (!paused && screen === 'playing' ? Math.max(0, t - 1) : t)), 1000);
  }, [isMobile, mute, paused, rescuedMichis.length, screen, settings, stopGame]);

  useEffect(() => { if (timeLeft === 0 && screen === 'playing') { setScreen('gameover'); stopGame(); } }, [timeLeft, screen, stopGame]);
  useEffect(() => { if (screen === 'playing' && found >= LEVELS[levelIndex].cats) { if (timeLeft > 30) unlockAchievement('fast', 'Rescatista veloz'); const total = score + timeLeft * 10; setScore(total); setBestScore((b) => Math.max(b, total)); setCompletedLevels((c) => [...new Set([...c, levelIndex])]); const next = Math.min(levelIndex + 1, LEVELS.length - 1); setMaxUnlockedLevel((m) => Math.max(m, next)); stopGame(); setScreen(levelIndex === LEVELS.length - 1 ? 'complete' : 'levelComplete'); if (levelIndex === LEVELS.length - 1) unlockAchievement('legend', 'Leyenda estrellada'); } }, [found, levelIndex, score, screen, stopGame, timeLeft]);

  const startLevel = async (idx, reset = false) => { await initAudio(); if (reset) { setScore(0); setLevelIndex(0); } else setLevelIndex(idx); setScreen('playing'); setTimeout(() => setupLevel(reset ? 0 : idx), 0); };

  return <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#ffd9ee,#d7c4ff,#bde5ff)', color: '#43204f', padding: 'max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left))' }}>
    {screen === 'menu' && <MenuScreen onPlay={() => setScreen('story')} onContinue={() => startLevel(maxUnlockedLevel)} hasProgress={maxUnlockedLevel > 0 || score > 0} onOpenCollection={() => setScreen('collection')} onOpenHow={() => setScreen('how')} onOpenCredits={() => setScreen('credits')} onOpenAchievements={() => setScreen('achievements')} mascot={<SaritaMascot />} />}
    {screen === 'story' && <Panel><SaritaMascot /><p>Una tarde mágica, los michis del jardín encantado se perdieron entre flores, árboles y estrellas. Sarita decidió salir a buscarlos uno por uno.</p><button onClick={() => startLevel(0, true)}>Comenzar</button><button onClick={() => startLevel(0, true)}>Saltar</button></Panel>}
    {screen === 'how' && <Panel title='Cómo jugar'><ul><li>📱 Joystick izquierdo: moverte</li><li>📱 Arrastra a la derecha: mirar</li><li>📱 Botón 🌈: rescatar</li><li>🖥️ WASD/Flechas: moverte</li><li>🖥️ Mouse: mirar</li><li>🖥️ Espacio o click: rescatar</li></ul><button onClick={() => setScreen('menu')}>Volver</button></Panel>}
    {screen === 'credits' && <Panel title='Créditos'><SaritaMascot /><p>{GAME_TITLE}</p><p>Creado por Bernard y Sarita</p><p>Una aventura familiar hecha con amor</p><button onClick={() => setScreen('menu')}>Volver</button></Panel>}
    {screen === 'collection' && <MichiCollection rescued={rescuedMichis} onBack={() => setScreen('menu')} />}
    {screen === 'achievements' && <Panel title='Logros'>{['Primer rescate','Rescatista veloz','Amiga de los michis','Leyenda estrellada'].map((t,i)=><div key={t}>{achievements[i]? '✅':'⬜'} {t}</div>)}<button onClick={() => setScreen('menu')}>Volver</button></Panel>}

    {screen === 'playing' && <>
      <div ref={mountRef} style={{ position: 'fixed', inset: 0 }} />
      <div style={{ position: 'fixed', top: 8, left: 8, right: 8, display: 'flex', gap: 8, flexWrap: 'wrap', zIndex: 20 }}><Badge> Nivel: {LEVELS[levelIndex].name}</Badge><Badge>Michis: {found}/{LEVELS[levelIndex].cats}</Badge><Badge>Tiempo: {timeLeft}s</Badge><Badge>Score: {score}</Badge><button onClick={() => setMute((m) => !m)}>{mute ? '🔇' : '🔊'}</button><button onClick={() => setPaused((p) => !p)}>{paused ? '▶️' : '⏸️'}</button><button onClick={() => { setScreen('menu'); stopGame(); }}>🏠</button></div>
      {isMobile && <MobileControls touchState={touchState} onCatch={() => gameRef.current?.tryCatchCat?.()} />}
      {!isMobile && <button onClick={() => gameRef.current?.tryCatchCat?.()} style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 25 }}>🌈 Atrapar</button>}
      <div style={{ position: 'fixed', bottom: 16, left: 0, right: 0, textAlign: 'center', color: '#fff', fontWeight: 700, textShadow: '0 2px 6px #000' }}>{hint}</div>
      {toast && <div style={{ position: 'fixed', top: '45%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 22, background: 'rgba(255,105,173,.9)', color: '#fff', padding: '10px 14px', borderRadius: 999 }}>{toast}</div>}
      {paused && <Panel title='Juego en pausa'><button onClick={() => setPaused(false)}>Continuar</button><button onClick={() => startLevel(levelIndex)}>Reiniciar nivel</button><button onClick={() => { setScreen('menu'); stopGame(); }}>Menú</button></Panel>}
    </>}

    {screen === 'levelComplete' && <Panel title='¡Nivel completado!'><SaritaMascot /><p>{LEVEL_STORY[Math.min(levelIndex + 1, LEVEL_STORY.length - 1)]}</p><p>Encontraste a:</p>{lastFoundProfiles.map((p) => <div key={p.id}>🐱 {p.name} — {p.personality}</div>)}<button onClick={() => startLevel(levelIndex + 1)}>Siguiente nivel</button></Panel>}
    {screen === 'complete' && <Panel title='Misión completa ✨'><SaritaMascot /><p>Puntuación final: {score}</p><button onClick={() => startLevel(0, true)}>Jugar de nuevo</button></Panel>}
    {screen === 'gameover' && <Panel title='Game Over'><button onClick={() => startLevel(levelIndex)}>Reintentar</button><button onClick={() => setScreen('menu')}>Menú</button></Panel>}
    {achievementToast && <div style={{ position: 'fixed', top: 70, right: 12, zIndex: 40, background: 'rgba(255,255,255,.92)', padding: '10px 12px', borderRadius: 12 }}>{achievementToast}</div>}
  </div>;
}

function SaritaMascot() { return <div style={{ width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle,#ffd0ea,#cfa6ff)', display: 'grid', placeItems: 'center', fontSize: 54 }}>🪄</div>; }
function MenuScreen({ onPlay, onContinue, hasProgress, onOpenCollection, onOpenHow, onOpenCredits, onOpenAchievements, mascot }) { return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><div style={{ width: 'min(860px,96vw)', borderRadius: 28, padding: 24, background: 'rgba(255,255,255,.55)', backdropFilter: 'blur(10px)' }}><h1 style={{ fontSize: 'clamp(2rem,5vw,3.3rem)' }}>{GAME_TITLE}</h1><p>{SUBTITLE}</p><div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>{mascot}<div style={{ fontSize: 22 }}>🐱⭐🌈🌸☁️</div></div><p>Creado por Bernard y Sarita</p><button onClick={onPlay}>Comenzar aventura</button>{hasProgress && <button onClick={onContinue}>Continuar aventura</button>}<button onClick={onOpenCollection}>Colección de michis</button><button onClick={onOpenHow}>Cómo jugar</button><button onClick={onOpenCredits}>Créditos</button><button onClick={onOpenAchievements}>Logros</button></div></div>; }
function MichiCollection({ rescued, onBack }) { return <Panel title='Colección de michis'><SaritaMascot /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>{MICHI_PROFILES.map((p) => { const unlocked = rescued.includes(p.id); return <div key={p.id} style={{ borderRadius: 14, padding: 10, background: unlocked ? 'rgba(255,255,255,.8)' : 'rgba(60,60,90,.2)' }}><div style={{ width: 36, height: 36, borderRadius: '50%', background: unlocked ? p.color : '#aaa' }} /> <b>{unlocked ? p.name : '???'}</b><div>{unlocked ? p.personality : 'Michi perdido'}</div><small>Nivel {p.level}</small><div>{unlocked ? p.phrase : 'Rescátalo para conocerlo'}</div></div>; })}</div><button onClick={onBack}>Volver</button></Panel>; }
function Panel({ title, children }) { return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><div style={{ width: 'min(700px,94vw)', borderRadius: 22, padding: 22, background: 'rgba(255,255,255,.65)', backdropFilter: 'blur(10px)' }}>{title && <h2>{title}</h2>}{children}</div></div>; }
function Badge({ children }) { return <div style={{ background: 'rgba(255,255,255,.7)', borderRadius: 999, padding: '8px 12px', fontWeight: 700 }}>{children}</div>; }
function MobileControls({ touchState, onCatch }) { const joyRef = useRef(null); const lookRef = useRef(null);
  const joyDown = (e) => { e.preventDefault(); e.stopPropagation(); joyRef.current?.setPointerCapture?.(e.pointerId); touchState.current.joy.active = true; touchState.current.joy.pointerId = e.pointerId; };
  const joyMove = (e) => { const j = touchState.current.joy; if (!j.active || j.pointerId !== e.pointerId) return; e.preventDefault(); e.stopPropagation(); const r = joyRef.current.getBoundingClientRect(); const dx = ((e.clientX-r.left)/r.width-.5)*2; const dy = ((e.clientY-r.top)/r.height-.5)*2; const l = Math.hypot(dx,dy)||1; j.x = l>1?dx/l:dx; j.y = -(l>1?dy/l:dy); };
  const joyUp = (e) => { e.preventDefault(); e.stopPropagation(); const j = touchState.current.joy; if (j.pointerId !== e.pointerId) return; joyRef.current?.releasePointerCapture?.(e.pointerId); j.active=false; j.pointerId=null; j.x=0; j.y=0; };
  const lookDown = (e) => { e.preventDefault(); e.stopPropagation(); lookRef.current?.setPointerCapture?.(e.pointerId); const l=touchState.current.look; l.active=true; l.pointerId=e.pointerId; l.lastX=e.clientX; l.lastY=e.clientY; };
  const lookMove = (e) => { const l=touchState.current.look; if (!l.active || l.pointerId!==e.pointerId) return; e.preventDefault(); e.stopPropagation(); l.dx += e.clientX-l.lastX; l.dy += e.clientY-l.lastY; l.lastX=e.clientX; l.lastY=e.clientY; };
  const lookUp = (e) => { e.preventDefault(); e.stopPropagation(); const l=touchState.current.look; if (l.pointerId!==e.pointerId) return; lookRef.current?.releasePointerCapture?.(e.pointerId); l.active=false; l.pointerId=null; l.dx=0; l.dy=0; };
  return <><div ref={joyRef} onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp} style={{ position:'fixed', left:16, bottom:16, width:115, height:115, borderRadius:'50%', border:'2px solid #fff', background:'rgba(255,255,255,.2)', zIndex:40, touchAction:'none' }} /><div ref={lookRef} onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} style={{ position:'fixed', right:12, top:90, width:'52vw', height:'48vh', zIndex:10, touchAction:'none' }} /><button onPointerDown={(e)=>{e.preventDefault();e.stopPropagation();onCatch();}} onClick={(e)=>{e.preventDefault();e.stopPropagation();onCatch();}} style={{ position:'fixed', right:30, bottom:30, width:82, height:82, borderRadius:'50%', zIndex:50 }}>🌈<small style={{display:'block'}}>Rescatar</small></button></>; }

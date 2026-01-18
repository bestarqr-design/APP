
import React, { useState, useRef, Suspense, useEffect, useMemo } from 'react';
import { ARExperience, SceneObject, VersionSnapshot } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { Canvas } from '@react-three/fiber';
import { Environment, PerspectiveCamera, OrbitControls, useTexture, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import JSZip from 'jszip';

interface DashboardProps {
  experiences: ARExperience[];
  onSave: (exp: ARExperience) => void;
  onDelete: (id: string) => void;
  onPreview: (exp: ARExperience) => void;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

const DEFAULT_MODEL = 'https://modelviewer.dev/shared-assets/models/Astronaut.glb';

const createEmptyObject = (url: string = DEFAULT_MODEL, name: string = 'New Object'): SceneObject => ({
  id: `obj-${Math.random().toString(36).substr(2, 5)}`,
  name: String(name),
  url: String(url),
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  },
  animation: { autoPlay: true, trigger: 'none' },
  material: { tiling: { x: 1, y: 1 } }
});

const createEmptyExperience = (): ARExperience => ({
  id: `exp-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Industrial Prototype',
  trackingType: 'surface',
  sceneObjects: [createEmptyObject(DEFAULT_MODEL, 'Asset_01')],
  transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  assets: { targetImage: '' },
  config: { shadowIntensity: 0.8, exposure: 1.0, bloom: true, bloomIntensity: 1.5, autoRotate: false, ghostMode: true, gestureControl: true },
  businessData: { businessName: 'Lumina Global', ctaLink: 'https://lumina-ar.io' },
  versions: [],
  updatedAt: Date.now()
});

const ModelInstance = ({ obj }: { obj: SceneObject }) => {
  const { scene } = useGLTF(obj.url);
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  return <primitive object={clonedScene} />;
};

export const Dashboard: React.FC<DashboardProps> = ({ experiences, onSave, onDelete, onPreview }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('lumina_theme') as any || 'dark');
  const [exp, setExp] = useState<ARExperience>(createEmptyExperience());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'hierarchy' | 'tracking' | 'gallery' | 'ai'>('hierarchy');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const modelInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const addToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
    } else {
      addToast("App already installed or browser unsupported", "info");
    }
  };

  const createSnapshot = (note: string = "Manual Snapshot") => {
    const snapshot: VersionSnapshot = {
      id: `v-${Date.now()}`,
      timestamp: Date.now(),
      note: String(note),
      data: JSON.stringify(exp)
    };
    setExp(prev => ({
      ...prev,
      versions: [snapshot, ...prev.versions].slice(0, 15),
      updatedAt: Date.now()
    }));
    addToast("State Snapshot Captured", "success");
  };

  const restoreSnapshot = (snapshot: VersionSnapshot) => {
    try {
      const data = JSON.parse(snapshot.data);
      setExp(data);
      addToast("System Rollback Successful", "info");
    } catch (e) {
      addToast("Rollback Failed: Corrupt Data", "error");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'model' | 'target') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (type === 'model') {
        const newObj = createEmptyObject(result, file.name);
        setExp(prev => ({ ...prev, sceneObjects: [...prev.sceneObjects, newObj], updatedAt: Date.now() }));
        setSelectedObjectId(newObj.id);
      } else {
        setExp(prev => ({ ...prev, assets: { ...prev.assets, targetImage: result }, updatedAt: Date.now() }));
      }
      addToast(`${type === 'model' ? '3D Asset' : 'Tracking Image'} Synced`, "success");
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const exportDesktopSuite = async () => {
    addToast("Generating Production Desktop Suite...", "info");
    const zip = new JSZip();
    const safeName = exp.name.replace(/\s+/g, '_');
    
    zip.file('package.json', JSON.stringify({
      name: safeName.toLowerCase(),
      version: "1.0.0",
      description: `Desktop App for ${exp.name}`,
      main: "main.js",
      scripts: {
        "start": "electron .",
        "dist": "electron-builder --win --x64"
      },
      dependencies: { "electron": "^28.0.0" },
      devDependencies: { "electron-builder": "^24.0.0" }
    }, null, 2));

    zip.file('main.js', `const { app, BrowserWindow } = require('electron');
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    title: "${exp.name} - Lumina Desktop",
    backgroundColor: '#000000'
  });
  win.loadURL('https://lumina-ar.io/view/${exp.id}');
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });`);

    zip.file('BUILD_INSTRUCTIONS.txt', `LuminaAR Desktop Exporter v5.0\n\n1. Extract this ZIP folder.\n2. Open your terminal in this folder.\n3. Run: npm install\n4. Run: npm run dist\n5. Your .exe will be in the /dist/ folder.\n\nNote: Ensure Node.js is installed on your machine.`);

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_Windows_Suite.zip`;
    a.click();
    addToast("Desktop Bundle Ready for Dist", "success");
  };

  const themeClasses = theme === 'dark' ? { bg: 'bg-[#050608]', panel: 'bg-[#0a0c10]', border: 'border-white/5', text: 'text-slate-200' } : { bg: 'bg-slate-50', panel: 'bg-white', border: 'border-slate-200', text: 'text-slate-900' };

  return (
    <div className={`flex h-screen ${themeClasses.bg} ${themeClasses.text} font-sans overflow-hidden`}>
      <div className="fixed bottom-10 right-10 z-[100] flex flex-col gap-3">
        {toasts.map(t => <div key={t.id} className="px-8 py-4 rounded-3xl backdrop-blur-2xl border bg-blue-500/10 border-blue-500/20 text-blue-400 animate-slide-in-right text-[11px] font-black uppercase tracking-widest">{String(t.message)}</div>)}
      </div>

      <div className={`w-84 border-r ${themeClasses.border} ${themeClasses.panel} flex flex-col shrink-0 z-30 shadow-2xl`}>
        <div className="p-8 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center font-black text-white text-xs">L</div>
            <h1 className="text-[10px] font-black uppercase tracking-[0.3em]">Lumina Pro</h1>
          </div>
          <button onClick={handleInstallApp} className="px-4 py-2 bg-blue-500/10 text-blue-500 rounded-xl text-[9px] font-black uppercase hover:bg-blue-500 hover:text-white transition-all">💾 INSTALL</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          <div className="flex p-1 bg-black/40 rounded-2xl border border-white/5">
            {(['hierarchy', 'tracking', 'ai', 'gallery'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveSidebarTab(tab)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${activeSidebarTab === tab ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}>{tab}</button>
            ))}
          </div>

          {activeSidebarTab === 'hierarchy' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex justify-between items-center px-2"><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Active Entities</span><button onClick={() => modelInputRef.current?.click()} className="text-[9px] font-black text-blue-500 hover:text-blue-400">+ IMPORT .GLB</button></div>
              <div className="space-y-2">
                {exp.sceneObjects.map(obj => (
                  <div key={obj.id} onClick={() => setSelectedObjectId(obj.id)} className={`p-5 rounded-2xl border transition-all cursor-pointer flex items-center gap-4 ${selectedObjectId === obj.id ? 'bg-blue-600/10 border-blue-500/40 text-blue-500' : 'border-transparent hover:bg-white/5 text-slate-400'}`}>
                    <span className="text-xl">📦</span>
                    <p className="text-[11px] uppercase font-bold truncate">{String(obj.name)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSidebarTab === 'tracking' && (
            <div className="space-y-6 animate-fade-in">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2">Tracking Strategy</span>
              <div className="grid grid-cols-2 gap-2">
                {(['surface', 'image'] as const).map(type => (
                  <button key={type} onClick={() => setExp(prev => ({ ...prev, trackingType: type }))} className={`py-4 rounded-2xl border text-[9px] font-black uppercase transition-all ${exp.trackingType === type ? 'bg-blue-600 border-blue-500 text-white' : 'border-white/5 text-slate-500 hover:border-white/10'}`}>{type}</button>
                ))}
              </div>
              
              {exp.trackingType === 'image' && (
                <div className="space-y-4 p-6 bg-blue-500/5 rounded-3xl border border-blue-500/10">
                  <p className="text-[8px] font-black uppercase tracking-widest text-blue-500">Spatial Anchor (Upload Image)</p>
                  <div onClick={() => targetInputRef.current?.click()} className="aspect-square bg-black/40 rounded-[2rem] border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer overflow-hidden group transition-all hover:border-blue-500">
                    {exp.assets?.targetImage ? <img src={exp.assets.targetImage} className="w-full h-full object-cover group-hover:opacity-40 transition-opacity" /> : <div className="text-center"><span className="text-3xl block mb-2">📷</span><p className="text-[8px] opacity-40 font-black uppercase">Click to Browse</p></div>}
                  </div>
                </div>
              )}

              <div className="pt-6 border-t border-white/5 space-y-4">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block px-2">Version Snapshots</span>
                <button onClick={() => createSnapshot()} className="w-full py-4 bg-blue-600/10 text-blue-500 rounded-2xl text-[9px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all">COMMIT SNAPSHOT</button>
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                  {exp.versions?.map(v => (
                    <div key={v.id} onClick={() => restoreSnapshot(v)} className="p-4 bg-black/20 rounded-2xl border border-white/5 cursor-pointer hover:border-blue-500 transition-all group text-left">
                      <div className="flex justify-between items-center mb-1"><p className="text-[10px] font-bold text-white group-hover:text-blue-400">{String(v.note)}</p><span className="text-[7px] opacity-20 group-hover:opacity-100">ROLLBACK</span></div>
                      <p className="text-[8px] opacity-40 uppercase font-mono">{new Date(v.timestamp).toLocaleTimeString()}</p>
                    </div>
                  ))}
                  {(!exp.versions || exp.versions.length === 0) && <p className="text-[9px] text-center opacity-20 italic p-4">No snapshots available.</p>}
                </div>
              </div>
            </div>
          )}

          {activeSidebarTab === 'gallery' && (
             <div className="space-y-6 animate-fade-in">
               <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2">Project Repository</span>
               {experiences.map(p => (
                 <div key={p.id} className={`p-6 bg-white/5 rounded-[2.5rem] border space-y-4 transition-all hover:scale-[1.02] ${p.id === exp.id ? 'border-blue-500 ring-4 ring-blue-500/10' : 'border-white/5'}`}>
                   <div className="aspect-video bg-black/40 rounded-3xl overflow-hidden flex items-center justify-center">
                     {p.assets?.targetImage ? <img src={p.assets.targetImage} className="w-full h-full object-cover opacity-60" /> : <span className="text-3xl opacity-20">🛰️</span>}
                   </div>
                   <div className="flex justify-between items-center px-1"><h3 className="text-[11px] font-black uppercase truncate">{String(p.name)}</h3><span className="text-[8px] font-mono opacity-30">{p.trackingType.toUpperCase()}</span></div>
                   <div className="flex gap-2">
                    <button onClick={() => { setExp(p); setActiveSidebarTab('hierarchy'); addToast(`Loaded: ${p.name}`, 'info'); }} className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-[8px] font-black uppercase tracking-widest hover:bg-blue-500 transition-all">LOAD</button>
                    <button onClick={() => onDelete(p.id)} className="w-12 h-12 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all">✕</button>
                   </div>
                 </div>
               ))}
             </div>
          )}
        </div>

        <div className="p-8 border-t border-white/5 space-y-4 bg-[#0a0c10]">
          <div className="flex gap-2">
            <button onClick={() => { createSnapshot("Auto-Save"); onSave(exp); }} className="flex-1 py-4 bg-white/5 text-slate-300 rounded-2xl text-[10px] font-black uppercase hover:bg-white hover:text-black transition-all">SAVE DRAFT</button>
            <button onClick={exportDesktopSuite} title="Export Build Bundle (.EXE Ready)" className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center text-xl hover:bg-blue-600 hover:text-white transition-all">💻</button>
          </div>
          <button onClick={() => onPreview(exp)} className="w-full py-5 bg-blue-600 text-white rounded-[1.5rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-500/20 active:scale-95 transition-all">LAUNCH ENGINE</button>
        </div>
      </div>

      <div className="flex-1 relative bg-[#020305]">
        <div className="absolute top-10 left-10 z-20 p-10 bg-black/60 backdrop-blur-3xl border border-white/10 rounded-[3rem] shadow-2xl min-w-[360px] animate-slide-in-right">
          <span className="text-[8px] font-black text-blue-500 uppercase tracking-[0.5em] block mb-2">Workspace Identifier</span>
          <input value={exp.name} onChange={e => setExp(prev => ({ ...prev, name: e.target.value }))} className="bg-transparent text-2xl font-black uppercase text-white outline-none w-full border-b border-transparent focus:border-blue-500/30" placeholder="PROJECT_ID" />
        </div>

        <Canvas shadows gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
          <PerspectiveCamera makeDefault position={[10, 8, 10]} fov={35} />
          <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 20, 10]} intensity={2.5} castShadow shadow-mapSize={[2048, 2048]} />
          <Suspense fallback={<Html center><div className="text-blue-500 text-[10px] font-black uppercase tracking-[0.8em] animate-pulse">Syncing_Sensors...</div></Html>}>
             <group>
               {exp.sceneObjects.map(obj => (
                 <group key={obj.id} position={[obj.transform.position.x, obj.transform.position.y, obj.transform.position.z]} scale={[obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z]}>
                    <ModelInstance obj={obj} />
                 </group>
               ))}
             </group>
             <Suspense fallback={null}>
               <Environment preset="warehouse" />
             </Suspense>
             <gridHelper args={[80, 160, '#1a1b1e', '#08090d']} position={[0, -0.01, 0]} />
          </Suspense>
        </Canvas>
      </div>

      <input ref={modelInputRef} type="file" accept=".glb,.gltf" onChange={e => handleFileUpload(e, 'model')} className="hidden" />
      <input ref={targetInputRef} type="file" accept="image/*" onChange={e => handleFileUpload(e, 'target')} className="hidden" />
    </div>
  );
};


import React, { useState, useRef, Suspense, useEffect, useMemo } from 'react';
import { ARExperience, TrackingType, Vector3, SceneObject, MaterialConfig } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { Canvas } from '@react-three/fiber';
import { Environment, ContactShadows, PerspectiveCamera, OrbitControls, useTexture, useGLTF, Float, Sky, Html } from '@react-three/drei';
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
  material: {
    tiling: { x: 1, y: 1 }
  }
});

const createEmptyExperience = (): ARExperience => ({
  id: `exp-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Lumina Prototype',
  trackingType: 'surface',
  sceneObjects: [createEmptyObject(DEFAULT_MODEL, 'Asset_01')],
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  },
  assets: { targetImage: '' },
  config: { 
    shadowIntensity: 0.8, 
    exposure: 1.0, 
    bloom: true, 
    bloomIntensity: 1.5,
    autoRotate: false, 
    ghostMode: true, 
    gestureControl: true 
  },
  businessData: { businessName: 'Lumina Global', ctaLink: 'https://lumina-ar.io' }
});

const ModelInstance = ({ obj }: { obj: SceneObject }) => {
  const { scene } = useGLTF(obj.url);
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const diffuseMap = obj.material?.map ? useTexture(obj.material.map) : null;

  useEffect(() => {
    const tiling = obj.material?.tiling || { x: 1, y: 1 };
    if (diffuseMap) {
      diffuseMap.wrapS = diffuseMap.wrapT = THREE.RepeatWrapping;
      diffuseMap.repeat.set(tiling.x, tiling.y);
    }
    clonedScene.traverse((node: any) => {
      if (node.isMesh) {
        if (diffuseMap) node.material.map = diffuseMap;
        node.material.needsUpdate = true;
      }
    });
  }, [clonedScene, diffuseMap, obj.material?.tiling]);

  return <primitive object={clonedScene} />;
};

const GroundPlane = ({ trackingType, targetImage, theme }: { trackingType: string, targetImage?: string, theme: 'dark' | 'light' }) => {
  const texture = (trackingType === 'image' && targetImage) ? useTexture(targetImage) : null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[50, 50]} />
      <meshStandardMaterial 
        map={texture}
        color={texture ? 'white' : (theme === 'dark' ? '#0a0b0e' : '#f1f5f9')} 
        transparent 
        opacity={texture ? 1 : 0.8}
        roughness={1}
      />
    </mesh>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ experiences, onSave, onDelete, onPreview }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('lumina_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });
  
  const [exp, setExp] = useState<ARExperience>(createEmptyExperience());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(exp.sceneObjects[0]?.id || null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'hierarchy' | 'tracking' | 'gallery' | 'ai'>('hierarchy');
  const [aiLoading, setAiLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  const modelInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);
  const diffuseInputRef = useRef<HTMLInputElement>(null);

  const addToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const selectedObject = useMemo(() => 
    exp.sceneObjects.find(o => o.id === selectedObjectId), 
    [exp.sceneObjects, selectedObjectId]
  );

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('lumina_theme', newTheme);
    addToast(`Switched to ${newTheme} mode`, 'info');
  };

  const updateObjectProperty = (objId: string, path: string, value: any) => {
    setExp(prev => ({
      ...prev,
      sceneObjects: prev.sceneObjects.map(obj => {
        if (obj.id !== objId) return obj;
        const newObj = JSON.parse(JSON.stringify(obj));
        const parts = path.split('.');
        let current: any = newObj;
        for (let i = 0; i < parts.length - 1; i++) {
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
        return newObj;
      })
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'model' | 'target' | 'diffuse') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (type === 'model') {
        const newObj = createEmptyObject(result, file.name);
        setExp(prev => ({ ...prev, sceneObjects: [...prev.sceneObjects, newObj] }));
        setSelectedObjectId(newObj.id);
        addToast("3D Asset Imported Successfully", "success");
      } else if (type === 'target') {
        setExp(prev => ({ ...prev, assets: { ...prev.assets, targetImage: result } }));
        addToast("Tracking Target Updated", "success");
      } else if (selectedObjectId && type === 'diffuse') {
        updateObjectProperty(selectedObjectId, 'material.map', result);
        addToast("Texture Map Applied", "success");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAiAssistant = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    addToast("Spatial Engine: Synthesizing Scene...", "info");
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Act as a senior WebAR scene architect. Design a professional scene for: "${aiPrompt}". 
        The scene should be either 'image' or 'surface' based.`,
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              tracking: { type: Type.STRING },
              entities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    pos: {
                      type: Type.OBJECT,
                      properties: {
                        x: { type: Type.NUMBER },
                        y: { type: Type.NUMBER },
                        z: { type: Type.NUMBER }
                      },
                      required: ["x", "y", "z"]
                    },
                    scale: { type: Type.NUMBER }
                  },
                  required: ["name", "pos"]
                }
              }
            },
            required: ["name", "tracking", "entities"]
          }
        }
      });
      
      const text = response.text;
      if (!text) throw new Error("No response text returned from the spatial engine.");
      const res = JSON.parse(text);
      if (res.entities) {
        const newObjects = res.entities.map((ent: any) => ({
          ...createEmptyObject(DEFAULT_MODEL, ent.name),
          transform: {
            position: ent.pos || { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: ent.scale || 1, y: ent.scale || 1, z: ent.scale || 1 }
          }
        }));
        setExp(prev => ({
          ...prev,
          name: res.name || prev.name,
          trackingType: res.tracking || prev.trackingType,
          sceneObjects: newObjects
        }));
        if (newObjects.length > 0) setSelectedObjectId(newObjects[0].id);
        setAiPrompt('');
        addToast("Scene Successfully Constructed", "success");
      }
    } catch (e) {
      console.error("AI Scene Design Failed:", e);
      addToast("AI Synthesis Failed", "error");
    } finally {
      setAiLoading(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    addToast("Preparing Project Bundle...", "info");
    try {
      const zip = new JSZip();
      const projectData = JSON.stringify(exp, null, 2);
      zip.file(`${exp.name.replace(/\s+/g, '_')}_config.json`, projectData);
      
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exp.name.replace(/\s+/g, '_')}_bundle.zip`;
      a.click();
      URL.revokeObjectURL(url);
      addToast("Project Exported Successfully", "success");
    } catch (e) {
      console.error("Export failed", e);
      addToast("Export Operation Failed", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const handleCreateNew = () => {
    const newExp = createEmptyExperience();
    setExp(newExp);
    setSelectedObjectId(newExp.sceneObjects[0]?.id || null);
    setActiveSidebarTab('hierarchy');
    addToast("New Project Initialized", "info");
  };

  const handleSave = () => {
    onSave(exp);
    addToast("Workspace State Persisted", "success");
  };

  const themeClasses = theme === 'dark' 
    ? { 
        bg: 'bg-[#050608]', 
        panel: 'bg-[#0a0c10]', 
        border: 'border-white/5', 
        text: 'text-slate-200', 
        subText: 'text-slate-500', 
        accent: 'bg-white/5', 
        input: 'bg-black/40',
        tabActive: 'bg-blue-600 text-white shadow-blue-500/20',
        tabInactive: 'text-slate-500 hover:text-slate-300',
        viewportBg: '#050608',
        gridColor: '#1a1b20',
        gridCenterColor: '#08090d',
        cardBg: 'bg-white/5',
        cardHover: 'hover:bg-blue-600/10'
      } 
    : { 
        bg: 'bg-slate-50', 
        panel: 'bg-white', 
        border: 'border-slate-200', 
        text: 'text-slate-900', 
        subText: 'text-slate-400', 
        accent: 'bg-slate-100', 
        input: 'bg-slate-100',
        tabActive: 'bg-blue-600 text-white shadow-blue-500/10',
        tabInactive: 'text-slate-400 hover:text-slate-600',
        viewportBg: '#f8fafc',
        gridColor: '#e2e8f0',
        gridCenterColor: '#f1f5f9',
        cardBg: 'bg-slate-100/50',
        cardHover: 'hover:bg-blue-600/5'
      };

  const getTrackingIcon = (mode: TrackingType) => {
    switch(mode) {
      case 'surface': return '🛰️';
      case 'image': return '📸';
      case 'hand': return '🖐️';
      case 'body': return '🧍';
      case 'face': return '🎭';
      case 'portal': return '🌀';
      default: return '📍';
    }
  };

  return (
    <div className={`flex h-screen ${themeClasses.bg} ${themeClasses.text} font-sans overflow-hidden transition-all duration-300`}>
      {/* Toast Notification Layer */}
      <div className="fixed bottom-10 right-10 z-[100] flex flex-col gap-3">
        {toasts.map(toast => (
          <div 
            key={toast.id} 
            className={`px-8 py-4 rounded-3xl backdrop-blur-2xl border flex items-center gap-4 shadow-2xl animate-in slide-in-from-right-10 duration-500 ${
              toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
              toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
              'bg-blue-500/10 border-blue-500/20 text-blue-400'
            }`}
          >
            <span className="text-lg">
              {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}
            </span>
            <span className="text-[11px] font-black uppercase tracking-widest">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Sidebar - Control Tower */}
      <div className={`w-80 border-r ${themeClasses.border} ${themeClasses.panel} flex flex-col shrink-0 z-30 shadow-2xl`}>
        <div className={`p-6 border-b ${themeClasses.border} flex items-center justify-between`}>
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center font-black text-white text-xs shadow-xl shadow-blue-500/30">L</div>
             <div className="flex flex-col">
               <h1 className="text-[11px] font-black uppercase tracking-[0.25em]">Lumina Studio</h1>
               <span className="text-[8px] opacity-40 font-mono">v4.2 PRO</span>
             </div>
          </div>
          <button onClick={toggleTheme} className={`w-10 h-10 flex items-center justify-center rounded-2xl transition-all ${themeClasses.accent} hover:scale-110 active:scale-95 shadow-lg`}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
          <div className={`flex p-1 ${themeClasses.bg} rounded-2xl border ${themeClasses.border} shadow-inner`}>
            {(['hierarchy', 'tracking', 'ai', 'gallery'] as const).map(tab => (
              <button 
                key={tab}
                onClick={() => setActiveSidebarTab(tab)}
                className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-tighter transition-all ${activeSidebarTab === tab ? themeClasses.tabActive : themeClasses.tabInactive}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeSidebarTab === 'hierarchy' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-left-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Spatial Registry</span>
                <button onClick={() => modelInputRef.current?.click()} className="text-[9px] font-black text-blue-500 hover:text-blue-400 hover:underline">+ NEW ASSET</button>
              </div>
              <div className="space-y-1.5">
                {exp.sceneObjects.map(obj => (
                  <div 
                    key={obj.id}
                    onClick={() => setSelectedObjectId(obj.id)}
                    className={`group flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${selectedObjectId === obj.id ? 'bg-blue-600/10 border-blue-500/40 text-blue-500 font-bold' : `bg-transparent border-transparent ${themeClasses.subText} hover:bg-blue-500/5`}`}
                  >
                    <span className="text-xl">📦</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] truncate uppercase tracking-tight">{obj.name}</p>
                      <p className="text-[8px] opacity-40 font-mono">{obj.url.length > 30 ? obj.url.substring(0, 30) + '...' : obj.url}</p>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setExp(prev => ({ ...prev, sceneObjects: prev.sceneObjects.filter(o => o.id !== obj.id) })); }}
                      className="opacity-0 group-hover:opacity-100 text-red-500 text-xs p-2 hover:bg-red-500/10 rounded-lg transition-all"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSidebarTab === 'tracking' && (
            <div className="space-y-8 animate-in fade-in duration-500">
               <div className="space-y-4">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-2">Anchor Logic</span>
                  <div className="grid grid-cols-2 gap-3">
                    {(['surface', 'image', 'hand', 'body'] as const).map(mode => (
                      <button 
                        key={mode}
                        onClick={() => {
                          setExp(prev => ({ ...prev, trackingType: mode }));
                          addToast(`Switched to ${mode} tracking`, 'info');
                        }}
                        className={`p-6 rounded-3xl border text-[10px] font-black uppercase flex flex-col items-center gap-3 transition-all ${exp.trackingType === mode ? 'bg-blue-600 border-blue-400 text-white shadow-2xl shadow-blue-500/20' : `bg-transparent ${themeClasses.border} ${themeClasses.subText} hover:border-blue-500/40 hover:scale-[1.02]`}`}
                      >
                        <span className="text-3xl">{getTrackingIcon(mode)}</span>
                        {mode}
                      </button>
                    ))}
                  </div>
               </div>
               {exp.trackingType === 'image' && (
                 <div className="space-y-4 animate-in slide-in-from-top-4 duration-500">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-2">Image Descriptor Calibration</span>
                    <div onClick={() => targetInputRef.current?.click()} className={`aspect-square ${themeClasses.bg} border-2 border-dashed ${themeClasses.border} rounded-[2.5rem] flex flex-col items-center justify-center cursor-pointer hover:border-blue-500/50 transition-all overflow-hidden group shadow-inner relative`}>
                      {exp.assets.targetImage ? (
                        <img src={exp.assets.targetImage} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt="Tracking Target" />
                      ) : (
                        <div className="text-center opacity-25">
                          <span className="text-5xl">🖼️</span>
                          <p className="text-[9px] font-black uppercase mt-4 tracking-[0.2em]">Upload Target</p>
                        </div>
                      )}
                    </div>
                 </div>
               )}
            </div>
          )}

          {activeSidebarTab === 'gallery' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="flex items-center justify-between px-2 mb-2">
                 <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Project Repository</span>
                 <button 
                  onClick={handleCreateNew}
                  className="text-[9px] font-black text-blue-500 hover:text-blue-400 flex items-center gap-1 group"
                 >
                   <span className="text-lg group-hover:scale-125 transition-transform">+</span> CREATE NEW
                 </button>
               </div>
               
               <div className="grid grid-cols-1 gap-4">
                 {experiences.map(project => (
                   <div 
                    key={project.id} 
                    onClick={() => { setExp(project); setSelectedObjectId(project.sceneObjects[0]?.id || null); addToast(`Loaded: ${project.name}`, 'info'); }}
                    className={`group relative rounded-[2rem] border overflow-hidden transition-all duration-300 cursor-pointer ${themeClasses.cardBg} ${themeClasses.cardHover} ${exp.id === project.id ? 'border-blue-500 ring-4 ring-blue-500/10' : themeClasses.border}`}
                   >
                     <div className="aspect-[16/9] bg-black/20 relative overflow-hidden">
                        {project.assets.targetImage ? (
                          <img src={project.assets.targetImage} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700" alt={project.name} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center opacity-10">
                            <span className="text-4xl">{getTrackingIcon(project.trackingType)}</span>
                          </div>
                        )}
                        <div className="absolute top-4 left-4">
                           <span className="px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-[7px] font-black uppercase tracking-widest text-white border border-white/10">
                             {project.trackingType}
                           </span>
                        </div>
                     </div>

                     <div className="p-5 space-y-3">
                        <div className="flex justify-between items-start gap-2">
                           <h3 className="text-[12px] font-black uppercase tracking-tight truncate flex-1">{project.name}</h3>
                           <span className="text-[8px] font-mono opacity-30 mt-0.5">{project.id.split('-')[1]}</span>
                        </div>
                        
                        <div className="flex items-center gap-2 opacity-40">
                           <span className="text-xs">📦</span>
                           <span className="text-[8px] font-bold uppercase tracking-[0.2em]">{project.sceneObjects.length} Entities</span>
                        </div>

                        <div className="flex gap-2 pt-2">
                           <button 
                            onClick={(e) => { e.stopPropagation(); onPreview(project); }} 
                            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[8px] font-black uppercase tracking-widest transition-all"
                           >Launch</button>
                           <button 
                            onClick={(e) => { e.stopPropagation(); onDelete(project.id); addToast("Project Removed", "info"); }} 
                            className="w-10 h-10 flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all"
                           >
                             <span className="text-xs">✕</span>
                           </button>
                        </div>
                     </div>
                   </div>
                 ))}

                 {experiences.length === 0 && (
                   <div className="flex flex-col items-center justify-center py-24 opacity-20 text-center space-y-6">
                      <div className="w-20 h-20 border-2 border-dashed border-current rounded-full flex items-center justify-center animate-pulse">
                        <span className="text-4xl">📁</span>
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-widest">No Projects Found</p>
                      <button 
                        onClick={handleCreateNew}
                        className="px-6 py-3 border border-current rounded-2xl text-[8px] font-black uppercase tracking-widest hover:bg-current hover:text-black transition-all"
                      >Initialize Engine</button>
                   </div>
                 )}
               </div>
            </div>
          )}

          {activeSidebarTab === 'ai' && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-2">Prompt-to-Spatial Engine</span>
              <textarea 
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="Ex: 'Futuristic solar system with animated planets'"
                className={`w-full h-48 ${themeClasses.input} border ${themeClasses.border} rounded-[2rem] p-6 text-[11px] focus:outline-none focus:border-blue-500/40 resize-none transition-all placeholder:opacity-30 leading-relaxed`}
              />
              <button 
                onClick={handleAiAssistant} 
                disabled={aiLoading} 
                className="w-full py-5 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest shadow-2xl shadow-blue-500/30 active:scale-95 disabled:opacity-50 transition-all hover:shadow-blue-500/50"
              >
                {aiLoading ? 'Synthesizing...' : 'CONSTRUCT SCENE'}
              </button>
            </div>
          )}
        </div>

        <div className={`p-6 border-t ${themeClasses.border} space-y-4 ${themeClasses.panel}`}>
          <div className="flex gap-2">
            <button onClick={handleSave} className={`flex-1 py-4 ${themeClasses.accent} rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-500/5 transition-all active:scale-95`}>Save Draft</button>
            <button onClick={handleExport} disabled={isExporting} title="Export Project ZIP" className={`p-4 ${themeClasses.accent} rounded-2xl text-lg hover:bg-amber-500/10 transition-all active:scale-90 ${isExporting ? 'animate-pulse' : ''}`}>
              {isExporting ? '⏳' : '📦'}
            </button>
          </div>
          <button onClick={() => onPreview(exp)} className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-[1.5rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-blue-900/40 active:scale-95 transition-all">Launch Preview</button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative flex flex-col">
        {/* Floating HUD - Project Info & Renaming */}
        <div className="absolute top-10 left-10 z-20 p-8 bg-black/60 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl min-w-[360px] group/hud hover:bg-black/80 transition-all">
          <div className="flex flex-col gap-1 mb-2">
            <span className="text-[8px] font-black uppercase tracking-[0.5em] text-blue-500/80">Project Workspace</span>
            <input 
              value={exp.name}
              onChange={e => setExp(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Unnamed Experience"
              className="bg-transparent text-2xl font-black uppercase tracking-tighter text-white outline-none w-full focus:text-blue-400 transition-colors border-b border-transparent focus:border-blue-500/30 pb-1"
            />
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex gap-1.5">
               <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></div>
               <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse delay-100"></div>
               <div className="w-2.5 h-2.5 rounded-full bg-blue-300 animate-pulse delay-200"></div>
            </div>
            <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.3em] font-bold">SID: {exp.id.split('-')[1]}</span>
          </div>
        </div>

        {/* Viewport container with theme-aware background */}
        <div className={`flex-1 transition-colors duration-500 ${themeClasses.bg}`}>
          <Canvas shadows gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
            <PerspectiveCamera makeDefault position={[10, 8, 10]} fov={35} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.05} minDistance={2} maxDistance={30} />
            <ambientLight intensity={theme === 'dark' ? 0.4 : 1.2} />
            <directionalLight position={[10, 20, 10]} intensity={theme === 'dark' ? 2 : 1.5} castShadow />
            <pointLight position={[-10, 5, -10]} intensity={0.5} color="#3b82f6" />
            
            <Suspense fallback={<Html center className="text-blue-500 font-black animate-pulse uppercase tracking-[0.8em] text-[10px]">Linking_Sensors...</Html>}>
              <group>
                {exp.sceneObjects.map(obj => (
                  <group 
                    key={obj.id}
                    position={[obj.transform.position.x, obj.transform.position.y, obj.transform.position.z]}
                    rotation={[THREE.MathUtils.degToRad(obj.transform.rotation.x), THREE.MathUtils.degToRad(obj.transform.rotation.y), THREE.MathUtils.degToRad(obj.transform.rotation.z)]}
                    scale={[obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z]}
                    onClick={(e) => { e.stopPropagation(); setSelectedObjectId(obj.id); }}
                  >
                    <ModelInstance obj={obj} />
                    {selectedObjectId === obj.id && (
                      <mesh>
                        <boxGeometry args={[1.25, 1.25, 1.25]} />
                        <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.3} />
                      </mesh>
                    )}
                  </group>
                ))}
              </group>
              <GroundPlane trackingType={exp.trackingType} targetImage={exp.assets.targetImage} theme={theme} />
              <ContactShadows opacity={theme === 'dark' ? 0.5 : 0.2} scale={25} blur={3} far={20} color="#000" />
              <Suspense fallback={<Sky sunPosition={[10, 20, 10]} />}>
                <Environment preset="warehouse" />
              </Suspense>
              <gridHelper 
                args={[80, 160, themeClasses.gridColor, themeClasses.gridCenterColor]} 
                position={[0, -0.02, 0]} 
              />
            </Suspense>
          </Canvas>
        </div>
      </div>

      {/* Right Sidebar - Logic Engine */}
      <div className={`w-80 border-l ${themeClasses.border} ${themeClasses.panel} flex flex-col shrink-0 overflow-y-auto custom-scrollbar shadow-2xl z-20`}>
        {selectedObject ? (
          <div className="p-8 space-y-12 animate-in slide-in-from-right-6 duration-500">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Identity Descriptor</span>
                <span className="text-[8px] font-mono opacity-30">UID: {selectedObject.id}</span>
              </div>
              <input 
                value={selectedObject.name}
                onChange={e => updateObjectProperty(selectedObject.id, 'name', e.target.value)}
                className={`w-full ${themeClasses.input} border ${themeClasses.border} rounded-2xl px-5 py-4 text-xs outline-none focus:border-blue-500/50 transition-all font-bold tracking-tight shadow-sm`}
              />
            </div>

            <div className="space-y-10">
              <div className="flex justify-between items-center px-1">
                 <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Spatial Geometry</span>
                 <button onClick={() => {
                   updateObjectProperty(selectedObject.id, 'transform.position', { x: 0, y: 0, z: 0 });
                   updateObjectProperty(selectedObject.id, 'transform.rotation', { x: 0, y: 0, z: 0 });
                   updateObjectProperty(selectedObject.id, 'transform.scale', { x: 1, y: 1, z: 1 });
                   addToast("Object Transform Reset", "info");
                 }} className="text-[9px] font-black text-slate-500 hover:text-blue-500 uppercase tracking-[0.2em] transition-colors">Reset</button>
              </div>
              
              {(['position', 'rotation'] as const).map(prop => (
                <div key={prop} className="space-y-6">
                   <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.3em] mb-3 ml-1">{prop}</p>
                   {(['x', 'y', 'z'] as const).map(axis => (
                     <div key={axis} className="space-y-2">
                        <div className="flex justify-between text-[9px] font-mono uppercase tracking-[0.1em]">
                           <span className="opacity-40">{axis}</span>
                           <span className="text-blue-500 font-bold">{selectedObject.transform[prop][axis].toFixed(2)}</span>
                        </div>
                        <input 
                          type="range"
                          min={prop === 'rotation' ? -180 : -15}
                          max={prop === 'rotation' ? 180 : 15}
                          step={prop === 'rotation' ? 1 : 0.05}
                          value={selectedObject.transform[prop][axis]}
                          onChange={e => updateObjectProperty(selectedObject.id, `transform.${prop}.${axis}`, parseFloat(e.target.value))}
                          className="w-full h-1 bg-blue-500/10 rounded-full appearance-none accent-blue-600 cursor-pointer hover:accent-blue-400 transition-all"
                        />
                     </div>
                   ))}
                </div>
              ))}

              <div className="space-y-4">
                 <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.3em] ml-1">Universal Scale</p>
                 <div className="flex items-center gap-6 bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10">
                    <input 
                      type="range" min={0.01} max={15} step={0.01}
                      value={selectedObject.transform.scale.x}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        updateObjectProperty(selectedObject.id, 'transform.scale.x', val);
                        updateObjectProperty(selectedObject.id, 'transform.scale.y', val);
                        updateObjectProperty(selectedObject.id, 'transform.scale.z', val);
                      }}
                      className="flex-1 h-1 bg-blue-500/10 rounded-full appearance-none accent-blue-600 cursor-pointer"
                    />
                    <span className="text-[12px] font-mono text-blue-500 font-black w-10 text-right">{selectedObject.transform.scale.x.toFixed(1)}</span>
                 </div>
              </div>
            </div>

            <div className="space-y-6 pt-8 border-t border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Neural Config</span>
              <div className="space-y-6 px-1">
                <div className="space-y-2">
                   <div className="flex justify-between text-[9px] font-mono uppercase tracking-[0.1em] text-blue-500 font-bold">
                      <span>Exposure</span>
                      <span>{exp.config.exposure.toFixed(2)}</span>
                   </div>
                   <input 
                    type="range" min={0} max={2} step={0.01} 
                    value={exp.config.exposure} 
                    onChange={e => setExp(prev => ({ ...prev, config: { ...prev.config, exposure: parseFloat(e.target.value) } }))}
                    className="w-full h-1 bg-blue-500/10 rounded-full appearance-none accent-blue-600"
                   />
                </div>
                
                <div className="space-y-2">
                   <div className="flex justify-between text-[9px] font-mono uppercase tracking-[0.1em] text-blue-500 font-bold">
                      <span>Bloom Intensity</span>
                      <span>{exp.config.bloomIntensity.toFixed(2)}</span>
                   </div>
                   <input 
                    type="range" min={0} max={5} step={0.01} 
                    value={exp.config.bloomIntensity} 
                    onChange={e => setExp(prev => ({ ...prev, config: { ...prev.config, bloomIntensity: parseFloat(e.target.value) } }))}
                    className="w-full h-1 bg-blue-500/10 rounded-full appearance-none accent-blue-600"
                   />
                </div>

                <div className="space-y-3 pt-2">
                  {[
                    { label: 'Bloom Engine', key: 'bloom', icon: '✨' },
                    { label: 'Kinetic Rotation', key: 'autoRotate', icon: '🔄' },
                    { label: 'Gesture Capture', key: 'gestureControl', icon: '🤌' },
                    { label: 'Ghost Calibration', key: 'ghostMode', icon: '👻' }
                  ].map(opt => (
                    <label key={opt.key} className="flex items-center justify-between p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 cursor-pointer hover:bg-blue-500/10 transition-all">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{opt.icon}</span>
                        <span className="text-[10px] font-black uppercase tracking-tight">{opt.label}</span>
                      </div>
                      <div className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={(exp.config as any)[opt.key]} 
                          onChange={e => setExp(prev => ({ ...prev, config: { ...prev.config, [opt.key]: e.target.checked } }))}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-5 bg-slate-700/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6 pt-8 border-t border-white/5 pb-16">
               <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Material Core</span>
               <div className="grid grid-cols-1 gap-4">
                 <button 
                  onClick={() => diffuseInputRef.current?.click()}
                  className={`w-full py-5 ${themeClasses.bg} border-2 border-dashed ${themeClasses.border} rounded-3xl text-[10px] font-black uppercase tracking-widest hover:border-blue-500/50 transition-all flex items-center justify-center gap-4 shadow-xl active:scale-95`}
                 >
                   🎨 {selectedObject.material?.map ? 'Override Map' : 'Assign Diffuse'}
                 </button>
                 {selectedObject.material?.map && (
                   <button 
                    onClick={() => { updateObjectProperty(selectedObject.id, 'material.map', undefined); addToast("Texture Purged", "info"); }}
                    className="w-full text-[9px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-widest py-3 transition-colors"
                   >Purge Active Texture</button>
                 )}
               </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-14 text-center text-slate-500 opacity-20">
            <div className="w-24 h-24 border border-dashed border-white/20 rounded-full flex items-center justify-center mb-10 animate-pulse">
               <span className="text-5xl">🔭</span>
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.6em] leading-relaxed">Awaiting Sensor Telemetry...</p>
          </div>
        )}
      </div>

      {/* Controller Inputs */}
      <input ref={modelInputRef} type="file" accept=".glb,.gltf" onChange={e => handleFileUpload(e, 'model')} className="hidden" />
      <input ref={targetInputRef} type="file" accept="image/*" onChange={e => handleFileUpload(e, 'target')} className="hidden" />
      <input ref={diffuseInputRef} type="file" accept="image/*" onChange={e => handleFileUpload(e, 'diffuse')} className="hidden" />
    </div>
  );
};

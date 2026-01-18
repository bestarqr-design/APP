
import React, { useState, useRef, Suspense, useEffect, useMemo } from 'react';
import { ARExperience, TrackingType, Vector3, SceneObject } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { Canvas } from '@react-three/fiber';
import { Environment, ContactShadows, PerspectiveCamera, OrbitControls, Gltf, Sky, useTexture } from '@react-three/drei';
import * as THREE from 'three';

interface DashboardProps {
  experiences: ARExperience[];
  onSave: (exp: ARExperience) => void;
  onDelete: (id: string) => void;
  onPreview: (exp: ARExperience) => void;
}

const DEFAULT_MODEL = 'https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/cup-tea/model.gltf';

const createEmptyObject = (url: string = DEFAULT_MODEL, name: string = 'New Object'): SceneObject => ({
  id: `obj-${Math.random().toString(36).substr(2, 5)}`,
  name,
  url,
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  },
  animation: { autoPlay: true, trigger: 'none' }
});

const createEmptyExperience = (): ARExperience => ({
  id: `exp-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Untethered Reality',
  trackingType: 'image',
  sceneObjects: [createEmptyObject(DEFAULT_MODEL, 'Primary Asset')],
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  },
  assets: { targetImage: '' },
  config: { shadowIntensity: 0.8, exposure: 1.0, bloom: true, autoRotate: false, ghostMode: true },
  businessData: { businessName: 'Lumina Tech', ctaLink: 'https://example.com' }
});

const GroundPlane = ({ trackingType, targetImage }: { trackingType: string, targetImage?: string }) => {
  // Only load texture if it's an image tracking type and image exists
  const texture = (trackingType === 'image' && targetImage) ? useTexture(targetImage) : null;
  
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
      <planeGeometry args={[12, 12]} />
      <meshStandardMaterial 
        map={texture}
        color={texture ? 'white' : '#0a0a0c'} 
        transparent 
        opacity={texture ? 1 : 0.8}
        roughness={1}
      />
    </mesh>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ experiences, onSave, onDelete, onPreview }) => {
  const [exp, setExp] = useState<ARExperience>(createEmptyExperience());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(exp.sceneObjects[0]?.id || null);
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'tracking' | 'ai' | 'interactivity'>('hierarchy');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  
  const modelInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  const selectedObject = useMemo(() => 
    exp.sceneObjects.find(o => o.id === selectedObjectId), 
    [exp.sceneObjects, selectedObjectId]
  );

  const updateObjectProperty = (objId: string, path: string, value: any) => {
    setExp(prev => ({
      ...prev,
      sceneObjects: prev.sceneObjects.map(obj => {
        if (obj.id !== objId) return obj;
        const newObj = { ...obj };
        const parts = path.split('.');
        let current: any = newObj;
        for (let i = 0; i < parts.length - 1; i++) {
          current[parts[i]] = { ...current[parts[i]] };
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
        return newObj;
      })
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'model' | 'target') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (type === 'model') {
        const newObj = createEmptyObject(result, file.name);
        setExp(prev => ({ ...prev, sceneObjects: [...prev.sceneObjects, newObj] }));
        setSelectedObjectId(newObj.id);
      } else {
        setExp(prev => ({ ...prev, assets: { ...prev.assets, targetImage: result } }));
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAiGenerateScene = async () => {
    if (!aiPrompt) return;
    setAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Create an AR scene layout for: "${aiPrompt}". 
        Suggest the tracking mode (surface, face, or image), and a list of 3D entities with positions (x,y,z) and scales. 
        Return strictly valid JSON.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tracking: { type: Type.STRING },
              entities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    position: {
                      type: Type.OBJECT,
                      properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } }
                    },
                    scale: { type: Type.NUMBER }
                  }
                }
              }
            }
          }
        }
      });
      const data = JSON.parse(response.text || '{}');
      if (data.entities) {
        const newObjects = data.entities.map((ent: any) => ({
          ...createEmptyObject(DEFAULT_MODEL, String(ent.name)),
          transform: {
            position: ent.position || { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: ent.scale || 1, y: ent.scale || 1, z: ent.scale || 1 }
          }
        }));
        setExp(prev => ({ 
          ...prev, 
          trackingType: (data.tracking as TrackingType) || prev.trackingType,
          sceneObjects: newObjects 
        }));
        if (newObjects.length > 0) setSelectedObjectId(newObjects[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-900 text-white font-sans overflow-hidden">
      <div className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center font-black">L</div>
            <h1 className="text-sm font-black tracking-tighter uppercase">Lumina Studio</h1>
          </div>
          <button onClick={() => setExp(createEmptyExperience())} className="w-full py-2 bg-blue-600/10 border border-blue-500/50 rounded-xl text-[10px] font-black tracking-widest text-blue-400 hover:bg-blue-600 hover:text-white transition-all">
            CREATE NEW PROJECT
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          <h2 className="text-[9px] font-black tracking-widest text-slate-500 uppercase px-2 mb-2">Deployments</h2>
          {experiences.map(item => (
            <div 
              key={item.id} 
              onClick={() => setExp(item)}
              className={`p-3 rounded-xl border cursor-pointer group transition-all ${exp.id === item.id ? 'bg-blue-600/10 border-blue-500/50' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold truncate pr-2">{String(item.name)}</span>
                <span className="text-[7px] font-mono text-slate-500">{String(item.trackingType)}</span>
              </div>
              <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} className="text-[7px] font-bold text-red-500/70 hover:text-red-500">DELETE</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-80 border-r border-slate-800 bg-slate-950 flex flex-col shrink-0 shadow-2xl z-10">
        <div className="flex bg-slate-900 p-1 m-4 rounded-xl border border-slate-800">
          {(['hierarchy', 'tracking', 'interactivity', 'ai'] as const).map(tab => (
            <button 
              key={tab} 
              onClick={() => setActiveTab(tab)} 
              className={`flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-tighter transition-all ${activeTab === tab ? 'bg-slate-800 text-blue-400 border border-slate-700 shadow-lg shadow-black/50' : 'text-slate-500'}`}
            >
              {tab === 'hierarchy' ? 'Scene' : tab === 'interactivity' ? 'Logic' : String(tab).toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {activeTab === 'hierarchy' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Scene Hierarchy</h3>
                <div className="space-y-1">
                  {exp.sceneObjects.map(obj => (
                    <div 
                      key={obj.id}
                      onClick={() => setSelectedObjectId(obj.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selectedObjectId === obj.id ? 'bg-blue-600/10 border-blue-500/50 text-white' : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:border-slate-700'}`}
                    >
                      <div className="w-5 h-5 bg-slate-800 rounded flex items-center justify-center text-[10px]">📦</div>
                      <span className="text-[10px] font-bold truncate flex-1">{String(obj.name)}</span>
                      <button onClick={(e) => { e.stopPropagation(); setExp(prev => ({ ...prev, sceneObjects: prev.sceneObjects.filter(o => o.id !== obj.id) })); }} className="hover:text-red-400 text-xs">✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => modelInputRef.current?.click()} className="w-full py-3 border border-dashed border-slate-700 rounded-xl text-[9px] font-black text-slate-500 hover:text-white transition-all uppercase">
                  + Add 3D Entity
                </button>
                <input ref={modelInputRef} type="file" accept=".glb,.gltf" onChange={(e) => handleFileUpload(e, 'model')} className="hidden" />
              </div>

              {selectedObject && (
                <div className="space-y-6 pt-4 border-t border-slate-800">
                  <h3 className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Local Properties</h3>
                  <div className="space-y-2">
                    <label className="text-[8px] font-bold text-slate-600 uppercase">Entity Name</label>
                    <input 
                      type="text" 
                      value={selectedObject.name} 
                      onChange={e => updateObjectProperty(selectedObject.id, 'name', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-[10px] focus:ring-1 focus:ring-blue-500/50 outline-none"
                    />
                  </div>
                  
                  {(['position', 'rotation'] as const).map(prop => (
                    <div key={prop} className="space-y-4">
                      <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">{String(prop).toUpperCase()}</p>
                      {(['x', 'y', 'z'] as const).map(axis => (
                        <div key={`${prop}-${axis}`} className="space-y-1">
                          <div className="flex justify-between text-[7px] font-mono text-slate-500 uppercase">
                            <span>{axis}</span>
                            <span>{Number(selectedObject.transform[prop][axis]).toFixed(2)}</span>
                          </div>
                          <input 
                            type="range" min={prop === 'rotation' ? 0 : -5} max={prop === 'rotation' ? 360 : 5} step={prop === 'rotation' ? 1 : 0.01}
                            value={selectedObject.transform[prop][axis]}
                            onChange={e => updateObjectProperty(selectedObject.id, `transform.${prop}.${axis}`, parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-blue-600"
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'tracking' && (
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">AR Tracking Mode</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(['image', 'surface', 'face', 'portal'] as const).map(mode => (
                    <button 
                      key={mode} 
                      onClick={() => setExp(prev => ({ ...prev, trackingType: mode }))}
                      className={`p-4 rounded-xl border text-[10px] font-black uppercase transition-all flex flex-col items-center gap-2 ${exp.trackingType === mode ? 'bg-blue-600 border-blue-400 shadow-xl shadow-blue-900/40' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'}`}
                    >
                      <span className="text-xl">{mode === 'image' ? '📸' : mode === 'surface' ? '🏠' : mode === 'face' ? '👤' : '🌀'}</span>
                      <span className="tracking-tighter">{String(mode)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {exp.trackingType === 'image' && (
                <div className="space-y-4 pt-6 border-t border-slate-800 animate-in fade-in slide-in-from-top-4">
                  <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Marker Image Pipeline</h3>
                  <div 
                    onClick={() => targetInputRef.current?.click()}
                    className="w-full h-40 bg-slate-900 border border-dashed border-slate-700 rounded-2xl flex items-center justify-center cursor-pointer overflow-hidden group hover:border-blue-500/50 transition-all"
                  >
                    {exp.assets.targetImage ? (
                      <img src={exp.assets.targetImage} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="text-center space-y-2">
                        <span className="text-2xl opacity-20">🖼️</span>
                        <p className="text-[9px] font-bold text-slate-700 uppercase">Drop Calibration Marker</p>
                      </div>
                    )}
                    <input ref={targetInputRef} type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'target')} className="hidden" />
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'interactivity' && selectedObject && (
            <div className="space-y-6">
              <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Entity Logic</h3>
              <div className="space-y-4">
                <label className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl cursor-pointer hover:border-slate-700">
                  <span className="text-[10px] font-bold text-slate-300 uppercase">Auto-Play Animations</span>
                  <input 
                    type="checkbox" 
                    checked={selectedObject.animation.autoPlay} 
                    onChange={e => updateObjectProperty(selectedObject.id, 'animation.autoPlay', e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-blue-600"
                  />
                </label>

                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">Interaction Trigger</label>
                  <select 
                    value={selectedObject.animation.trigger}
                    onChange={e => updateObjectProperty(selectedObject.id, 'animation.trigger', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-[10px] font-bold text-slate-300 outline-none"
                  >
                    <option value="none">NO TRIGGER</option>
                    <option value="tap">ON TAP (CLICK)</option>
                    <option value="proximity">PROXIMITY ALERT</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Spatial Architect (AI)</h3>
              <textarea 
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="Describe your vision: 'A cyberpunk lounge with a floating robot bartender and holographic menus...'"
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-[11px] h-32 resize-none outline-none focus:border-blue-500/50 transition-all font-medium leading-relaxed"
              />
              <button 
                onClick={handleAiGenerateScene}
                disabled={aiLoading}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl text-[10px] font-black tracking-widest uppercase transition-all shadow-xl shadow-blue-900/40 active:scale-95 disabled:opacity-50"
              >
                {aiLoading ? 'SYNTHESIZING REALITY...' : 'GENERATE SCENE LAYOUT'}
              </button>
              <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                <p className="text-[8px] text-slate-500 leading-relaxed font-mono uppercase italic">
                  Lumina AI optimizes entity distribution and suggests the best tracking tech for your experience.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-950/80 border-t border-slate-800 space-y-3">
          <button onClick={() => onSave(exp)} className="w-full py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-[10px] font-black tracking-widest transition-all uppercase">COMMIT DATABASE</button>
          <button onClick={() => onPreview(exp)} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-[11px] font-black tracking-widest shadow-2xl shadow-blue-900/40 active:scale-95 uppercase">LAUNCH AR CONSOLE</button>
        </div>
      </div>

      <div className="flex-1 bg-[#050505] relative flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 opacity-20 z-0" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #1e293b 1px, transparent 0)', backgroundSize: '40px 40px' }} />

        <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
          <PerspectiveCamera makeDefault position={[5, 4, 6]} fov={45} />
          <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
          <ambientLight intensity={0.5} />
          <spotLight position={[10, 15, 10]} angle={0.2} penumbra={1} intensity={3} castShadow />
          <Environment preset="city" />

          <Suspense fallback={null}>
            {exp.sceneObjects.map(obj => (
              <group 
                key={obj.id} 
                position={[obj.transform.position.x, obj.transform.position.y, obj.transform.position.z]}
                rotation={[THREE.MathUtils.degToRad(obj.transform.rotation.x), THREE.MathUtils.degToRad(obj.transform.rotation.y), THREE.MathUtils.degToRad(obj.transform.rotation.z)]}
                scale={[obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z]}
                onClick={(e) => { e.stopPropagation(); setSelectedObjectId(obj.id); }}
              >
                <Gltf src={obj.url} castShadow receiveShadow />
                {selectedObjectId === obj.id && (
                  <mesh>
                    <boxGeometry args={[1.05, 1.05, 1.05]} />
                    <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.4} />
                  </mesh>
                )}
              </group>
            ))}
            
            <GroundPlane trackingType={exp.trackingType} targetImage={exp.assets.targetImage} />
            <gridHelper args={[20, 40, '#1e293b', '#0f172a']} position={[0, -0.06, 0]} />
            
            {exp.trackingType === 'portal' && <Sky sunPosition={[100, 20, 100]} />}
          </Suspense>

          <ContactShadows opacity={0.5} scale={20} blur={2.5} far={4} color="#000" />
        </Canvas>

        <div className="absolute top-10 left-10 pointer-events-none space-y-4">
          <div className="p-6 bg-black/70 backdrop-blur-3xl border border-white/5 rounded-3xl shadow-2xl">
            <h1 className="text-xl font-black tracking-tighter uppercase leading-none">{String(exp.name || 'UNNAMED_SPACE')}</h1>
            <div className="flex items-center gap-3 mt-3">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{String(exp.trackingType)} core ready</span>
            </div>
          </div>
          <div className="flex gap-2">
            {exp.sceneObjects.map(obj => (
              <div key={obj.id} className={`w-2 h-2 rounded-full ${selectedObjectId === obj.id ? 'bg-blue-500' : 'bg-slate-800'}`}></div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-10 right-10 flex gap-4">
           <div className="bg-black/60 backdrop-blur-xl border border-white/5 p-4 rounded-2xl flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-slate-500">
             <span>Entities: {exp.sceneObjects.length}</span>
             <div className="w-px h-3 bg-white/10"></div>
             <span>GPU Memory: Optimized</span>
           </div>
        </div>
      </div>
    </div>
  );
};

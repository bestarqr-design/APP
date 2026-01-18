
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
  businessData: { businessName: 'Lumina Global', ctaLink: 'https://lumina-ar.io' },
  updatedAt: Date.now()
});

const ModelInstance = ({ obj }: { obj: SceneObject }) => {
  const { scene } = useGLTF(obj.url);
  const clonedScene = useMemo(() => {
    const s = scene.clone();
    s.traverse((node: any) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    return s;
  }, [scene]);

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

  // GitHub Upload State
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubToken, setGithubToken] = useState(localStorage.getItem('lumina_github_token') || '');
  const [repoName, setRepoName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string[]>([]);
  
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

  const sortedExperiences = useMemo(() => {
    return [...experiences].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [experiences]);

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
      updatedAt: Date.now(),
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
        setExp(prev => ({ ...prev, sceneObjects: [...prev.sceneObjects, newObj], updatedAt: Date.now() }));
        setSelectedObjectId(newObj.id);
        addToast("3D Asset Imported Successfully", "success");
      } else if (type === 'target') {
        setExp(prev => ({ ...prev, assets: { ...prev.assets, targetImage: result }, updatedAt: Date.now() }));
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
        The scene should be either 'image' or 'surface' based. Return a set of entities with positions relative to the origin.`,
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
          sceneObjects: newObjects,
          updatedAt: Date.now()
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

  const generateProjectFiles = (targetExp: ARExperience) => {
    const safeName = (targetExp.name || 'Lumina_Project').trim().replace(/\s+/g, '_');
    return {
      'package.json': JSON.stringify({
        name: safeName.toLowerCase(),
        version: "1.0.0",
        type: "module",
        scripts: {
          "dev": "vite",
          "build": "tsc && vite build",
          "preview": "vite preview"
        },
        dependencies: {
          "react": "^18.3.1",
          "react-dom": "^18.3.1",
          "three": "^0.160.0",
          "@react-three/fiber": "^8.15.11",
          "@react-three/drei": "^9.88.16",
          "@react-three/postprocessing": "^2.16.0",
          "postprocessing": "^6.34.1"
        },
        devDependencies: {
          "vite": "^5.0.0",
          "typescript": "^5.0.0",
          "tailwindcss": "^3.4.0",
          "postcss": "^8.4.0",
          "autoprefixer": "^10.4.0",
          "@types/react": "^18.3.1",
          "@types/react-dom": "^18.3.1"
        }
      }, null, 2),
      'vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  build: { outDir: 'dist' }\n});`,
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: "ESNext", jsx: "react-jsx", module: "ESNext", moduleResolution: "node", strict: true, skipLibCheck: true, esModuleInterop: true } }, null, 2),
      '.gitignore': "node_modules\ndist\n.DS_Store\n.env\n",
      'README.md': `# ${targetExp.name}\n\nGenerated with LuminaAR Studio.\n\n## Launch\n1. \`npm install\`\n2. \`npm run dev\`\n\nDeploy to GitHub Pages by pushing the \`dist\` folder or using a GitHub Action.`,
      'src/project_data.json': JSON.stringify(targetExp, null, 2),
      'src/main.tsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);`,
      'src/index.css': `@tailwind base;\n@tailwind components;\n@tailwind utilities;`,
      'src/App.tsx': `import React from 'react';\nimport { Canvas } from '@react-three/fiber';\nimport { Environment, PerspectiveCamera, OrbitControls } from '@react-three/drei';\nimport data from './project_data.json';\n\nexport default function App() {\n  return (\n    <div className="h-screen bg-black overflow-hidden">\n      <Canvas shadows>\n        <PerspectiveCamera makeDefault position={[5, 5, 5]} />\n        <OrbitControls />\n        <ambientLight intensity={1} />\n        <directionalLight position={[10, 10, 5]} intensity={2} />\n        <Environment preset="city" />\n        <mesh>\n           <boxGeometry />\n           <meshStandardMaterial color="blue" />\n        </mesh>\n      </Canvas>\n      <div className="absolute top-10 left-10 p-6 bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl text-white">\n        <h1 className="text-xl font-black uppercase tracking-widest">{data.name}</h1>\n        <p className="text-[10px] opacity-40 uppercase tracking-widest mt-2">Powered by LuminaAR Engine</p>\n      </div>\n    </div>\n  );\n}`,
      'public/index.html': `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${targetExp.name}</title></head><body class="bg-black"><div id="root"></div></body></html>`
    };
  };

  const handleExport = async (targetExp: ARExperience = exp) => {
    setIsExporting(true);
    addToast(`Bundling GitHub Repo: ${targetExp.name}`, "info");
    try {
      const zip = new JSZip();
      const files = generateProjectFiles(targetExp);
      Object.entries(files).forEach(([path, content]) => zip.file(path, content));
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(targetExp.name || 'Lumina_Project').replace(/\s+/g, '_')}_Bundle.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
      addToast("Repository ZIP Generated", "success");
    } catch (e) {
      addToast("Export Failed", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDirectGithubUpload = async () => {
    if (!githubToken || !repoName) {
      addToast("Token and Repository Name required", "error");
      return;
    }
    setIsUploading(true);
    setUploadStatus(["Initiating Handshake...", "Authenticating with GitHub REST v3..."]);
    localStorage.setItem('lumina_github_token', githubToken);

    try {
      const createRepoRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, description: `WebAR experience: ${exp.name}`, private: false })
      });

      if (!createRepoRes.ok) throw new Error("Repository initialization failed.");
      setUploadStatus(prev => [...prev, "✓ Repository Created", "Committing Spatial Grid..."]);

      const files = generateProjectFiles(exp);
      for (const [path, content] of Object.entries(files)) {
        setUploadStatus(prev => [...prev, `Pushing: ${path}...`]);
        await fetch(`https://api.github.com/repos/user/${repoName}/contents/${path}`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Lumina: ${path}`, content: btoa(unescape(encodeURIComponent(content))) })
        });
      }
      setUploadStatus(prev => [...prev, "✓ Deployment Successful!", `Target: github.com/${repoName}`]);
      addToast("Direct GitHub Sync Complete", "success");
    } catch (e: any) {
      setUploadStatus(prev => [...prev, `Critical: ${e.message}`]);
      addToast(`Upload Error: ${e.message}`, "error");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateNew = () => {
    const newExp = createEmptyExperience();
    setExp(newExp);
    setSelectedObjectId(newExp.sceneObjects[0]?.id || null);
    setActiveSidebarTab('hierarchy');
    addToast("New Project Initialized", "info");
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
        gridColor: '#e2e8f0',
        gridCenterColor: '#f1f5f9',
        cardBg: 'bg-slate-100/50',
        cardHover: 'hover:bg-blue-600/5'
      };

  return (
    <div className={`flex h-screen ${themeClasses.bg} ${themeClasses.text} font-sans overflow-hidden transition-all duration-300 select-none`}>
      {/* Toast Layer */}
      <div className="fixed bottom-10 right-10 z-[100] flex flex-col gap-3">
        {toasts.map(toast => (
          <div key={toast.id} className={`px-8 py-4 rounded-3xl backdrop-blur-2xl border flex items-center gap-4 shadow-2xl animate-slide-in-right ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
            <span className="text-[11px] font-black uppercase tracking-widest">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* GitHub Modal */}
      {showGithubModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in p-6">
          <div className={`${themeClasses.panel} border ${themeClasses.border} w-full max-w-xl rounded-[3rem] p-12 shadow-2xl animate-scale-up space-y-8 relative overflow-hidden`}>
             <button onClick={() => setShowGithubModal(false)} className="absolute top-8 right-8 text-xl opacity-40 hover:opacity-100">✕</button>
             <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-white text-black rounded-2xl flex items-center justify-center text-3xl shadow-2xl">🐙</div>
                <div><h2 className="text-xl font-black uppercase tracking-tighter">Spatial Repository Sync</h2><p className="text-[9px] opacity-40 uppercase tracking-widest">v5.0 Pro Interface</p></div>
             </div>
             <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[9px] font-black uppercase tracking-widest text-blue-500 ml-1">GitHub Access Token</label>
                   <input type="password" value={githubToken} onChange={e => setGithubToken(e.target.value)} placeholder="ghp_..." className={`w-full ${themeClasses.input} border ${themeClasses.border} rounded-2xl px-6 py-4 text-xs font-mono outline-none focus:border-blue-500`} />
                </div>
                <div className="space-y-2">
                   <label className="text-[9px] font-black uppercase tracking-widest text-blue-500 ml-1">Repository Identifier</label>
                   <input value={repoName} onChange={e => setRepoName(e.target.value.replace(/\s+/g, '-'))} placeholder="project-name" className={`w-full ${themeClasses.input} border ${themeClasses.border} rounded-2xl px-6 py-4 text-xs font-bold outline-none focus:border-blue-500`} />
                </div>
             </div>
             <div className="h-40 bg-black/60 rounded-3xl p-6 font-mono text-[9px] text-blue-400 overflow-y-auto space-y-2 custom-scrollbar">
                {uploadStatus.map((s, i) => <div key={i} className="animate-fade-in">{s}</div>)}
                {uploadStatus.length === 0 && <div className="opacity-20">Awaiting user input...</div>}
             </div>
             <button onClick={handleDirectGithubUpload} disabled={isUploading} className={`w-full py-5 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-[11px] transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3 ${isUploading ? 'bg-white/10 text-white/40' : 'bg-white text-black hover:bg-blue-600 hover:text-white'}`}>
                {isUploading ? 'UPLOADING...' : 'PUSH TO GITHUB'}
             </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`w-80 border-r ${themeClasses.border} ${themeClasses.panel} flex flex-col shrink-0 z-30 shadow-2xl`}>
        <div className={`p-8 border-b ${themeClasses.border} flex items-center justify-between`}>
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center font-black text-white text-xs shadow-xl shadow-blue-500/40">L</div>
             <div><h1 className="text-[10px] font-black uppercase tracking-[0.3em]">Lumina Pro</h1><span className="text-[8px] opacity-40 font-mono">v5.0-AR</span></div>
          </div>
          <button onClick={toggleTheme} className={`w-10 h-10 flex items-center justify-center rounded-2xl transition-all ${themeClasses.accent} hover:scale-110 shadow-lg`}>{theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          <div className={`flex p-1 ${themeClasses.bg} rounded-2xl border ${themeClasses.border} shadow-inner`}>
            {(['hierarchy', 'tracking', 'ai', 'gallery'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveSidebarTab(tab)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-tighter transition-all ${activeSidebarTab === tab ? themeClasses.tabActive : themeClasses.tabInactive}`}>{tab}</button>
            ))}
          </div>

          {activeSidebarTab === 'hierarchy' && (
            <div className="space-y-4 animate-slide-in-left">
              <div className="flex items-center justify-between px-2"><span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Entities</span><button onClick={() => modelInputRef.current?.click()} className="text-[9px] font-black text-blue-500 hover:text-blue-400">Import Asset</button></div>
              <div className="space-y-2">
                {exp.sceneObjects.map(obj => (
                  <div key={obj.id} onClick={() => setSelectedObjectId(obj.id)} className={`group flex items-center gap-4 p-5 rounded-2xl border transition-all cursor-pointer ${selectedObjectId === obj.id ? 'bg-blue-600/10 border-blue-500/40 text-blue-500 font-bold' : `bg-transparent border-transparent ${themeClasses.subText} hover:bg-blue-500/5`}`}>
                    <span className="text-xl">📦</span>
                    <p className="flex-1 text-[11px] uppercase tracking-tight truncate">{obj.name}</p>
                    <button onClick={(e) => { e.stopPropagation(); setExp(prev => ({ ...prev, sceneObjects: prev.sceneObjects.filter(o => o.id !== obj.id), updatedAt: Date.now() })); }} className="opacity-0 group-hover:opacity-100 text-red-500 text-xs p-2">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSidebarTab === 'gallery' && (
            <div className="space-y-6 animate-slide-in-up">
               <div className="flex items-center justify-between px-2"><span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Experience Hub</span><button onClick={handleCreateNew} className="text-[9px] font-black text-blue-500">+ CREATE</button></div>
               <div className="grid grid-cols-1 gap-6">
                 {sortedExperiences.map(project => (
                   <div key={project.id} onClick={() => { setExp(project); setSelectedObjectId(project.sceneObjects[0]?.id || null); addToast(`Loaded: ${project.name}`, 'info'); }} className={`group relative rounded-[2.5rem] border overflow-hidden transition-all duration-300 cursor-pointer ${themeClasses.cardBg} ${project.id === exp.id ? 'border-blue-500 ring-4 ring-blue-500/10 scale-105' : themeClasses.border}`}>
                     <div className="aspect-[16/9] bg-black/40 relative flex items-center justify-center">
                        {project.assets.targetImage ? <img src={project.assets.targetImage} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all duration-700" alt="" /> : <span className="text-4xl">🛰️</span>}
                        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); handleExport(project); }} className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-2xl">🚀</button></div>
                     </div>
                     <div className="p-6 space-y-4">
                        <div className="flex justify-between items-center"><h3 className="text-[12px] font-black uppercase tracking-tight truncate">{project.name}</h3><span className="text-[8px] font-mono opacity-30">{new Date(project.updatedAt).toLocaleTimeString()}</span></div>
                        <div className="flex gap-2">
                           <button onClick={(e) => { e.stopPropagation(); onPreview(project); }} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[8px] font-black uppercase tracking-widest transition-all">Launch AR</button>
                           <button onClick={(e) => { e.stopPropagation(); onDelete(project.id); }} className="w-12 h-12 flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all">✕</button>
                        </div>
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          )}

          {activeSidebarTab === 'ai' && (
            <div className="space-y-6 animate-fade-in">
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 px-2">Spatial Synthesis</span>
              <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="Ex: 'Futuristic gallery with floating holograms'" className={`w-full h-48 ${themeClasses.input} border ${themeClasses.border} rounded-[2rem] p-6 text-[11px] outline-none resize-none transition-all placeholder:opacity-20 leading-relaxed focus:border-blue-500/30`} />
              <button onClick={handleAiAssistant} disabled={aiLoading} className="w-full py-5 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest shadow-2xl active:scale-95 disabled:opacity-50 transition-all">{aiLoading ? 'SYNTHTESIZING...' : 'CONSTRUCT GRID'}</button>
            </div>
          )}
        </div>

        <div className={`p-8 border-t ${themeClasses.border} space-y-4 ${themeClasses.panel}`}>
          <div className="flex gap-2">
            <button onClick={() => onSave(exp)} className={`flex-1 py-4 ${themeClasses.accent} rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-500/10 hover:text-blue-500 transition-all`}>Save State</button>
            <button onClick={() => setShowGithubModal(true)} title="Deploy to GitHub" className={`p-4 ${themeClasses.accent} rounded-2xl text-xl hover:bg-white hover:text-black transition-all`}>🐙</button>
          </div>
          <button onClick={() => onPreview(exp)} className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-[1.5rem] text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl active:scale-95 transition-all">Launch Preview</button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative flex flex-col">
        <div className="absolute top-10 left-10 z-20 p-10 bg-black/60 backdrop-blur-3xl border border-white/10 rounded-[3rem] shadow-2xl min-w-[360px] group/hud hover:bg-black/80 transition-all">
          <div className="flex flex-col gap-1 mb-2">
            <span className="text-[8px] font-black uppercase tracking-[0.5em] text-blue-500/80">Active Workspace</span>
            <input value={exp.name} onChange={e => setExp(prev => ({ ...prev, name: e.target.value, updatedAt: Date.now() }))} placeholder="Unnamed Exp" className="bg-transparent text-2xl font-black uppercase tracking-tighter text-white outline-none w-full border-b border-transparent focus:border-blue-500/30 pb-1" />
          </div>
          <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.3em] font-bold">MODE: {exp.trackingType.toUpperCase()}</span>
        </div>

        <div className={`flex-1 transition-colors duration-500 ${themeClasses.bg}`}>
          <Canvas shadows gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
            <PerspectiveCamera makeDefault position={[12, 10, 12]} fov={35} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
            <ambientLight intensity={theme === 'dark' ? 0.4 : 1.2} />
            <directionalLight position={[10, 20, 10]} intensity={theme === 'dark' ? 2 : 1.5} castShadow />
            <Suspense fallback={<Html center className="text-blue-500 font-black animate-pulse text-[10px] tracking-[0.8em]">SYNCHING...</Html>}>
              <group>
                {exp.sceneObjects.map(obj => (
                  <group key={obj.id} position={[obj.transform.position.x, obj.transform.position.y, obj.transform.position.z]} rotation={[THREE.MathUtils.degToRad(obj.transform.rotation.x), THREE.MathUtils.degToRad(obj.transform.rotation.y), THREE.MathUtils.degToRad(obj.transform.rotation.z)]} scale={[obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z]} onClick={(e) => { e.stopPropagation(); setSelectedObjectId(obj.id); }}>
                    <ModelInstance obj={obj} />
                    {selectedObjectId === obj.id && <mesh><boxGeometry args={[1.5, 1.5, 1.5]} /><meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.3} /></mesh>}
                  </group>
                ))}
              </group>
              <GroundPlane trackingType={exp.trackingType} targetImage={exp.assets.targetImage} theme={theme} />
              <Environment preset="city" />
              <gridHelper args={[80, 160, themeClasses.gridColor, themeClasses.gridCenterColor]} position={[0, -0.02, 0]} />
            </Suspense>
          </Canvas>
        </div>
      </div>

      {/* Control Sidebar */}
      <div className={`w-80 border-l ${themeClasses.border} ${themeClasses.panel} flex flex-col shrink-0 overflow-y-auto custom-scrollbar shadow-2xl z-20`}>
        {selectedObject ? (
          <div className="p-10 space-y-12 animate-slide-in-right">
            <div className="space-y-4">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Identity</span>
              <input value={selectedObject.name} onChange={e => updateObjectProperty(selectedObject.id, 'name', e.target.value)} className={`w-full ${themeClasses.input} border ${themeClasses.border} rounded-2xl px-6 py-4 text-xs outline-none focus:border-blue-500 font-bold`} />
            </div>
            <div className="space-y-10">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Spatial Geometry</span>
              {(['position', 'rotation', 'scale'] as const).map(prop => (
                <div key={prop} className="space-y-6">
                   <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.3em]">{prop}</p>
                   {(['x', 'y', 'z'] as const).map(axis => (
                     <div key={axis} className="space-y-2">
                        <div className="flex justify-between text-[9px] font-mono text-blue-500 font-bold uppercase"><span>{axis}</span><span>{selectedObject.transform[prop][axis].toFixed(2)}</span></div>
                        <input type="range" min={prop === 'rotation' ? -180 : -20} max={prop === 'rotation' ? 180 : 20} step={0.05} value={selectedObject.transform[prop][axis]} onChange={e => updateObjectProperty(selectedObject.id, `transform.${prop}.${axis}`, parseFloat(e.target.value))} className="w-full h-1 bg-blue-500/10 rounded-full appearance-none accent-blue-600 cursor-pointer" />
                     </div>
                   ))}
                </div>
              ))}
            </div>
            <div className="space-y-6 pt-10 border-t border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500">Core Logic</span>
              <div className="space-y-3">
                {[
                  { label: 'Bloom FX', key: 'bloom', icon: '✨' },
                  { label: 'Auto Rotation', key: 'autoRotate', icon: '🔄' },
                  { label: 'Spatial Gestures', key: 'gestureControl', icon: '🤌' }
                ].map(opt => (
                  <label key={opt.key} className="flex items-center justify-between p-5 bg-blue-500/5 rounded-2xl border border-blue-500/10 cursor-pointer hover:bg-blue-500/10 transition-all">
                    <span className="text-[10px] font-black uppercase tracking-tight">{opt.icon} {opt.label}</span>
                    <input type="checkbox" checked={(exp.config as any)[opt.key]} onChange={e => setExp(prev => ({ ...prev, updatedAt: Date.now(), config: { ...prev.config, [opt.key]: e.target.checked } }))} className="w-5 h-5 accent-blue-600" />
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-14 text-center opacity-20"><span className="text-6xl mb-8">🔭</span><p className="text-[11px] font-black uppercase tracking-[0.6em] leading-relaxed">System Idle<br/>Await Telemetry...</p></div>
        )}
      </div>

      {/* Uploads */}
      <input ref={modelInputRef} type="file" accept=".glb,.gltf" onChange={e => handleFileUpload(e, 'model')} className="hidden" />
      <input ref={targetInputRef} type="file" accept="image/*" onChange={e => handleFileUpload(e, 'target')} className="hidden" />
      <input ref={diffuseInputRef} type="file" accept="image/*" onChange={e => handleFileUpload(e, 'diffuse')} className="hidden" />
    </div>
  );
};

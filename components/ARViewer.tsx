
import React, { useEffect, useRef, useState, Suspense, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, ContactShadows, PerspectiveCamera, useTexture, Float, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { ARExperience, SceneObject } from '../types';
import { PoseSmoother } from '../utils/kalman';

interface ARViewerProps {
  experience: ARExperience;
  onUpdate?: (transform: ARExperience['transform']) => void;
  onTrackingStatusChange?: (status: 'searching' | 'found' | 'lost') => void;
}

const ModelInstance = ({ obj, rotationOffset }: { obj: SceneObject, rotationOffset: number }) => {
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

  return (
    <primitive 
      object={clonedScene} 
      rotation={[0, rotationOffset, 0]}
    />
  );
};

const ARSceneContent: React.FC<{ 
  experience: ARExperience; 
  isTracking: boolean;
  smoother: PoseSmoother;
}> = ({ experience, isTracking, smoother }) => {
  const rootRef = useRef<THREE.Group>(null);
  const [rotationOffset, setRotationOffset] = useState(0);

  useFrame(() => {
    if (!rootRef.current) return;
    if (isTracking) {
      const [sx, sy, sz] = smoother.smoothPosition(0, 0, 0);
      rootRef.current.position.set(sx, sy, sz);
    }
    rootRef.current.visible = isTracking || experience.config.ghostMode;
    
    if (rootRef.current.visible) {
      rootRef.current.traverse((obj: any) => {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = THREE.MathUtils.lerp(obj.material.opacity || 1, isTracking ? 1.0 : 0.2, 0.1);
        }
      });
    }

    if (experience.config.autoRotate) {
      rootRef.current.rotation.y += 0.015;
    }
  });

  const handlePointerDown = (e: any) => {
    if (!experience.config.gestureControl) return;
    e.stopPropagation();
    setRotationOffset(prev => prev + Math.PI / 4);
  };

  return (
    <group ref={rootRef} onPointerDown={handlePointerDown}>
      {experience.sceneObjects.map(obj => (
        <group 
          key={obj.id}
          position={[obj.transform.position.x, obj.transform.position.y, obj.transform.position.z]}
          rotation={[
            THREE.MathUtils.degToRad(obj.transform.rotation.x), 
            THREE.MathUtils.degToRad(obj.transform.rotation.y), 
            THREE.MathUtils.degToRad(obj.transform.rotation.z)
          ]}
          scale={[obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z]}
        >
          <Suspense fallback={null}>
            <Float 
              speed={obj.animation.autoPlay ? 2.5 : 0} 
              rotationIntensity={0.25} 
              floatIntensity={0.25}
            >
              <ModelInstance obj={obj} rotationOffset={rotationOffset} />
            </Float>
          </Suspense>
        </group>
      ))}
      <ContactShadows opacity={experience.config.shadowIntensity} scale={20} blur={3} far={15} color="#000" />
    </group>
  );
};

export const ARViewer: React.FC<ARViewerProps> = ({ experience, onUpdate, onTrackingStatusChange }) => {
  const [isTracking, setIsTracking] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const poseSmootherRef = useRef(new PoseSmoother());

  useEffect(() => {
    const setupCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => videoRef.current?.play();
        }
        // Simulation of tracking algorithm lock-on
        const timer = setTimeout(() => {
          setIsTracking(true);
          onTrackingStatusChange?.('found');
        }, 3500);
        return () => clearTimeout(timer);
      } catch (err) {
        setCameraError("Hardware Conflict: Camera stream unreachable.");
      }
    };
    setupCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden font-sans">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-0 brightness-[0.75] contrast-[1.1] grayscale-[0.2]" />
      
      <div className="absolute inset-0 z-10">
        <Canvas shadows gl={{ antialias: true, alpha: true }}>
          <PerspectiveCamera makeDefault position={[0, 2, 6]} fov={50} />
          <ambientLight intensity={1.5} />
          <directionalLight position={[10, 15, 10]} intensity={2.5} castShadow />
          <pointLight position={[-10, 5, -10]} intensity={1.0} color="#3b82f6" />
          <ARSceneContent experience={experience} isTracking={isTracking} smoother={poseSmootherRef.current} />
          {/* Switched to warehouse preset and added Suspense fallback for stability */}
          <Suspense fallback={null}>
            <Environment preset="warehouse" />
          </Suspense>
        </Canvas>
      </div>

      <div className="absolute inset-0 pointer-events-none z-20 p-10">
        <div className="flex justify-between items-start">
           <div className="p-6 bg-black/50 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl">
              <div className="flex items-center gap-5">
                 <div className="w-14 h-14 bg-blue-600 rounded-[1.5rem] flex items-center justify-center font-black text-white text-base shadow-2xl shadow-blue-500/40">L</div>
                 <div>
                    <h1 className="text-[12px] font-black uppercase tracking-[0.5em] text-white">Lumina Lens v4</h1>
                    <div className="flex items-center gap-2 mt-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${isTracking ? 'bg-green-500 shadow-[0_0_12px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
                      <span className="text-[9px] font-mono text-slate-300 uppercase tracking-widest">
                        {isTracking ? `LOCKED: ${experience.trackingType.toUpperCase()}` : 'SCANNING_ENVIRONMENT...'}
                      </span>
                    </div>
                 </div>
              </div>
           </div>

           {experience.trackingType === 'image' && experience.assets.targetImage && (
             <div className="w-24 h-24 bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl animate-in zoom-in-50 duration-500">
               <img src={experience.assets.targetImage} className="w-full h-full object-cover opacity-50 grayscale" alt="Target" />
               <div className="absolute inset-0 border-2 border-blue-500/30 animate-pulse"></div>
             </div>
           )}
        </div>

        {experience.config.gestureControl && isTracking && (
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 px-10 py-5 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-full text-[10px] font-black uppercase tracking-[0.4em] text-white shadow-2xl animate-in slide-in-from-bottom-10 duration-700">
            Tap Object to Adjust Orientation
          </div>
        )}
      </div>

      {!isTracking && !cameraError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xl">
          <div className="relative mb-12">
            <div className="w-32 h-32 border-2 border-dashed border-blue-500/40 rounded-[3rem] flex items-center justify-center animate-spin-slow"></div>
            <div className="absolute inset-0 flex items-center justify-center">
               <div className="w-6 h-6 bg-blue-600 rounded-full shadow-[0_0_30px_#3b82f6] animate-ping"></div>
            </div>
          </div>
          <h2 className="text-white text-[12px] font-black uppercase tracking-[1em] mb-6">Aligning Spatial Vectors</h2>
          <p className="text-slate-400 text-[9px] uppercase tracking-[0.25em] font-bold max-sm text-center leading-loose px-12 opacity-60">
            Slowly pan the device over your surroundings to establish a stable anchor point.
          </p>
        </div>
      )}

      {cameraError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#050608] p-16 text-center">
          <div className="max-w-md space-y-10 animate-in zoom-in-90 duration-1000">
            <div className="text-7xl mb-10">🔮</div>
            <h2 className="text-white text-base font-black uppercase tracking-[0.4em] leading-loose">{cameraError}</h2>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">Ensure camera permissions are granted in your system settings.</p>
            <button onClick={() => window.location.reload()} className="w-full py-5 bg-blue-600 text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-3xl shadow-2xl shadow-blue-500/40 transition-all active:scale-95 hover:bg-blue-500">Restart Session</button>
          </div>
        </div>
      )}

      <style>{`
        .animate-spin-slow { animation: spin 10s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

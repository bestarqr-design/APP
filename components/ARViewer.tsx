
import React, { useEffect, useRef, useState, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
// Added missing Float import from @react-three/drei
import { useGLTF, Environment, ContactShadows, PerspectiveCamera, Html, Gltf, Float } from '@react-three/drei';
import * as THREE from 'three';
import { ARExperience, SceneObject } from '../types';
import { PoseSmoother } from '../utils/kalman';

interface ARViewerProps {
  experience: ARExperience;
  onUpdate?: (transform: ARExperience['transform']) => void;
  onTrackingStatusChange?: (status: 'searching' | 'found' | 'lost') => void;
}

const ARSceneContent: React.FC<{ 
  experience: ARExperience; 
  isTracking: boolean;
  smoother: PoseSmoother;
}> = ({ experience, isTracking, smoother }) => {
  const rootRef = useRef<THREE.Group>(null);
  const [activeAnims, setActiveAnims] = useState<Record<string, boolean>>({});

  useFrame((state) => {
    if (!rootRef.current) return;

    // Simulate pose estimation smoothing
    // In a real MindAR implementation, we would pass the marker's matrix here
    if (isTracking) {
      const [sx, sy, sz] = smoother.smoothPosition(0, 0, 0);
      rootRef.current.position.set(sx, sy, sz);
      
      const [rx, ry, rz] = smoother.smoothRotation(0, 0, 0);
      rootRef.current.rotation.set(rx, ry, rz);
    }

    // Ghosting / visibility logic
    rootRef.current.visible = isTracking || experience.config.ghostMode;
    if (rootRef.current.visible) {
      rootRef.current.traverse((obj: any) => {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = THREE.MathUtils.lerp(
            obj.material.opacity || 1, 
            isTracking ? 1.0 : 0.2, 
            0.1
          );
        }
      });
    }

    // Auto-rotation logic if enabled
    if (experience.config.autoRotate) {
      rootRef.current.rotation.y += 0.01;
    }
  });

  const handleEntityClick = (obj: SceneObject) => {
    if (obj.animation.trigger === 'tap') {
      setActiveAnims(prev => ({ ...prev, [obj.id]: !prev[obj.id] }));
    }
  };

  return (
    <group ref={rootRef}>
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
          onClick={(e) => { e.stopPropagation(); handleEntityClick(obj); }}
        >
          <Suspense fallback={null}>
            {/* Added Float wrapper for animation effects */}
            <Float 
              speed={activeAnims[obj.id] || obj.animation.autoPlay ? 2 : 0} 
              rotationIntensity={activeAnims[obj.id] || obj.animation.autoPlay ? 1 : 0} 
              floatIntensity={activeAnims[obj.id] || obj.animation.autoPlay ? 0.5 : 0}
            >
              <Gltf src={obj.url} />
            </Float>
          </Suspense>
        </group>
      ))}
      <ContactShadows opacity={experience.config.shadowIntensity} scale={15} blur={3} far={10} resolution={256} color="#000" />
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
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => videoRef.current?.play();
        }
        // Simulation of tracking discovery
        setTimeout(() => {
          setIsTracking(true);
          onTrackingStatusChange?.('found');
        }, 2000);
      } catch (err) {
        setCameraError("Camera permission denied. Manual override required.");
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
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-0 brightness-[0.85] contrast-[1.1] grayscale-[0.1]" />
      
      <div className="absolute inset-0 z-10">
        <Canvas shadows gl={{ antialias: true, alpha: true }}>
          <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={75} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 10, 5]} intensity={1.5} castShadow />
          <ARSceneContent experience={experience} isTracking={isTracking} smoother={poseSmootherRef.current} />
          <Environment preset="city" />
        </Canvas>
      </div>

      {/* Industrial Grade HUD */}
      <div className="absolute top-10 left-10 right-10 z-30 pointer-events-none flex justify-between items-start">
        <div className="p-5 bg-black/60 backdrop-blur-2xl border border-white/5 rounded-3xl shadow-2xl">
          <h1 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Lumina Runtime v3.0</h1>
          <div className="flex items-center gap-3 mt-2">
            <div className={`w-2 h-2 rounded-full ${isTracking ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
            <span className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">
              {isTracking ? `${experience.trackingType.toUpperCase()}_LOCKED` : 'SYNCHRONIZING_SENSORS...'}
            </span>
          </div>
        </div>

        {experience.trackingType === 'image' && experience.assets.targetImage && (
          <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
            <img src={experience.assets.targetImage} className="w-full h-full object-cover opacity-60" alt="Target" />
            <div className="absolute inset-0 border-2 border-blue-500/30 animate-pulse"></div>
          </div>
        )}
      </div>

      {!isTracking && !cameraError && (
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-center p-12 text-center bg-black/20">
          <div className="w-24 h-24 border-2 border-dashed border-blue-500/40 rounded-3xl mb-6 flex items-center justify-center animate-spin-slow">
            <span className="text-2xl">🛰️</span>
          </div>
          <h2 className="text-white text-xs font-black uppercase tracking-[0.4em] mb-2 drop-shadow-lg">Searching for Spatial Anchor</h2>
          <p className="text-slate-400 text-[9px] uppercase tracking-widest font-bold">
            {experience.trackingType === 'image' ? 'Align camera with marker image' : 'Slowly scan nearby horizontal surfaces'}
          </p>
        </div>
      )}

      {cameraError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950 p-10 text-center">
          <div className="max-w-xs space-y-4">
            <span className="text-3xl">⚠️</span>
            <h2 className="text-white text-sm font-black uppercase tracking-widest">{cameraError}</h2>
            <p className="text-slate-500 text-[9px] uppercase leading-relaxed font-bold">Security protocol blocked sensor access. Check browser permissions.</p>
          </div>
        </div>
      )}

      <style>{`
        .animate-spin-slow { animation: spin 4s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

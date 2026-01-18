
import React, { useEffect, useRef, useState, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
  onTransformChange: (t: ARExperience['transform']) => void;
}> = ({ experience, isTracking, smoother, onTransformChange }) => {
  const rootRef = useRef<THREE.Group>(null);
  const { camera, raycaster, size } = useThree();
  const [rotationOffset, setRotationOffset] = useState(experience.transform.rotation.y);
  
  // Gesture State
  const pointers = useRef(new Map<number, THREE.Vector2>());
  const initialPinchDist = useRef<number>(0);
  const initialPinchScale = useRef<number>(experience.transform.scale.x);
  const initialPinchAngle = useRef<number>(0);
  const initialRotation = useRef<number>(0);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersectionPoint = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!rootRef.current) return;
    
    // Tracking/Ghost Mode Logic
    rootRef.current.visible = isTracking || experience.config.ghostMode;
    if (rootRef.current.visible) {
      rootRef.current.traverse((obj: any) => {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = THREE.MathUtils.lerp(obj.material.opacity || 1, isTracking ? 1.0 : 0.2, 0.1);
        }
      });
    }

    if (experience.config.autoRotate && pointers.current.size === 0) {
      rootRef.current.rotation.y += 0.01;
    }
  });

  const getPinchData = () => {
    const pts = Array.from(pointers.current.values());
    if (pts.length < 2) return null;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    return { dist, angle };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!experience.config.gestureControl) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));

    if (pointers.current.size === 2) {
      const data = getPinchData();
      if (data) {
        initialPinchDist.current = data.dist;
        initialPinchScale.current = rootRef.current?.scale.x || 1;
        initialPinchAngle.current = data.angle;
        initialRotation.current = rotationOffset;
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!experience.config.gestureControl || !rootRef.current) return;
    pointers.current.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));

    if (pointers.current.size === 1) {
      // Translation (Single Finger Drag on XZ Plane)
      const mouse = new THREE.Vector2(
        (e.clientX / size.width) * 2 - 1,
        -(e.clientY / size.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
        rootRef.current.position.copy(intersectionPoint);
      }
    } else if (pointers.current.size === 2) {
      // Scale & Rotate (Pinch/Twist)
      const data = getPinchData();
      if (data) {
        const scaleFactor = data.dist / initialPinchDist.current;
        const newScale = Math.max(0.1, Math.min(10, initialPinchScale.current * scaleFactor));
        rootRef.current.scale.set(newScale, newScale, newScale);

        const angleDelta = data.angle - initialPinchAngle.current;
        setRotationOffset(initialRotation.current - angleDelta);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && rootRef.current) {
      // Save current state back to experience
      onTransformChange({
        position: { x: rootRef.current.position.x, y: rootRef.current.position.y, z: rootRef.current.position.z },
        rotation: { x: 0, y: THREE.MathUtils.radToDeg(rotationOffset), z: 0 },
        scale: { x: rootRef.current.scale.x, y: rootRef.current.scale.y, z: rootRef.current.scale.z }
      });
    }
  };

  return (
    <group 
      ref={rootRef} 
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      position={[experience.transform.position.x, experience.transform.position.y, experience.transform.position.z]}
      scale={[experience.transform.scale.x, experience.transform.scale.y, experience.transform.scale.z]}
    >
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
        // Simulation of high-fidelity spatial anchoring
        const timer = setTimeout(() => {
          setIsTracking(true);
          onTrackingStatusChange?.('found');
        }, 3000);
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
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="absolute inset-0 w-full h-full object-cover z-0 brightness-[0.8] contrast-[1.05]" 
      />
      
      <div className="absolute inset-0 z-10">
        <Canvas shadows gl={{ antialias: true, alpha: true }}>
          <PerspectiveCamera makeDefault position={[0, 2, 8]} fov={45} />
          <ambientLight intensity={1.5} />
          <directionalLight position={[10, 15, 10]} intensity={2.5} castShadow />
          <pointLight position={[-10, 5, -10]} intensity={1.0} color="#3b82f6" />
          <ARSceneContent 
            experience={experience} 
            isTracking={isTracking} 
            smoother={poseSmootherRef.current}
            onTransformChange={onUpdate || (() => {})}
          />
          <Suspense fallback={null}>
            <Environment preset="warehouse" />
          </Suspense>
        </Canvas>
      </div>

      {/* Persistent UI HUD */}
      <div className="absolute inset-0 pointer-events-none z-20 p-8 sm:p-12">
        <div className="flex justify-between items-start">
           <div className="p-6 bg-black/60 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl">
              <div className="flex items-center gap-5">
                 <div className="w-14 h-14 bg-blue-600 rounded-[1.5rem] flex items-center justify-center font-black text-white text-base shadow-2xl shadow-blue-500/40">L</div>
                 <div>
                    <h1 className="text-[12px] font-black uppercase tracking-[0.5em] text-white">{experience.name}</h1>
                    <div className="flex items-center gap-2 mt-2">
                      <div className={`w-2 h-2 rounded-full ${isTracking ? 'bg-green-500 shadow-[0_0_12px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
                      <span className="text-[8px] font-mono text-slate-300 uppercase tracking-widest">
                        {isTracking ? `ACTIVE: ${experience.trackingType}` : 'SEARCHING...'}
                      </span>
                    </div>
                 </div>
              </div>
           </div>
        </div>

        {experience.config.gestureControl && isTracking && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4">
             <div className="px-10 py-5 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-[9px] font-black uppercase tracking-[0.4em] text-white shadow-2xl animate-in fade-in slide-in-from-bottom-5 duration-1000">
                Gestures Enabled: Move • Scale • Rotate
             </div>
             <div className="flex gap-4 opacity-40">
                <span className="text-xl">☝️</span>
                <span className="text-xl">✌️</span>
             </div>
          </div>
        )}
      </div>

      {/* Alignment Screen */}
      {!isTracking && !cameraError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xl">
          <div className="relative mb-12">
            <div className="w-32 h-32 border-2 border-dashed border-blue-500/40 rounded-[3rem] animate-spin-slow"></div>
            <div className="absolute inset-0 flex items-center justify-center">
               <div className="w-4 h-4 bg-blue-600 rounded-full shadow-[0_0_40px_#3b82f6] animate-ping"></div>
            </div>
          </div>
          <h2 className="text-white text-[10px] font-black uppercase tracking-[1em] mb-4">Initializing Spatial Grid</h2>
          <p className="text-slate-400 text-[8px] uppercase tracking-[0.2em] font-bold text-center leading-loose px-12 max-w-xs">
            Scan your environment to anchor the digital twin.
          </p>
        </div>
      )}

      {cameraError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#050608] p-16 text-center">
          <div className="max-w-sm space-y-10">
            <div className="text-6xl mb-10">⚠️</div>
            <h2 className="text-white text-[12px] font-black uppercase tracking-[0.4em] leading-loose">{cameraError}</h2>
            <button onClick={() => window.location.reload()} className="w-full py-5 bg-blue-600 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-3xl shadow-2xl shadow-blue-500/40">Retry Connection</button>
          </div>
        </div>
      )}

      <style>{`
        .animate-spin-slow { animation: spin 15s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

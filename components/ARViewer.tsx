
import React, { useEffect, useRef, useState, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Environment, ContactShadows, PerspectiveCamera, useTexture, Float, Sky, CubeCamera, useVideoTexture } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { ARExperience, SceneObject } from '../types';

interface ARViewerProps {
  experience: ARExperience;
  onUpdate?: (transform: ARExperience['transform']) => void;
  onTrackingStatusChange?: (status: 'searching' | 'found' | 'lost') => void;
}

const ModelInstance = ({ obj, rotationOffset }: { obj: SceneObject, rotationOffset: number }) => {
  const { scene } = useGLTF(obj.url);
  const clonedScene = useMemo(() => {
    const s = scene.clone();
    s.traverse((node: any) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        // Commercial grade material fallback
        if (node.material.metalness !== undefined) {
          node.material.metalness = Math.max(node.material.metalness, 0.7);
          node.material.roughness = Math.min(node.material.roughness, 0.3);
        }
      }
    });
    return s;
  }, [scene]);

  const diffuseMap = obj.material?.map ? useTexture(obj.material.map) : null;

  useEffect(() => {
    if (diffuseMap) {
      diffuseMap.wrapS = diffuseMap.wrapT = THREE.RepeatWrapping;
      diffuseMap.repeat.set(obj.material?.tiling.x || 1, obj.material?.tiling.y || 1);
    }
    clonedScene.traverse((node: any) => {
      if (node.isMesh && diffuseMap) {
        node.material.map = diffuseMap;
        node.material.needsUpdate = true;
      }
    });
  }, [clonedScene, diffuseMap, obj.material?.tiling]);

  return <primitive object={clonedScene} rotation={[0, rotationOffset, 0]} />;
};

const ARSceneContent: React.FC<{ 
  experience: ARExperience; 
  isTracking: boolean;
  onTransformChange: (t: ARExperience['transform']) => void;
}> = ({ experience, isTracking, onTransformChange }) => {
  const rootRef = useRef<THREE.Group>(null);
  const { camera, raycaster, size, gl } = useThree();
  const [rotationOffset, setRotationOffset] = useState(experience.transform.rotation.y);
  
  useEffect(() => {
    gl.toneMappingExposure = experience.config.exposure || 1.0;
  }, [experience.config.exposure, gl]);

  const pointers = useRef(new Map<number, THREE.Vector2>());
  const initialPinchDist = useRef<number>(0);
  const initialPinchScale = useRef<number>(experience.transform.scale.x);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersectionPoint = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!rootRef.current) return;
    const visibility = isTracking || experience.config.ghostMode;
    rootRef.current.visible = visibility;
    
    if (visibility) {
      rootRef.current.traverse((node: any) => {
        if (node.isMesh && node.material) {
          node.material.transparent = true;
          node.material.opacity = THREE.MathUtils.lerp(node.material.opacity || 1, isTracking ? 1.0 : 0.25, 0.1);
        }
      });
    }

    if (experience.config.autoRotate && pointers.current.size === 0) {
      rootRef.current.rotation.y += 0.005;
    }
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!experience.config.gestureControl) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
    if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      initialPinchDist.current = pts[0].distanceTo(pts[1]);
      initialPinchScale.current = rootRef.current?.scale.x || 1;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!experience.config.gestureControl || !rootRef.current) return;
    pointers.current.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));

    if (pointers.current.size === 1) {
      const mouse = new THREE.Vector2((e.clientX / size.width) * 2 - 1, -(e.clientY / size.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
        rootRef.current.position.copy(intersectionPoint);
      }
    } else if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dist = pts[0].distanceTo(pts[1]);
      const newScale = Math.max(0.05, Math.min(20, initialPinchScale.current * (dist / initialPinchDist.current)));
      rootRef.current.scale.setScalar(newScale);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && rootRef.current) {
      onTransformChange({
        position: { x: rootRef.current.position.x, y: rootRef.current.position.y, z: rootRef.current.position.z },
        rotation: { x: 0, y: THREE.MathUtils.radToDeg(rotationOffset), z: 0 },
        scale: { x: rootRef.current.scale.x, y: rootRef.current.scale.y, z: rootRef.current.scale.z }
      });
    }
  };

  return (
    <>
      <group 
        ref={rootRef} 
        onPointerDown={handlePointerDown} 
        onPointerMove={handlePointerMove} 
        onPointerUp={handlePointerUp}
        position={[experience.transform.position.x, experience.transform.position.y, experience.transform.position.z]}
        scale={[experience.transform.scale.x, experience.transform.scale.y, experience.transform.scale.z]}
      >
        {experience.sceneObjects.map(obj => (
          <group 
            key={obj.id} 
            position={[obj.transform.position.x, obj.transform.position.y, obj.transform.position.z]} 
            rotation={[THREE.MathUtils.degToRad(obj.transform.rotation.x), THREE.MathUtils.degToRad(obj.transform.rotation.y), THREE.MathUtils.degToRad(obj.transform.rotation.z)]}
            scale={[obj.transform.scale.x, obj.transform.scale.y, obj.transform.scale.z]}
          >
            <Suspense fallback={null}>
              <Float speed={obj.animation.autoPlay ? 1.5 : 0} rotationIntensity={0.3} floatIntensity={0.5}>
                <ModelInstance obj={obj} rotationOffset={rotationOffset} />
              </Float>
            </Suspense>
          </group>
        ))}
        <ContactShadows opacity={experience.config.shadowIntensity} scale={30} blur={2.5} far={20} color="#000" />
      </group>
      <EffectComposer>{experience.config.bloom && <Bloom intensity={experience.config.bloomIntensity} luminanceThreshold={0.7} />}</EffectComposer>
    </>
  );
};

export const ARViewer: React.FC<ARViewerProps> = ({ experience, onUpdate, onTrackingStatusChange }) => {
  const [isTracking, setIsTracking] = useState(false);
  const [initStage, setInitStage] = useState(0); // 0: Searching, 1: Surface Found, 2: Anchored
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const setup = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        // Simulated SLAM Initialization sequence
        setTimeout(() => setInitStage(1), 1500);
        setTimeout(() => {
          setInitStage(2);
          setIsTracking(true);
          onTrackingStatusChange?.('found');
        }, 4000);
      } catch (err) {
        setCameraError("Hardware Access Denied: Check camera permissions.");
      }
    };
    setup();
    return () => {
      if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden font-sans select-none touch-none">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-0 brightness-[0.85] contrast-[1.1]" />
      
      <div className="absolute inset-0 z-10 pointer-events-auto">
        <Canvas shadows gl={{ antialias: true, alpha: true }}>
          <PerspectiveCamera makeDefault position={[0, 4, 10]} fov={45} />
          <ambientLight intensity={1.5} />
          <directionalLight position={[10, 20, 10]} intensity={3.5} castShadow shadow-mapSize={[2048, 2048]} />
          <pointLight position={[-10, 5, -10]} intensity={2.0} color="#3b82f6" />
          <ARSceneContent experience={experience} isTracking={isTracking} onTransformChange={onUpdate || (() => {})} />
          <Suspense fallback={null}><Environment preset="city" /></Suspense>
          <gridHelper args={[60, 120, '#ffffff', '#1a1b1e']} position={[0, -0.05, 0]} visible={isTracking} />
        </Canvas>
      </div>

      {/* Industrial HUD */}
      <div className="absolute inset-0 pointer-events-none z-20 p-10 flex flex-col justify-between">
        <div className="flex justify-between items-start">
           <div className="p-8 bg-black/50 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl min-w-[320px] animate-slide-in-left">
              <div className="flex items-center gap-6">
                 <div className="w-16 h-16 bg-blue-600 rounded-[1.5rem] flex items-center justify-center font-black text-white text-xl shadow-[0_0_30px_#3b82f644]">L</div>
                 <div>
                    <h1 className="text-[13px] font-black uppercase tracking-[0.6em] text-white leading-tight">{experience.name}</h1>
                    <div className="flex items-center gap-2.5 mt-2.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${isTracking ? 'bg-green-500 shadow-[0_0_15px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
                      <span className="text-[9px] font-mono text-slate-300 uppercase tracking-widest">{isTracking ? 'Spatial Integrity: Lock' : 'Signal Hunting...'}</span>
                    </div>
                 </div>
              </div>
           </div>
           
           <div className="p-6 bg-black/40 backdrop-blur-3xl border border-white/5 rounded-3xl text-right animate-slide-in-right">
              <p className="text-[8px] font-black text-blue-400 uppercase tracking-[0.4em]">Environmental Data</p>
              <p className="text-[14px] font-mono text-white mt-1">LAT: 37.77 • LON: -122.41</p>
           </div>
        </div>

        {/* Initialization Screen */}
        {!isTracking && !cameraError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/60 backdrop-blur-3xl animate-fade-in">
            <div className="relative mb-16">
              <div className={`w-40 h-40 border-4 border-dashed border-blue-500/30 rounded-[4rem] animate-spin-slow transition-transform duration-1000 ${initStage > 0 ? 'scale-125 border-green-500/40' : ''}`}></div>
              <div className="absolute inset-0 flex items-center justify-center">
                 <div className={`w-6 h-6 rounded-full shadow-[0_0_50px_#3b82f6] animate-ping ${initStage > 0 ? 'bg-green-500 shadow-green-500' : 'bg-blue-600'}`}></div>
              </div>
            </div>
            <h2 className="text-white text-[12px] font-black uppercase tracking-[1.2em] mb-6 text-center">
              {initStage === 0 ? 'Mapping Spatial Geometry' : 'Anchoring Digital Twin'}
            </h2>
            <div className="w-64 h-1 bg-white/10 rounded-full overflow-hidden">
               <div className="h-full bg-blue-600 transition-all duration-1000" style={{ width: `${(initStage + 1) * 33}%` }}></div>
            </div>
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#050608] p-20 text-center">
            <div className="max-w-md space-y-12">
              <div className="text-8xl mb-12">📡</div>
              <h2 className="text-white text-[14px] font-black uppercase tracking-[0.5em] leading-loose">{cameraError}</h2>
              <button onClick={() => window.location.reload()} className="w-full py-6 bg-blue-600 text-white text-[11px] font-black uppercase tracking-[0.3em] rounded-3xl shadow-3xl hover:bg-blue-500 active:scale-95 transition-all">Reconnect Sensors</button>
            </div>
          </div>
        )}
      </div>

      <style>{`.animate-spin-slow { animation: spin 12s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

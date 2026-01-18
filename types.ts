
export type TrackingType = 'image' | 'surface' | 'face' | 'portal' | 'hand' | 'body';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface AnimationConfig {
  autoPlay: boolean;
  trigger: 'none' | 'tap' | 'proximity';
  clipName?: string;
}

export interface MaterialConfig {
  map?: string;
  normalMap?: string;
  roughnessMap?: string;
  tiling: {
    x: number;
    y: number;
  };
}

export interface SceneObject {
  id: string;
  name: string;
  url: string;
  transform: {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
  };
  animation: AnimationConfig;
  material?: MaterialConfig;
}

export interface ARExperience {
  id: string;
  name: string;
  trackingType: TrackingType;
  sceneObjects: SceneObject[];
  transform: {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
  };
  assets: {
    targetImage?: string; 
    envMap?: string;
    portalSky?: string; 
  };
  config: {
    shadowIntensity: number;
    exposure: number;
    bloom: boolean;
    bloomIntensity: number;
    autoRotate: boolean;
    ghostMode: boolean;
    gestureControl: boolean;
  };
  businessData: {
    businessName: string;
    ctaLink: string;
    analyticsId?: string;
  };
}

export interface KalmanState {
  x: number[];
  P: number[][];
}

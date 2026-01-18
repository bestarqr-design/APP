
export type TrackingType = 'image' | 'surface' | 'face' | 'portal';

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
    targetImage?: string; // Marker URL
    envMap?: string;
    portalSky?: string; // 360 view inside portal
  };
  config: {
    shadowIntensity: number;
    exposure: number;
    bloom: boolean;
    autoRotate: boolean;
    ghostMode: boolean;
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

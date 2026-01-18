
/**
 * Simple 1D Kalman Filter for pose smoothing.
 * In a production environment, this would be expanded to 6DOF (Position + Rotation)
 * using an Extended Kalman Filter (EKF).
 */
export class KalmanFilter {
  private q: number; // Process noise covariance
  private r: number; // Measurement noise covariance
  private x: number; // Value
  private p: number; // Estimation error covariance
  private k: number; // Kalman gain

  constructor(processNoise: number = 0.01, measurementNoise: number = 0.1) {
    this.q = processNoise;
    this.r = measurementNoise;
    this.p = 1.0;
    this.x = 0.0;
    this.k = 0.0;
  }

  filter(measurement: number): number {
    // Prediction Update
    this.p = this.p + this.q;

    // Measurement Update
    this.k = this.p / (this.p + this.r);
    this.x = this.x + this.k * (measurement - this.x);
    this.p = (1 - this.k) * this.p;

    return this.x;
  }
}

/**
 * 3D Vector smoother using independent Kalman Filters for each axis.
 */
export class PoseSmoother {
  private filters: {
    pos: KalmanFilter[];
    rot: KalmanFilter[];
  };

  constructor() {
    this.filters = {
      pos: [new KalmanFilter(0.005, 0.05), new KalmanFilter(0.005, 0.05), new KalmanFilter(0.005, 0.05)],
      rot: [new KalmanFilter(0.01, 0.1), new KalmanFilter(0.01, 0.1), new KalmanFilter(0.01, 0.1)]
    };
  }

  smoothPosition(x: number, y: number, z: number) {
    return [
      this.filters.pos[0].filter(x),
      this.filters.pos[1].filter(y),
      this.filters.pos[2].filter(z)
    ];
  }

  smoothRotation(x: number, y: number, z: number) {
    return [
      this.filters.rot[0].filter(x),
      this.filters.rot[1].filter(y),
      this.filters.rot[2].filter(z)
    ];
  }
}

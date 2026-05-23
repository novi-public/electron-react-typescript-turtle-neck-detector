declare module '@mediapipe/tasks-vision' {
  export const FilesetResolver: {
    forVisionTasks: (wasmFilesetPath: string) => Promise<unknown>;
  };

  export const PoseLandmarker: {
    createFromOptions: (
      vision: unknown,
      options: {
        baseOptions: {
          modelAssetPath: string;
          delegate?: 'CPU' | 'GPU';
        };
        runningMode: 'IMAGE' | 'VIDEO';
        numPoses?: number;
      },
    ) => Promise<{
      detectForVideo: (
        video: HTMLVideoElement,
        timestampMs: number,
      ) => {
        landmarks: unknown[];
        worldLandmarks?: unknown[];
        segmentationMasks?: unknown[];
      };
      close: () => void;
    }>;
  };
}

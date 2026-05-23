import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePostureHistory } from './usePostureHistory';

type CameraStatus = 'off' | 'loading' | 'ready' | 'error';
type PoseStatus = 'loading' | 'ready' | 'error';
type PostureLevel = 'unknown' | 'good' | 'caution' | 'bad';
type NeckStatus = 'normal' | 'detecting' | 'warning';

type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

type PoseResult = {
  landmarks: PoseLandmark[][];
  worldLandmarks?: PoseLandmark[][];
  segmentationMasks?: unknown[];
};

type PoseLandmarkerLike = {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => PoseResult;
  close: () => void;
};

type PoseDebugInfo = {
  landmarks: PoseLandmark[];
  badPosture: boolean;
  reason: string;
  score: number;
};

const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [0, 7],
  [0, 8],
  [7, 11],
  [8, 12],
] as const;

const DEBUG_LANDMARKS = [
  { index: 0, label: 'nose' },
  { index: 7, label: 'left ear' },
  { index: 8, label: 'right ear' },
  { index: 11, label: 'left shoulder' },
  { index: 12, label: 'right shoulder' },
] as const;

const FACE_SIZE_THRESHOLD = 1.07;
const WARNING_DELAY_MS = 5000;
const NOTIFICATION_MODE_STORAGE_KEY = 'notificationMode';
const SELECTED_ALERT_IMAGE_STORAGE_KEY = 'selectedAlertImage';

function getStoredNotificationMode(): NotificationMode {
  const storedMode = localStorage.getItem(NOTIFICATION_MODE_STORAGE_KEY);

  return storedMode === 'image' || storedMode === 'flash' ? storedMode : 'flash';
}

function isVisible(landmark?: PoseLandmark) {
  return Boolean(landmark && (landmark.visibility ?? 1) > 0.45);
}

function getFaceWidth(landmarks: PoseLandmark[]) {
  const landmarkPairs = [
    [7, 8],
    [3, 6],
    [9, 10],
  ] as const;

  for (const [leftIndex, rightIndex] of landmarkPairs) {
    const left = landmarks[leftIndex];
    const right = landmarks[rightIndex];

    if (isVisible(left) && isVisible(right)) {
      return Math.abs(left.x - right.x);
    }
  }

  return null;
}

function getPostureAnalysis(landmarks: PoseLandmark[]) {
  const nose = landmarks[0];
  const leftEar = landmarks[7];
  const rightEar = landmarks[8];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  if (!isVisible(nose) || !isVisible(leftShoulder) || !isVisible(rightShoulder)) {
    return {
      level: 'unknown' as const,
      badPosture: false,
      score: 0,
      message: '몸이 화면에 잘 보이도록 앉아주세요.',
      reason: '필수 landmark visibility 낮음',
    };
  }

  const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderWidth = Math.max(Math.abs(leftShoulder.x - rightShoulder.x), 0.01);
  const headCenterX =
    isVisible(leftEar) && isVisible(rightEar) ? (leftEar!.x + rightEar!.x) / 2 : nose.x;
  const headOffset = Math.abs(headCenterX - shoulderCenterX) / shoulderWidth;
  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y);
  const headDrop = nose.y - Math.min(leftShoulder.y, rightShoulder.y);
  const score = headOffset * 70 + shoulderTilt * 130 + Math.max(0, headDrop - 0.12) * 80;

  if (score >= 22) {
    return {
      level: 'bad' as const,
      badPosture: true,
      score,
      message: '자세가 무너졌어요. 턱을 살짝 당기고 어깨를 편하게 내려주세요.',
      reason: `headOffset=${headOffset.toFixed(2)}, shoulderTilt=${shoulderTilt.toFixed(2)}, headDrop=${headDrop.toFixed(2)}`,
    };
  }

  if (score >= 12) {
    return {
      level: 'caution' as const,
      badPosture: false,
      score,
      message: '조금 흐트러졌어요. 화면 중앙에 맞춰 앉아보세요.',
      reason: `headOffset=${headOffset.toFixed(2)}, shoulderTilt=${shoulderTilt.toFixed(2)}, headDrop=${headDrop.toFixed(2)}`,
    };
  }

  return {
    level: 'good' as const,
    badPosture: false,
    score,
    message: '좋은 자세를 유지하고 있어요.',
    reason: `headOffset=${headOffset.toFixed(2)}, shoulderTilt=${shoulderTilt.toFixed(2)}, headDrop=${headDrop.toFixed(2)}`,
  };
}

function drawPoseOverlay(canvas: HTMLCanvasElement, landmarks: PoseLandmark[]) {
  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  context.lineWidth = 4;
  context.strokeStyle = '#14b8a6';
  context.fillStyle = '#f97316';

  for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];

    if (!isVisible(start) || !isVisible(end)) {
      continue;
    }

    context.beginPath();
    context.moveTo((1 - start.x) * width, start.y * height);
    context.lineTo((1 - end.x) * width, end.y * height);
    context.stroke();
  }

  for (const landmark of landmarks) {
    if (!isVisible(landmark)) {
      continue;
    }

    context.beginPath();
    context.arc((1 - landmark.x) * width, landmark.y * height, 5, 0, Math.PI * 2);
    context.fill();
  }
}

function clearPoseOverlay(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext('2d');

  if (!canvas || !context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
}

type MediaPipeVisionModule = {
  FilesetResolver: {
    forVisionTasks: (wasmFilesetPath: string) => Promise<unknown>;
  };
  PoseLandmarker: {
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
    ) => Promise<PoseLandmarkerLike>;
  };
};

function getCameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return '카메라를 시작하는 중 알 수 없는 문제가 발생했습니다.';
  }

  if (error.name === 'NotAllowedError') {
    return '카메라 권한이 거부되었습니다. 시스템 설정에서 이 앱의 카메라 접근을 허용해주세요.';
  }

  if (error.name === 'NotFoundError') {
    return '연결된 카메라를 찾을 수 없습니다.';
  }

  if (error.name === 'NotReadableError') {
    return '다른 앱이 카메라를 사용 중이거나 카메라를 읽을 수 없습니다.';
  }

  return `카메라를 시작할 수 없습니다. (${error.name})`;
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarkerLike | null>(null);
  const latestLandmarksRef = useRef<PoseLandmark[] | null>(null);
  const lastDebugUpdateRef = useRef(0);
  const badPostureStartedAtRef = useRef<number | null>(null);
  const wasWarningRef = useRef(false);
  const [appVersion, setAppVersion] = useState('확인 중');
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [developerMode, setDeveloperMode] = useState(false);
  const [notificationMode, setNotificationMode] = useState<NotificationMode>(getStoredNotificationMode);
  const [alertImages, setAlertImages] = useState<AlertImageItem[]>([]);
  const [selectedAlertImage, setSelectedAlertImage] = useState(
    () => localStorage.getItem(SELECTED_ALERT_IMAGE_STORAGE_KEY) ?? '',
  );
  const [alertPreviewFailed, setAlertPreviewFailed] = useState(false);
  const [alertStatusMessage, setAlertStatusMessage] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('loading');
  const [cameraError, setCameraError] = useState('');
  const [poseStatus, setPoseStatus] = useState<PoseStatus>('loading');
  const [poseError, setPoseError] = useState('');
  const [postureLevel, setPostureLevel] = useState<PostureLevel>('unknown');
  const [postureMessage, setPostureMessage] = useState('자세 분석을 준비하고 있습니다.');
  const [poseDebugInfo, setPoseDebugInfo] = useState<PoseDebugInfo | null>(null);
  const [baselineFaceWidth, setBaselineFaceWidth] = useState<number | null>(null);
  const [currentFaceWidth, setCurrentFaceWidth] = useState<number | null>(null);
  const [neckStatus, setNeckStatus] = useState<NeckStatus>('normal');
  const [baselineMessage, setBaselineMessage] = useState('기준 자세를 저장하면 거북목 경고가 활성화됩니다.');
  const { today, recentSevenDays } = usePostureHistory(neckStatus === 'warning');

  const triggerPostureAlert = useCallback(() => {
    if (!window.electronAPI?.triggerPostureAlert) {
      setAlertStatusMessage('Electron 알림 API를 찾지 못했습니다.');
      return;
    }

    const randomImage =
      alertImages.length > 0 ? alertImages[Math.floor(Math.random() * alertImages.length)]?.path : undefined;
    const imagePath = selectedAlertImage === 'random' ? randomImage : selectedAlertImage;

    if (notificationMode === 'image' && !imagePath) {
      setAlertStatusMessage('사용 가능한 알림 이미지가 없습니다.');
      return;
    }

    window.electronAPI?.triggerPostureAlert({
      mode: notificationMode,
      imagePath: notificationMode === 'image' ? imagePath : undefined,
    });
    setAlertStatusMessage(
      notificationMode === 'flash' ? '전체 화면 깜빡임 알림 요청됨' : '이미지 지나감 알림 요청됨',
    );
  }, [alertImages, notificationMode, selectedAlertImage]);

  const loadAlertImages = useCallback(() => {
    const applyImages = (images: AlertImageItem[]) => {
        setAlertImages(images);

        if (images.length === 0) {
          setSelectedAlertImage('');
          return;
        }

        const storedImage = localStorage.getItem(SELECTED_ALERT_IMAGE_STORAGE_KEY);
        const nextImage =
          storedImage === 'random' || images.some((image) => image.path === storedImage)
            ? storedImage!
            : 'random';

        setSelectedAlertImage(nextImage);
    };

    fetch(`${import.meta.env.BASE_URL}assets/alert-images/manifest.json`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Alert image manifest not found');
        }

        return response.json() as Promise<AlertImageItem[]>;
      })
      .then(applyImages)
      .catch(() => {
        window.electronAPI
          ?.getAlertImages()
          .then(applyImages)
          .catch(() => {
            setAlertImages([]);
            setSelectedAlertImage('');
          });
      });
  }, []);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    clearPoseOverlay(canvasRef.current);
    setPostureLevel('unknown');
    setPostureMessage('카메라가 꺼져 있습니다.');
    setPoseDebugInfo(null);
    latestLandmarksRef.current = null;
    badPostureStartedAtRef.current = null;
    setCurrentFaceWidth(null);
    setNeckStatus('normal');
  }, []);

  const saveBaselinePose = useCallback(() => {
    const landmarks = latestLandmarksRef.current;

    if (!landmarks) {
      setBaselineMessage('아직 얼굴 landmark를 찾지 못했습니다.');
      return;
    }

    const faceWidth = getFaceWidth(landmarks);

    if (!faceWidth) {
      setBaselineMessage('양쪽 귀 또는 얼굴 기준점을 찾은 뒤 다시 저장해주세요.');
      return;
    }

    badPostureStartedAtRef.current = null;
    setBaselineFaceWidth(faceWidth);
    setCurrentFaceWidth(faceWidth);
    setNeckStatus('normal');
    setBaselineMessage('기준 자세가 저장되었습니다.');
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      setAppVersion('브라우저 미리보기');
      return;
    }

    window.electronAPI
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('알 수 없음'));

    window.electronAPI.onUpdateAvailable(() => {
      setUpdateAvailable(true);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(NOTIFICATION_MODE_STORAGE_KEY, notificationMode);
  }, [notificationMode]);

  useEffect(() => {
    localStorage.setItem(SELECTED_ALERT_IMAGE_STORAGE_KEY, selectedAlertImage);
    setAlertPreviewFailed(false);
  }, [selectedAlertImage]);

  useEffect(() => {
    loadAlertImages();
  }, [loadAlertImages]);

  useEffect(() => {
    const isWarning = neckStatus === 'warning';

    if (isWarning && !wasWarningRef.current) {
      triggerPostureAlert();
    }

    wasWarningRef.current = isWarning;
  }, [neckStatus, triggerPostureAlert]);

  useEffect(() => {
    let cameraStream: MediaStream | null = null;
    let isMounted = true;

    async function startCamera() {
      if (!cameraEnabled) {
        stopCamera();
        setCameraStatus('off');
        setCameraError('');
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('error');
        setCameraError('이 환경에서는 카메라 API를 사용할 수 없습니다.');
        return;
      }

      try {
        setCameraStatus('loading');
        setCameraError('');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStream = stream;
        cameraStreamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setCameraStatus('ready');
        setCameraError('');
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setCameraStatus('error');
        setCameraError(getCameraErrorMessage(error));
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      cameraStream?.getTracks().forEach((track) => track.stop());

      if (cameraStreamRef.current === cameraStream) {
        cameraStreamRef.current = null;
      }
    };
  }, [cameraEnabled, stopCamera]);

  useEffect(() => {
    let isMounted = true;

    async function loadPoseLandmarker() {
      try {
        const { FilesetResolver, PoseLandmarker } = (await import(
          '@mediapipe/tasks-vision'
        )) as MediaPipeVisionModule;
        const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);

        const createPoseLandmarker = (delegate: 'CPU' | 'GPU') =>
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
              delegate,
            },
            runningMode: 'VIDEO',
            numPoses: 1,
          });

        let poseLandmarker: PoseLandmarkerLike;

        try {
          poseLandmarker = await createPoseLandmarker('GPU');
        } catch (gpuError) {
          console.warn('GPU Pose Landmarker 초기화 실패, CPU로 다시 시도합니다:', gpuError);
          poseLandmarker = await createPoseLandmarker('CPU');
        }

        if (!isMounted) {
          poseLandmarker.close();
          return;
        }

        poseLandmarkerRef.current = poseLandmarker;
        setPoseStatus('ready');
        setPoseError('');
      } catch (error) {
        if (!isMounted) {
          return;
        }

        console.error('Pose Landmarker 초기화 실패:', error);
        setPoseStatus('error');
        setPoseError(
          'MediaPipe Pose Landmarker를 불러오지 못했습니다. 인터넷 연결 또는 모델 파일 접근 상태를 확인해주세요.',
        );
      }
    }

    loadPoseLandmarker();

    return () => {
      isMounted = false;

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (cameraStatus !== 'ready' || poseStatus !== 'ready') {
      return;
    }

    let isRunning = true;

    function detectPose() {
      const video = videoRef.current;
      const poseLandmarker = poseLandmarkerRef.current;

      if (!isRunning || !video || !poseLandmarker) {
        return;
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const result = poseLandmarker.detectForVideo(video, performance.now());
        const landmarks = result.landmarks[0];

        if (landmarks) {
          const analysis = getPostureAnalysis(landmarks);
          const faceWidth = getFaceWidth(landmarks);

          latestLandmarksRef.current = landmarks;
          setCurrentFaceWidth(faceWidth);

          let nextNeckStatus: NeckStatus = 'normal';
          let faceSizeBadPosture = false;

          if (baselineFaceWidth && faceWidth) {
            faceSizeBadPosture = faceWidth >= baselineFaceWidth * FACE_SIZE_THRESHOLD;

            if (faceSizeBadPosture) {
              badPostureStartedAtRef.current ??= performance.now();

              if (performance.now() - badPostureStartedAtRef.current >= WARNING_DELAY_MS) {
                nextNeckStatus = 'warning';
              } else {
                nextNeckStatus = 'detecting';
              }
            } else {
              badPostureStartedAtRef.current = null;
            }
          } else {
            badPostureStartedAtRef.current = null;
          }

          setNeckStatus(nextNeckStatus);
          setPostureLevel(
            nextNeckStatus === 'warning' ? 'bad' : nextNeckStatus === 'detecting' ? 'caution' : analysis.level,
          );
          setPostureMessage(
            nextNeckStatus === 'warning'
              ? '거북목 자세가 5초 이상 유지되었습니다. 턱을 당기고 화면에서 살짝 멀어져 주세요.'
              : nextNeckStatus === 'detecting'
                ? '얼굴이 기준 자세보다 가까워졌습니다. 5초 이상 지속되면 경고로 전환됩니다.'
                : analysis.message,
          );

          if (developerMode) {
            drawPoseOverlay(canvasRef.current!, landmarks);
            console.log('Pose landmarks:', landmarks);

            if (performance.now() - lastDebugUpdateRef.current > 250) {
              setPoseDebugInfo({
                landmarks,
                badPosture: nextNeckStatus === 'warning',
                reason: `${analysis.reason}, faceWidth=${faceWidth?.toFixed(3) ?? 'n/a'}, baseline=${baselineFaceWidth?.toFixed(3) ?? 'n/a'}, faceSizeBad=${faceSizeBadPosture}`,
                score: analysis.score,
              });
              lastDebugUpdateRef.current = performance.now();
            }
          } else {
            clearPoseOverlay(canvasRef.current);
          }
        } else {
          setPostureLevel('unknown');
          setPostureMessage('사람을 찾고 있습니다. 카메라 앞에 앉아주세요.');
          latestLandmarksRef.current = null;
          badPostureStartedAtRef.current = null;
          setCurrentFaceWidth(null);
          setNeckStatus('normal');
          clearPoseOverlay(canvasRef.current);
          setPoseDebugInfo(null);
        }
      }

      animationFrameRef.current = requestAnimationFrame(detectPose);
    }

    detectPose();

    return () => {
      isRunning = false;

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [baselineFaceWidth, cameraStatus, developerMode, poseStatus]);

  useEffect(() => {
    if (!developerMode) {
      clearPoseOverlay(canvasRef.current);
      setPoseDebugInfo(null);
    }
  }, [developerMode]);

  return (
    <main className="app-shell">
      {updateAvailable && (
        <section className="update-banner" aria-label="Update available">
          <strong>새 버전이 있습니다</strong>
          <div>
            <button className="camera-toggle" type="button" onClick={() => window.electronAPI?.downloadUpdate()}>
              업데이트
            </button>
            <button className="camera-toggle" type="button" onClick={() => setUpdateAvailable(false)}>
              나중에
            </button>
          </div>
        </section>
      )}

      <section className="hero">
        <p className="eyebrow">Desktop posture companion</p>
        <h1>Turtle Neck Detector</h1>
        <p className="description">
          Electron, React, TypeScript, Vite 기반으로 시작하는 거북목 감지 데스크톱 앱입니다.
        </p>
      </section>

      <section className="status-panel" aria-label="Application status">
        <div>
          <span className="status-label">Electron 연결</span>
          <strong>정상</strong>
        </div>
        <div>
          <span className="status-label">앱 버전</span>
          <strong>{appVersion}</strong>
        </div>
        <div>
          <span className="status-label">렌더러</span>
          <strong>React + Vite</strong>
        </div>
        <div>
          <span className="status-label">Pose Landmarker</span>
          <strong>{poseStatus === 'ready' ? '준비 완료' : poseStatus === 'error' ? '오류' : '로딩 중'}</strong>
        </div>
      </section>

      <section className="settings-panel" aria-label="Settings">
        <div>
          <span className="status-label">설정</span>
          <strong>개발자 모드</strong>
        </div>
        <label className="switch-control">
          <input
            type="checkbox"
            checked={developerMode}
            onChange={(event) => setDeveloperMode(event.target.checked)}
          />
          <span className="switch-track">
            <span className="switch-thumb" />
          </span>
        </label>
      </section>

      <section className="notification-settings" aria-label="Notification settings">
        <div className="section-heading">
          <div>
            <span className="status-label">설정</span>
            <strong>거북목 알림</strong>
          </div>
          {developerMode && (
            <button className="camera-toggle" type="button" onClick={triggerPostureAlert}>
              알림 테스트
            </button>
          )}
        </div>

        <div className="notification-controls">
          <label>
            <span className="status-label">알림 모드</span>
            <select
              value={notificationMode}
              onChange={(event) => setNotificationMode(event.target.value as NotificationMode)}
            >
              <option value="flash">화면 전체 깜빡임</option>
              <option value="image">이미지 지나감</option>
            </select>
          </label>

          <label>
            <span className="status-label">제공 이미지 목록 ({alertImages.length}개)</span>
            <select
              value={selectedAlertImage}
              disabled={alertImages.length === 0}
              onChange={(event) => setSelectedAlertImage(event.target.value)}
            >
              {alertImages.length === 0 ? (
                <option value="">제공 이미지 없음</option>
              ) : (
                <>
                  <option value="random">Random</option>
                  {alertImages.map((image) => (
                    <option key={image.id} value={image.path}>
                      {image.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>

          <div className="alert-preview">
            <span className="status-label">선택된 이미지 미리보기</span>
            {selectedAlertImage === 'random' ? (
              <div className="alert-placeholder">RANDOM IMAGE</div>
            ) : selectedAlertImage && !alertPreviewFailed ? (
              <img
                src={selectedAlertImage}
                alt="선택된 알림 이미지"
                onError={() => setAlertPreviewFailed(true)}
              />
            ) : (
              <div className="alert-placeholder">POSTURE ALERT</div>
            )}
          </div>
        </div>

        <p className="alert-image-path">
          이미지 폴더: <code>public/assets/alert-images</code>
        </p>
        {alertStatusMessage && <p className="alert-status-message">{alertStatusMessage}</p>}
      </section>

      <section className="camera-panel" aria-label="Webcam preview">
        <div className="camera-header">
          <div>
            <span className="status-label">웹캠 미리보기</span>
            <strong>
              {cameraStatus === 'ready'
                ? '카메라 실행 중'
                : cameraStatus === 'off'
                  ? '카메라 꺼짐'
                  : '카메라 준비 중'}
            </strong>
          </div>
          <div className="camera-controls">
            <span className={`camera-indicator ${cameraStatus}`}>
              {cameraStatus === 'ready'
                ? 'Live'
                : cameraStatus === 'error'
                  ? 'Error'
                  : cameraStatus === 'off'
                    ? 'Off'
                    : 'Loading'}
            </span>
            <button
              className="camera-toggle"
              type="button"
              disabled={cameraStatus === 'loading'}
              onClick={() => setCameraEnabled((enabled) => !enabled)}
            >
              {cameraEnabled ? '카메라 끄기' : '카메라 켜기'}
            </button>
            <button
              className="camera-toggle"
              type="button"
              disabled={cameraStatus !== 'ready'}
              onClick={saveBaselinePose}
            >
              기준 자세 저장
            </button>
          </div>
        </div>

        <div className="video-frame">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas
            ref={canvasRef}
            className={`pose-overlay ${developerMode ? 'visible' : ''}`}
            aria-hidden="true"
          />
          {cameraStatus === 'off' && <p className="camera-message">카메라가 꺼져 있습니다.</p>}
          {cameraStatus === 'loading' && <p className="camera-message">카메라 권한을 확인하고 있습니다.</p>}
          {cameraStatus === 'error' && <p className="camera-message error">{cameraError}</p>}
          {cameraStatus === 'ready' && poseStatus === 'loading' && (
            <p className="camera-message">Pose Landmarker를 불러오고 있습니다.</p>
          )}
          {poseStatus === 'error' && <p className="camera-message error">{poseError}</p>}
        </div>

        {cameraStatus === 'ready' && poseStatus === 'ready' && (
          <div className={`posture-banner ${postureLevel}`}>
            <strong>
              {neckStatus === 'normal'
                ? '정상'
                : neckStatus === 'detecting'
                  ? '감지 중'
                  : '거북목 경고'}
            </strong>
            <span>{baselineFaceWidth ? postureMessage : baselineMessage}</span>
          </div>
        )}
      </section>

      {developerMode && (
        <section className="debug-panel" aria-label="Developer pose debug">
          <div className="debug-summary">
            <div>
              <span className="status-label">bad posture</span>
              <strong>{poseDebugInfo?.badPosture ? 'true' : 'false'}</strong>
            </div>
            <div>
              <span className="status-label">score</span>
              <strong>{poseDebugInfo ? poseDebugInfo.score.toFixed(1) : '-'}</strong>
            </div>
            <div>
              <span className="status-label">face width</span>
              <p>
                current {currentFaceWidth?.toFixed(3) ?? '-'} / baseline{' '}
                {baselineFaceWidth?.toFixed(3) ?? '-'}
              </p>
            </div>
            <div>
              <span className="status-label">reason</span>
              <p>{poseDebugInfo?.reason ?? 'landmark 대기 중'}</p>
            </div>
          </div>
          <div className="coordinate-list">
            {DEBUG_LANDMARKS.map(({ index, label }) => {
              const landmark = poseDebugInfo?.landmarks[index];

              return (
                <div key={index}>
                  <span>
                    {index} {label}
                  </span>
                  <code>
                    {landmark
                      ? `x:${landmark.x.toFixed(3)} y:${landmark.y.toFixed(3)} z:${(landmark.z ?? 0).toFixed(3)}`
                      : 'not detected'}
                  </code>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="history-panel" aria-label="Posture history">
        <div className="section-heading">
          <span className="status-label">자세 기록</span>
          <strong>오늘</strong>
        </div>

        <div className="today-history">
          <div>
            <span className="status-label">오늘 경고 횟수</span>
            <strong>{today.warningCount}회</strong>
          </div>
          <div>
            <span className="status-label">오늘 나쁜 자세 총 시간</span>
            <strong>{today.totalBadPostureTime}초</strong>
          </div>
        </div>

        <div className="history-grid">
          <div className="chart-card">
            <h2>최근 7일 거북목 경고 횟수</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={recentSevenDays}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="warningCount" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <h2>최근 7일 나쁜 자세 누적 시간</h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={recentSevenDays}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="totalBadPostureTime"
                  stroke="#b91c1c"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="history-table">
          <div className="history-row header">
            <span>날짜</span>
            <span>경고 횟수</span>
            <span>나쁜 자세 시간</span>
          </div>
          {recentSevenDays.map((entry) => (
            <div className="history-row" key={entry.date}>
              <span>{entry.date}</span>
              <span>{entry.warningCount}회</span>
              <span>{entry.totalBadPostureTime}초</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;

# Turtle Neck Detector

Electron + React + TypeScript 기반 거북목 감지 MVP 데스크톱 앱입니다.

## 다운로드 및 설치

GitHub Releases 페이지에서 운영체제에 맞는 파일을 다운로드합니다.

### Mac

권장 설치 방식:

1. `TurtleNeckDetector-Mac-{version}.dmg` 다운로드
2. `.dmg` 열기
3. `Turtle Neck Detector`를 `Applications` 폴더로 이동
4. 앱 실행

대체 설치 방식:

1. `TurtleNeckDetector-Mac-{version}.zip` 다운로드
2. 압축 해제
3. `Turtle Neck Detector.app` 실행

로컬 Mac에서 `hdiutil: create failed - Device not configured` 오류로 DMG 생성이 실패하는 경우가 있습니다. 이 문제는 앱 코드가 아니라 macOS `hdiutil` 환경 문제일 가능성이 높습니다. 이때도 `zip` 파일은 MVP 테스트용 배포 파일로 사용할 수 있습니다.

### Windows

1. `TurtleNeckDetector-Win-{version}.exe` 다운로드
2. 설치 프로그램 실행
3. 설치 위치 선택
4. 앱 실행

## 개발 방법

```bash
npm install
npm run dev
```

## 빌드 방법

전체 빌드:

```bash
npm run dist
```

macOS 배포 파일 생성:

```bash
npm run dist:mac
```

`dist:mac`는 먼저 DMG 생성을 시도하고, DMG 생성이 실패하면 ZIP 생성을 시도합니다.

Windows EXE 생성:

```bash
npm run dist:win
```

빌드 결과는 `dist/` 폴더에 생성됩니다.

예상 파일:

```text
dist/
├── TurtleNeckDetector-Mac-{version}.dmg
├── TurtleNeckDetector-Mac-{version}.zip
└── TurtleNeckDetector-Win-{version}.exe
```

## DMG 생성 문제 확인

로컬 Mac에서 DMG 생성이 계속 실패하면 아래 명령으로 `hdiutil` 자체가 정상 동작하는지 확인합니다.

```bash
hdiutil create -size 100m -fs HFS+ -volname TestDMG ~/Desktop/test.dmg
```

이 명령도 실패하면 프로젝트 설정 문제가 아니라 macOS 디스크 이미지 생성 환경 문제입니다. 이 경우 `dist/TurtleNeckDetector-Mac-{version}.zip`을 MVP 테스트 배포 파일로 사용합니다.

## GitHub Release 배포

1. `package.json`의 `version`을 올립니다.
2. 변경사항을 `main` 브랜치에 push합니다.
3. GitHub Actions가 macOS/Windows 빌드를 실행합니다.
4. GitHub Release가 자동 생성되고 설치 파일이 업로드됩니다.

## 알림 이미지

개발자가 알림 이미지를 추가하려면 아래 폴더에 파일을 넣습니다.

```text
public/assets/alert-images/
```

지원 확장자:

```text
png, jpg, jpeg, webp, gif
```

## 아이콘

아이콘 파일은 아래 위치에 둡니다.

```text
build/icons/icon.icns
build/icons/icon.ico
build/icons/icon.png
```

현재 파일은 placeholder입니다. 실제 배포 전에는 유효한 아이콘 파일로 교체하세요.

## 자동 업데이트

`electron-updater`가 GitHub Release를 기준으로 새 버전을 확인합니다.
새 버전이 있으면 앱 화면에 `새 버전이 있습니다` 알림을 표시합니다.

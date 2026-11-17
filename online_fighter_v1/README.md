# 새 격투 게임

기존 게임 구현을 초기화한 새 프로젝트 기반입니다.

## 실행
1. Node.js 18 이상 설치
2. `npm install`
3. `npm start`
4. 브라우저에서 `http://localhost:3000` 접속

## 구성
- `public/index.html`: 새 게임 화면과 클라이언트 코드
- `server.js`: Express 정적 파일 서버 및 최소 WebSocket 연결 기반
- `package.json`: 실행 스크립트와 서버 의존성

기존 캐릭터, 스킬, 전투 규칙, UI, 방 로직은 초기화되었습니다. 새로운 게임 설계에 맞춰 다시 구현합니다.

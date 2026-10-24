# Redis 구현 검증 결과

2026-10-25. 승인한 독립 Redis 작업 공간 구현과 검증 결과를 기록한다.

## 완료 범위

- 앱 전환 메뉴의 독립 Redis 작업 공간과 지연 로딩.
- 프로필·인증·검증 TLS·고정 DB 연결, Redis 전용 자격증명 namespace.
- SCAN 탐색, 원본 바이너리 키 식별, 접두사 트리, 자료형 6종 값 조회 및 제한된 페이지.
- 캐시 패턴/TTL 구간, List/Stream 큐 등록과 비소비 조회, 즐겨찾기와 보기 편집/삭제.
- 한국어/영어, 다크/라이트, 작은 창의 목록/상세 전환, 명시적 데모 진입/종료.
- 취소·연결 전환·늦은 응답 격리, 대용량 수신/IPC 제한, Cluster 감지와 권한 제한 시 범위 안내.

## 최종 실행 결과

| 검사 | 결과 |
| --- | --- |
| `npm test` | 19 파일, 112개 통과 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 95개 통과, 실패 0, 기존 외부 환경 의존 검사 6개 제외 |
| Redis Playwright 두 파일 | 9개 통과, 프로덕션 프리뷰에서 실행 |
| 기존 production-ui / remember-password 검사 | 6개 통과, DB 사이드바 정렬 검사 1개 실패 |
| `npm run tauri -- build --no-bundle` | Windows release EXE 빌드 성공 |
| `node scripts/redis-release-smoke.mjs` | 실제 패키지의 화면·Tauri IPC·네이티브 TCP 연결/탐색/조회/해제 통과 |
| `node scripts/redis-live-smoke.mjs` | Docker Redis 7.2.16 + 실제 Windows 패키지 UI 검증 12항목 통과 |
| 프론트/네이티브 독립 코드 검토 | 발견된 세션 누수, 선택 경쟁, 데모 혼동, Cluster 범위, 페이지 예산 문제 수정 후 재검토 승인 |

EXE: `src-tauri/target/release/woojoo-db.exe`.

패키지 smoke는 임시 WebView 프로필과 별도 로컬 프로토콜 서버를 사용했다. 영구 Redis 프로필을 생성하지 않았고, 테스트가 생성한 앱 프로세스와 TCP 서버를 종료했다. 사용자 Redis 서버나 Docker 데몬은 변경하지 않았다.

기존 DB 사이드바 검사 `sidebar header is compact and its add action aligns with its label`은 `.section-label`의 상단 간격으로 8px 이하를 기대하지만 현재 공통 제목 아래에서 40px를 관측한다. Redis 화면이 로딩되지 않은 DB 시작 화면에서 발생한다. 이번 작업에서 공통 SidebarTitle와 해당 테스트의 기준은 변경하지 않았다.

## 실제 Redis 검증 추가 (2026-10-25)

사용자 요청으로 Docker Desktop을 시작했다. 오래된 Secrets Engine 소켓으로 최초 시작이 실패했으나 공식 `docker desktop restart`로 복구했다. Docker Engine 29.9.2에서 `redis:7.2-alpine` (실제 버전 7.2.16)을 localhost 임의 포트에 게시했다. 이미지 digest: `sha256:f8548b29a1f1cb358b5fcfec1e0126beab57ad15776c1e87623f865579f16c5a`.

- 실제 release EXE의 연결 폼에서 연결 테스트, 비밀번호 AUTH, DB 3 선택 및 연결 해제 성공.
- String, Hash, List, Set, Sorted Set, Stream의 실제 서버 값을 화면에서 확인.
- 캐시 TTL 1–5분 구간에서 해당 키만 표시하고 영구 키 및 더 긴 TTL의 키가 제외됨을 확인.
- List/Stream 큐를 화면에서 등록하고 List 값, Stream 그룹·소비자·Pending ID를 확인.
- 조회 전후 LRANGE, XRANGE, XPENDING 요약, XINFO GROUPS가 동일함을 확인. 테스트 fixture 준비 단계에서만 XREADGROUP으로 Pending 1건을 생성했으며 앱 조회는 소비하지 않았다.
- 테스트 컨테이너, 앱 프로세스, 저장한 테스트 프로필과 보기를 정리했다. Docker는 실행 상태로 유지했다.

재현: `node scripts/redis-live-smoke.mjs` (Docker 실행 및 release EXE 필요). 결과 JSON: `artifacts/redis-live-results.json`. 화면: `artifacts/redis-live-keys.png`, `redis-live-cache.png`, `redis-live-list.png`, `redis-live-stream.png`.

## 검증하지 않은 항목

실제 Redis의 TLS 성공·세부 ACL 구성·10만 키 성능은 이번 실서버 검사 범위에 포함하지 않았다. 기능은 조회 전용 Standalone 대상이며 Cluster/Sentinel/BullMQ 운영/쓰기 기능은 후속 범위다.

Vite는 기존 메인 번들의 500kB 초과 경고를 출력했으며 빌드 자체는 성공했다.

## 커밋 전 회귀 검증 (2026-10-25)

- `npm test`: 19개 파일, 112개 테스트 통과.
- `npm run test:rust`: 95개 통과, 외부 환경 의존 테스트 6개 제외.
- `npm run build`: 성공. 번들 크기 경고는 유지된다.
- 전체 Playwright: 최초 150개 중 145개 통과. API 도움말 접근성 이름, 새 사이드바 제목 아래 간격, Docker/Redis 추가 후 작업 영역 개수에 맞춰 오래된 테스트 3개를 수정했다.
- 나머지 2개 실패는 실행 도중 메뉴 요소가 사라진 시간 초과였다. 실패한 5개 파일 전체를 다시 실행한 결과 21개 모두 통과했다. 첫 실행 중 패키지 버전을 수정해 개발 서버가 갱신되었을 가능성이 있다.
- 패키지 버전은 Rust/Tauri와 동일한 0.1.4로 유지한다. 이 회귀 검증에서는 위에 기록한 실제 Redis/release EXE 검사를 다시 실행하지 않았다.
- 스크린샷과 실서버 검증 JSON은 보존하고 `artifacts/*-test-results/`의 자동 생성 로그는 Git에서 제외한다.

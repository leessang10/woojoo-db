# Woojoo DB

PostgreSQL · MySQL · MariaDB를 위한 Tauri 2 데스크톱 클라이언트 초안.

React/TypeScript + CodeMirror 화면과 Rust/SQLx DB 서비스를 분리했습니다. JVM이나 로컬 Node 서버를 실행하지 않습니다. Windows에서는 WebView2 런타임을 사용합니다.

## 실행

바로 실행할 앱: `releases/Woojoo-0.1.0-windows-x64.exe` (약 11.2 MiB, WebView2 런타임 별도)

빌드 원본: `src-tauri/target/release/woojoo-db.exe`

개발 실행:

```powershell
npm ci
npm run desktop
```

브라우저 UI 미리보기:

```powershell
npm run dev
```

브라우저 미리보기는 데모만 지원합니다. 실제 DB 연결에는 데스크톱 앱을 사용하세요. 데모 데이터와 실제 DB 연결은 화면에서 명확히 구분됩니다.

Rust 설치 직후 이미 열려 있던 터미널은 다시 열어 PATH를 갱신해야 할 수 있습니다.

## 구현된 기능

- PostgreSQL / MySQL / MariaDB 직접 연결 및 연결 테스트.
- 인증서 검증을 사용하는 TLS 옵션. 자체 서명 인증서 파일 지정 UI는 아직 없습니다.
- DB·스키마·테이블 목록, 테이블 이름 검색.
- SQL 구문 강조, 기본 자동 완성, 선택 SQL 실행, Ctrl+Enter.
- 결과 최대 500행, 가상 행 렌더링, 불러온 결과 내 검색·정렬.
- 기본키로 식별되는 테이블 행 편집: 더블클릭 → 변경 검토 → 적용.
- NULL과 빈 문자열 구분, 기본키/생성 열 수정 금지.
- 수정한 열의 원래 값과 비교해 충돌 감지. 일괄 변경은 하나의 트랜잭션으로 적용.
- MySQL/MariaDB의 일괄 편집은 롤백 가능한 InnoDB에 한정.
- bigint와 decimal은 문자열로 전달해 JavaScript 숫자 정밀도 손실 방지.
- 쿼리 기록(현재 세션), CSV 다운로드(스프레드시트 수식 시작 문자 이스케이프).
- 연결 비밀번호는 메모리에만 보관. 연결 프로필 자체도 이번 세션에만 유지.

## 현재 범위

첫 버전은 테이블 탐색·단일 SQL·결과 편집에 집중합니다.

- SQL은 자동 커밋이며 실행마다 분리된 연결을 사용합니다. 수동 BEGIN/COMMIT, 세션 변수, 임시 테이블을 여러 번의 실행 사이에 유지하는 작업은 지원하지 않습니다.
- 쓰기 SQL은 실행 버튼을 누르면 DB에 적용됩니다. 결과 그리드의 변경 검토와는 별개입니다.
- 자유 SQL의 결과는 읽기 전용입니다. 테이블 보기에서만 셀 편집을 지원합니다.
- 복잡한 DB 타입, binary, 배열, 일부 JSON 등은 편집이 제한됩니다. 자유 SQL에서 지원하지 않는 타입은 표시용 안내 문자열로 나옵니다.
- 500행 미리보기 이후 페이지 이동, DB측 정렬/필터, SSH 터널, 수동 쿼리 취소, DDL/ERD, 연결 프로필 영구 저장은 후속 기능입니다.
- 500행 제한은 바이트 제한이 아닙니다. 매우 큰 LOB/JSON 값을 조회할 때는 SQL에서 필요한 열과 크기를 제한하세요.
- 자유 SQL은 35초 응답 제한이 있으며 PostgreSQL 서버에도 30초 statement timeout을 설정합니다. 제한 시간 초과 시 쓰기 작업의 실제 반영 여부는 DB에서 확인해야 합니다.
- 데모는 `SELECT * FROM public.users` 형태의 미리보기만 지원하며 재시작 시 초기화됩니다.
- 현재 성능 벤치마크로 DBeaver보다 빠르다고 입증한 것은 아닙니다.

## 빌드와 검사

필수 환경: Node.js, Rust stable MSVC, Visual Studio C++ Build Tools + Windows SDK, WebView2.

```powershell
npm test
npm run test:ui
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --no-bundle
```

UI 테스트는 설치된 Chrome을 사용합니다. `playwright.config.ts`의 channel을 환경에 맞게 바꿀 수 있습니다.

실제 DB 통합 테스트는 사용자 DB를 사용하지 않습니다. 다음 전용 컨테이너를 띄운 후 실행합니다. 아래 암호는 폐기 가능한 로컬 테스트 데이터용입니다.

```powershell
docker run --name woojoo-test-pg --rm -d -p 127.0.0.1:55439:5432 -e POSTGRES_PASSWORD=woojoo-local-test -e POSTGRES_DB=woojoo_test postgres:17-alpine
docker run --name woojoo-test-my --rm -d -p 127.0.0.1:53309:3306 -e MYSQL_ROOT_PASSWORD=woojoo-local-test -e MYSQL_DATABASE=woojoo_test mysql:8.4
docker run --name woojoo-test-ma --rm -d -p 127.0.0.1:53310:3306 -e MARIADB_ROOT_PASSWORD=woojoo-local-test -e MARIADB_DATABASE=woojoo_test mariadb:11.4
npm run test:db
docker stop woojoo-test-pg woojoo-test-my woojoo-test-ma
```

테스트는 `woojoo_test` DB의 `woojoo_roundtrip` 테이블을 생성/삭제합니다. 전용 테스트 환경에서만 실행하세요.

`scripts/native-smoke.mjs`는 테스트 실행 시에만 127.0.0.1:9224의 WebView2 디버깅 연결을 사용합니다. 배포 앱은 디버깅 포트를 켜지 않습니다.

## 이번 환경에서 확인한 결과

- Windows MSVC Rust 1.99.1 설치, 기존 Visual Studio 2022 C++ Build Tools 사용.
- TypeScript 검사 및 Vite production build 통과.
- 프런트엔드 로직 테스트 4개, Rust 검증 테스트 3개 통과.
- 브라우저 UI 테스트 2개 통과: 검색, 수정, NULL, 검토, 저장, 재조회, CSV, SQL, 연결 폼.
- PostgreSQL 17 / MySQL 8.4.11 / MariaDB 11.4.13의 실제 통합 테스트 통과: 탐색, 정밀도, 수정, NULL, 충돌 시 일괄 롤백.
- 빌드된 Tauri 앱 안에서 세 DB 각각 연결, 테이블 열기, 셀 수정, 저장 후 재조회, SQL 실행 통과.
- 검증용 컨테이너 및 디버깅용 앱 인스턴스는 종료함.
- `docs/research/dbeaver/woojoo-desktop.png`: 실제 Tauri 화면의 데모 초기 상태.
- `docs/research/dbeaver/woojoo-live-db.png`: 실제 DB 연결 테스트 화면.

## 파일 구조

- `src/App.tsx`: 연결, 탐색기, 편집기, 결과와 수정 검토 화면.
- `src/api.ts`: Tauri 명령 연결 및 별도의 데모 어댑터.
- `src/model.ts`: 수정 내역, SQL 식별자, CSV 처리.
- `src-tauri/src/db.rs`: DB 연결, metadata, query, transaction 기반 수정.
- `src-tauri/src/plan.rs`: 수정 대상과 식별자 검증.
- `docs/research/dbeaver/inspection.md`: DBeaver 설치본 분석 근거.

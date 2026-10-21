[한국어 README](../README.md) · [English README](../README.en.md)

> 고급 기능, 제한 사항과 전용 DB 테스트 환경을 위한 참고 문서입니다.

# Woojoo DB

PostgreSQL · MySQL · MariaDB · SQLite를 위한 Tauri 2 데스크톱 클라이언트.

React/TypeScript + CodeMirror 화면과 Rust/SQLx DB 서비스를 분리했습니다. JVM이나 로컬 Node 서버를 실행하지 않습니다. Windows에서는 WebView2 런타임을 사용합니다.

## 실행

Windows x64 실행 파일: [Woojoo v0.1.0 다운로드](https://github.com/leessang10/woojoo-db/releases/tag/v0.1.0)

릴리즈의 `Woojoo-0.1.0-windows-x64.exe`를 내려받아 실행하세요. WebView2 런타임이 필요하며, 설치 프로그램 없이 실행하는 포터블 앱입니다. 실행 파일은 코드 서명되어 있지 않습니다. 같은 페이지에서 소스 ZIP/tar.gz와 SHA-256 체크섬을 받을 수 있습니다.

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

앱은 저장된 연결 또는 빈 작업 공간으로 시작합니다. 샘플 연결과 데이터는 기본 화면에 표시하지 않습니다. 데이터베이스 연결에는 데스크톱 앱을 사용하세요. 메모리 데이터는 개발 서버의 UI 테스트에서만 명시적으로 활성화됩니다.

Rust 설치 직후 이미 열려 있던 터미널은 다시 열어 PATH를 갱신해야 할 수 있습니다.

## 구현된 기능

- ERD: 스키마/테이블 상세의 **ERD 열기**, 또는 트리 우클릭으로 시작합니다. PK/FK 메타데이터와 참조 대상 테이블을 자동 배치합니다.
- ERD 편집: 드래그 이동, 테이블 색·모양·너비, 관계 추가/삭제/재연결, 시작·대상 컬럼, 선 종류·색·점선·화살표, 실행 취소/다시 실행을 지원합니다. 실제 DB 제약조건은 변경하지 않습니다.
- ERD 컬럼 표시: PK만 / PK와 FK / 모든 컬럼. 배치와 스타일은 연결·스키마별로 로컬 저장되며 비밀번호나 데이터 행은 저장하지 않습니다.
- ERD 내보내기: 전체 캔버스를 PNG 또는 이미지 기반 PDF로 저장합니다. 데스크톱에서는 저장 대화상자를 사용합니다. 큰 다이어그램은 최대 8,000px 변/1,600만 픽셀 범위로 축소합니다.
- ERD는 React Flow, Dagre, html-to-image, jsPDF를 사용합니다. [라이선스 고지](ERD-THIRD-PARTY-NOTICES.txt).

- 스키마 상세: 트리의 화살표 버튼·더블클릭·우클릭 메뉴로 열며, 테이블 검색과 구조/데이터 탐색을 지원합니다.
- 테이블 상세: 컬럼·자료형·기본키·NULL 허용·기본값을 조회합니다. 실제 연결에서는 `describe_table`이 메타데이터만 읽습니다.
- 컨텍스트 메뉴: 연결·스키마·테이블·쿼리 탭·SQL 편집기·결과 셀/행/열·쿼리 기록에서 우클릭. 키보드에서는 Shift+F10, 방향키, Enter, Escape를 지원합니다.
- 설정: 왼쪽 하단 설정 버튼 또는 Ctrl/Cmd+,로 테마·언어·사이드바 표시를 변경하고 저장합니다.
- 한국어 / English 전환: 상단 언어 선택, 브라우저 언어 기본값, 선택값 저장.
- 다크 / 라이트 모드와 마지막 선택값 저장.
- 사이드바 접기 / 펼치기: 상단 버튼 또는 Ctrl/Cmd+B, 상태 저장.
- 팝업 키보드 포커스 유지, Escape 닫기, 편집 대기 값 기준 검색·정렬.
- 연결별 다중 쿼리·테이블 탭. SQL, 결과, 필터, 수정 대기 값, 편집기 실행 취소 기록을 탭별로 유지.
- 내용이 있는 탭을 닫을 때 확인, 실행 중인 탭의 닫기 방지, 쿼리 기록을 새 탭으로 열기.
- 연결 프로필 저장·수정·삭제, 그룹·환경·읽기 전용 설정. 연결 우클릭으로 관리합니다.
- SQL 탭과 활성 탭을 재시작 후 복원합니다. 비밀번호 기억을 선택한 마지막 연결은 Windows 자격 증명 관리자를 사용해 자동 접속합니다. 자동 접속 실패 시 다시 입력할 수 있으며 저장하지 않은 연결은 수동으로 연결합니다. 결과 행과 미적용 데이터 편집은 디스크에 저장하지 않습니다.
- SQL 파일 열기·저장·다른 이름으로 저장. 브라우저에서는 업로드·다운로드로 동작합니다.

- PostgreSQL / MySQL / MariaDB 직접 연결 및 연결 테스트. SQLite 파일 선택·생성·읽기 전용 연결.
- 인증서 검증을 사용하는 TLS 옵션. 자체 서명 인증서 파일 지정 UI는 아직 없습니다.
- DB·스키마·테이블 목록, 테이블 이름 검색.
- SQL 구문 강조, 기본 자동 완성, 선택 SQL 실행, Ctrl+Enter.
- 결과 최대 500행, 가상 행 렌더링, 불러온 결과 내 검색·정렬.
- 기본키로 식별되는 테이블 행 편집: 더블클릭 → 변경 검토 → 적용.
- NULL과 빈 문자열 구분, 기본키/생성 열 수정 금지.
- 수정한 열의 원래 값과 비교해 충돌 감지. 일괄 변경은 하나의 트랜잭션으로 적용.
- MySQL/MariaDB의 일괄 편집은 롤백 가능한 InnoDB에 한정.
- bigint와 decimal은 문자열로 전달해 JavaScript 숫자 정밀도 손실 방지.
- 저장된 기록: 연결별 최근 SQL 200개, 검색·성공/실패·실행 시간. SQL에 직접 작성한 값도 저장되며 매개변수 입력값은 제외합니다.
- 연결 비밀번호는 선택 시 Windows 자격 증명 관리자에 암호화하여 저장합니다. 저장된 연결 프로필에는 이름·엔진·주소·그룹·환경·비밀번호 기억 여부만 포함하며 비밀번호 자체는 포함하지 않습니다. 저장하지 않은 비밀번호는 앱 종료 전까지만 메모리에서 기억합니다. 연결 창의 저장된 비밀번호 삭제 또는 프로필 삭제 시 Windows 저장소와 메모리의 비밀번호를 삭제합니다.

## 작업 도구

- 테이블의 **데이터 도구**: 서버 필터·정렬·페이지 이동, 행 삽입/복제/삭제, 범위 복사/붙여넣기, JSON/긴 텍스트/binary 편집, 레코드 폼, 열 너비/순서/숨김, 단일 컬럼 FK 값 선택과 참조 테이블 이동.
- CSV 가져오기: 컬럼 매핑·NULL/빈 문자열 구분·변경 미리보기. CSV/JSON/INSERT SQL 내보내기는 현재 페이지보다 많은 행도 처리합니다.
- 테이블 복사: 연결과 대상 테이블을 선택해 같은 이름의 컬럼 데이터를 이동합니다. 대상 테이블은 먼저 만들어야 합니다.
- SQL: 형식 정리·스키마 메타데이터 자동완성·이름 매개변수·여러 문장 순차 실행/개별 결과·첫 오류에서 중단·EXPLAIN.
- SQL 세션: 임시 테이블/세션 변수를 유지하며 수동 COMMIT/ROLLBACK과 DB 서버 쿼리 취소를 지원합니다. 그리드 편집과 구조 변경은 SQL 세션과 별개의 원자적 트랜잭션입니다.
- 편집 가능한 SQL 결과: 스키마를 명시한 단일 테이블 SELECT * 결과에서 기본키가 확인되는 경우. 조인/부분 투영/별칭/스키마 없는 조회는 읽기 전용입니다.
- 구조: 인덱스/PK/UNIQUE/FK/CHECK 추가·삭제 SQL 검토, DDL 열기, 뷰/함수/프로시저/트리거 정의를 SQL 편집기로 열어 변경. DB별 지원 범위가 다릅니다.
- 연결 우클릭 **백업 / 복원**: pg_dump/psql, mysqldump/mysql, mariadb-dump/mariadb. SQLite 백업은 내장 VACUUM INTO, 복원은 sqlite3 CLI를 사용합니다. 외부 도구는 PATH에 있어야 하며, 복원은 대상 DB 이름을 입력해 확인합니다.

## 현재 제한

- 기본 조회/자유 SQL 결과는 최대 500행입니다. 더 큰 테이블 조회·내보내기는 데이터 도구를 사용하세요.
- 데이터 도구 CSV 가져오기는 한 번에 10,000행, 테이블 복사는 100,000행까지입니다. 원본을 여러 페이지로 읽는 복사/내보내기는 전체 스냅샷을 보장하지 않으므로 진행 중 원본 쓰기를 멈춰야 일관된 결과를 얻을 수 있습니다.
- FK 값 선택기는 단일 컬럼 FK를 지원합니다. SQLite 컬럼 타입/제약조건 변경은 테이블 재생성이 필요하여 자동 변경을 제공하지 않습니다.
- PostgreSQL 테이블 DDL은 메타데이터로 재구성됩니다. 시퀀스·권한·정책 등 종속 객체까지 보존하려면 pg_dump 백업을 사용하세요.
- MySQL 프로시저 내부에서 트랜잭션을 바꾸는 경우 UI 상태 추적에 제한이 있습니다. MySQL 복원/DDL은 암묵적 커밋 때문에 실패 전 일부 변경이 반영될 수 있습니다.
- 임시 테이블/세션 변수는 연결을 끊으면 없어집니다. 재시작 복원은 SQL/탭만 복원하며 연결·트랜잭션은 복원하지 않습니다.
- MySQL DELIMITER 지시어는 직접 처리하지 않습니다. 뷰/프로시저/함수/트리거 정의는 편집기의 기본 실행 버튼을 사용하세요. 확인 후 편집기의 전체 SQL을 서버 스크립트로 실행합니다. 이 경로에서는 결과 행을 반환하지 않으며 트랜잭션 상태가 불명확하면 COMMIT/ROLLBACK으로 종료해야 합니다.
- SSH 터널, 사용자 지정 CA 인증서 UI, 전체 DB 간 구조 비교·동기화는 포함하지 않습니다.
- 사용자 RDS 데이터에 쓰기 테스트를 하지 않았습니다. 네이티브 자동 검증은 폐기 가능한 SQLite DB에서 수행하며 PostgreSQL/MySQL/MariaDB 통합 테스트는 별도 전용 컨테이너가 필요합니다.

## 빌드와 검사

필수 환경: Node.js, Rust stable MSVC, Visual Studio C++ Build Tools + Windows SDK, WebView2.

```powershell
npm test
npm run test:ui
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --no-bundle
# 개발 서버(1420)를 종료한 뒤 실제 EXE 검증
npm run test:release
```

릴리즈는 Tauri CLI로 빌드해야 합니다. 배포용 custom-protocol 없이 `cargo build --release`를 실행하면 개발 서버를 참조하는 EXE 생성을 막기 위해 실패합니다. `test:release`는 임시 WebView 프로필과 테스트용 디버깅 포트를 사용하여 개발 서버 없이 EXE의 시작·새로고침·연결 창을 검증하고 테스트 프로세스를 종료합니다.

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

## v0.1.0 검증

- TypeScript 검사 및 Vite 프로덕션 빌드, Windows x64 실행 파일 빌드 통과.
- 프런트엔드 단위 테스트 30개, 브라우저 UI 테스트 59개 통과.
- Rust 테스트 21개 통과. 로컬 AWS 인증과 별도 DB 컨테이너가 필요한 통합 테스트 2개는 기본 실행에서 제외됩니다.
- UI 테스트의 DB/AWS 호출 일부는 모의 통신을 사용합니다. 모든 실제 서버 구성에 대한 호환성 검증을 의미하지는 않습니다.

## 파일 구조

- `src/App.tsx`: 연결, 탐색기, 편집기, 결과와 수정 검토 화면.
- `src/api.ts`: Tauri 명령 연결 및 별도의 데모 어댑터.
- `src/model.ts`: 수정 내역, SQL 식별자, CSV 처리.
- `src-tauri/src/db.rs`: DB 연결, metadata, query, transaction 기반 수정.
- `src-tauri/src/plan.rs`: 수정 대상과 식별자 검증.
- `docs/research/dbeaver/inspection.md`: DBeaver 설치본 분석 근거.

### 구조 관리

사이드바의 스키마·테이블 이름을 클릭하면 상세 화면이 열립니다. 펼치기/접기는 별도 화살표를 사용합니다. 스키마 상세에서 테이블을 생성·변경·삭제하고, 테이블 상세에서 컬럼을 추가·변경·삭제할 수 있습니다. 실행 전 SQL 검토가 필요하며 삭제는 대상 이름을 입력해야 합니다.

MySQL/MariaDB의 charset·collation, PostgreSQL의 DB 인코딩·collation, 소유자·설명·추정 행 수·크기와 인덱스·제약조건을 조회합니다. MySQL 테이블 기본 charset 변경은 기존 컬럼을 변환하지 않습니다. 생성 컬럼·특수 자료형 등 폼에서 지원하지 않는 변경은 SQL 편집기를 사용합니다. MySQL/MariaDB DDL은 자동 커밋되며 PostgreSQL의 여러 변경 문장은 트랜잭션으로 실행됩니다. 데모 구조는 현재 세션에만 유지되며 실제 DB의 형 변환·제약조건 검증 전체를 재현하지 않습니다.

### AWS CLI에서 RDS 연결

데스크톱의 **새 연결 → AWS RDS**에서 로컬 AWS CLI를 확인하고 저장된 프로필을 선택합니다. 로그인된 계정 ID를 확인한 뒤 리전을 선택하거나 직접 입력하고 **RDS 조회**를 누릅니다. 인스턴스를 고르면 엔진·호스트·포트·초기 DB명·마스터 사용자명을 연결 폼에 채웁니다. 실제 사용할 DB명과 사용자명은 변경할 수 있으며 비밀번호는 직접 입력합니다. DB명이 없는 PostgreSQL 인스턴스는 `postgres`를 기본값으로 사용하고 MySQL/MariaDB는 입력을 요구합니다.

- AWS CLI v2 권장. PATH 또는 Windows 기본 설치 위치에서 실행 파일을 찾습니다. 프로필은 `aws configure list-profiles`로 조회하며 CLI의 기존 인증/역할 설정을 사용합니다.
- `sts get-caller-identity`로 계정을 확인하고 `ec2:DescribeRegions`, `rds:DescribeDBInstances`를 사용합니다. 리전 조회 권한이 없으면 리전 코드를 직접 입력할 수 있습니다. 인스턴스 목록은 CLI 자동 페이지 조회를 사용합니다.
- PostgreSQL, MySQL, MariaDB, Aurora PostgreSQL/MySQL의 사용 가능한 인스턴스 엔드포인트를 지원합니다. Aurora 클러스터 writer/reader 엔드포인트 선택은 아직 지원하지 않습니다.
- AWS 인증은 리소스 조회용입니다. IAM DB 인증 토큰 발급이나 Secrets Manager 비밀번호 조회는 수행하지 않습니다. SSO 인증 만료 시 터미널에서 `aws sso login --profile <프로필>` 실행 후 다시 확인합니다.
- 사설 RDS는 접속 가능한 VPN/터널이 필요하고 보안 그룹도 접속을 허용해야 합니다. 이 흐름이 터널이나 AWS 리소스를 생성·변경하지는 않습니다.
- 셸 문자열을 조합하지 않고 고정된 CLI 명령과 인자를 전달하며, 조회 시간 제한·Windows 콘솔 숨김·인증 오류 안내를 적용합니다. 원본 CLI 오류 내용이나 자격증명은 화면/로그에 전달하지 않습니다.

로컬 CLI의 읽기 전용 연결 경로 검증: `cargo test --manifest-path src-tauri/Cargo.toml aws::tests::local_aws_discovery -- --ignored`. 기본 `default` 프로필을 사용하며 `WOOJOO_TEST_AWS_PROFILE` 환경변수로 변경할 수 있습니다. DB에 연결하거나 데이터를 변경하지 않습니다.


### 실행한 쿼리

왼쪽 도구 모음의 **실행한 쿼리**에서 누적 실행 내역을 조회합니다. 연결이 끊겼거나 프로필이 삭제되어도 기존 실행 내역은 유지됩니다. SQL/오류 검색, 연결·상태·날짜 필터, 50건 단위 페이지 이동, 전체 SQL 복사와 원래 연결의 새 편집기 탭으로 열기를 지원합니다. 열기는 SQL을 실행하지 않습니다.

네이티브 앱 데이터 폴더의 `query-executions.sqlite3`에 이 버전부터 실행한 SQL, 연결 프로필 ID/이름, DB 이름·엔진, 실행 시각·소요 시간·상태·오류를 보관합니다. 자동 삭제나 최근 200건 제한은 없습니다. SQL 편집기 실행, 선택 영역 실행, 스크립트의 실행된 각 문장, 매개변수 치환 후 SQL, EXPLAIN, 객체 SQL, 명시적 COMMIT/ROLLBACK, 구조 변경 SQL을 기록합니다. 실행되지 않은 스크립트 후속 문장, 자동 메타데이터 조회와 데이터 그리드 내부 쿼리는 수집하지 않습니다. 기존 최근 기록을 소급하여 실제 실행 SQL로 변환하지 않습니다.

성공은 문장 실행의 성공이며 이후 수동 트랜잭션의 커밋을 의미하지 않습니다. 종료 전에 완료 상태를 확인하지 못한 실행은 다음 시작 시 중단됨으로 표시합니다. SQL 본문과 본문에 들어간 값은 로컬 파일에 그대로 저장되며 연결 비밀번호와 결과 행은 별도로 수집하지 않습니다. 실행 시작 기록이 저장되지 않으면 SQL 실행을 시작하지 않습니다. 실행 완료 후 상태 갱신만 실패하면 SQL 결과를 실패로 바꾸지 않고 별도 알림을 표시합니다.


### 첫 로컬 SQLite 연결

저장된 연결이 없는 초기 화면의 **로컬 SQLite 만들기**를 누르면 앱 데이터 폴더의 `databases/local.sqlite3`를 생성하고 Local SQLite 프로필로 연결합니다. 기존 파일이 있으면 초기화하지 않고 재사용합니다. 생성 도중 실패한 임시 DB를 최종 파일로 노출하지 않습니다.

새 파일에는 빈 테이블 두 개만 만듭니다: `user(id, name, email, created_at)`, `board(id, user_id, title, content, created_at)`. `board.user_id → user.id` 외래 키와 조회용 인덱스로 사용자 1명 대 게시물 N개의 관계를 구성합니다. 게시물이 있는 사용자의 삭제는 제한하며, 연결마다 외래 키 검사를 활성화합니다. 연결 프로필을 삭제해도 DB 파일은 삭제하지 않습니다.
